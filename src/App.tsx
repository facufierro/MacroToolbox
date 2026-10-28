import { Icon, IconButton } from "./Icon";
import { useState, useEffect, useCallback, useRef, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog, save as saveDialog, confirm as confirmDialog, ask } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { api } from "./api";
import { useErrorReporter } from "./AppConsole";
import { CloudSettings } from "./CloudSettings";
import { KeyInput, useBindingRecorder } from "./KeyInput";
import { EnableSwitch } from "./EnableSwitch";
import { ProfileSection } from "./ProfileSection";
import { OverlayGroupPanel } from "./OverlayGroupPanel";
import { BehaviorStepsEditor, GotoInput } from "./BehaviorEditor";
import { mapScriptActions, withReferencedScripts, carryReferencedScripts, removeScriptReferences } from "./scriptReferences";
import { describeBehavior, parseSteps, stepsToString, areStepsValid, type Step } from "./behaviors";
import { allowsExtraModifiers } from "./hotkeyModifiers";
import { carryReferencedStates, mapStateActions, removeProfileState, withReferencedStates } from "./profileStates";
import { nameOverlayParts, availableOverlayItems, availableOverlayTargets, resolveOverlayGroups, saveOverlayGroup, duplicateOverlayGroup, removeOverlayGroup, remapOverlayReferences, withReferencedOverlayParts, carryReferencedOverlayParts, moveOverlayPart, removeOverlayItem } from "./overlayItems";
import type {
  Database,
  Scope,
  Profile,
  Hotkey,
  BehaviorEvent,
  BehaviorEventKind,
  OverlayItem,
  OverlayGroup,
  OverlayTarget,
  ProfileState,
  Script,
  ProfileKind,
} from "./types";
import "./App.css";

type Modal =
  | { type: "addGame" }
  | { type: "editGame"; game: Scope }
  | { type: "profileSettings"; gameId: string; profile: Profile; isNew: boolean }
  | { type: "editHotkey"; gameId: string; profileId: string; index: number | null; hotkey: Hotkey; gameExe: string; states: ProfileState[]; overlays: OverlayTarget[] }
  | { type: "editEvent"; gameId: string; profileId: string; index: number | null; event: BehaviorEvent; eventKinds: BehaviorEventKind[]; gameExe: string; states: ProfileState[]; overlays: OverlayTarget[] }
  | { type: "copyHotkey"; sourceGameId: string; sourceProfileId: string; hotkey: Hotkey }
  | { type: "setParent"; gameId: string; profile: Profile }
  | { type: "copyProfile"; sourceGameId: string; profile: Profile }
  | { type: "overlayItem"; gameId: string; profileId: string; index: number | null; item: OverlayItem; gameExe: string; states: ProfileState[] }
  | { type: "copyState"; sourceGameId: string; sourceProfileId: string; state: ProfileState }
  | { type: "profileState"; gameId: string; profileId: string; index: number | null; state: ProfileState }
  | { type: "script"; gameId: string; profileId: string; index: number | null; script: Script };

// ── Helpers ──────────────────────────────────────────────────────────────────

const GLOBAL_EXE = "*";
const GLOBAL_FOLDER_ID = "global";

function uid() {
  return crypto.randomUUID();
}

/** A folder owns one app target shared by all of its profiles. */
function blankGame(): Scope {
  return { id: uid(), name: "", exe: "", image: null, profiles: [], states: [] };
}

/** A profile owns the behaviors that run against its folder's app target. */
function blankProfile(kind: ProfileKind): Profile {
  return {
    id: uid(), name: kind.charAt(0).toUpperCase() + kind.slice(1), kind, armed: false, parent_id: null,
    hotkeys: [], events: [], states: [], overlay_items: [], overlay_triggers: [], overlay_groups: [],
    scripts: [], overlay_disabled: false, toggle_hotkeys_key: null, toggle_overlay_key: null,
  };
}

/** `exe === "*"` means the folder applies to any app / always. */
function isGlobalExe(exe: string) {
  return exe.trim() === GLOBAL_EXE;
}

function hasSpecificAppTarget(exe: string) {
  return exe.trim() !== "" && !isGlobalExe(exe);
}

function blankTimer():   OverlayItem { return { type: "timer", id: uid(), name: "", x: 0, y: 0, duration_ms: 60000, color: "#ffffff", font_size: 22, state_id: null, timer_state_id: null, show_only_running: true }; }
function blankIcon():    OverlayItem { return { type: "icon",  id: uid(), name: "", x: 0, y: 0, w: 64, h: 64, src: null, state_id: null }; }
function blankBar():     OverlayItem { return { type: "bar",   id: uid(), name: "", x: 0, y: 0, w: 200, h: 20, color: "#4ade80", max_value: 100, state_id: null }; }
function blankText():    OverlayItem { return { type: "text",  id: uid(), name: "", x: 0, y: 0, font_size: 16, color: "#ffffff", content: "", state_id: null }; }
function blankState(): ProfileState { return { id: uid(), name: "", duration_ms: null }; }
function blankScript(): Script { return { id: uid(), name: "", enabled: true, trigger: "hotkey", hotkey: "", language: "python", source: "code", code: "", path: "" }; }

// ── Export / Import helpers ───────────────────────────────────────────────────

type LegacyProfileExport = Profile & { exe?: string };
type LegacyScopeExport = Omit<Scope, "exe" | "profiles"> & { exe?: string; profiles: LegacyProfileExport[] };

function remapProfileIds(profile: LegacyProfileExport, profileIds?: Map<string, string>, stateIds?: Map<string, string>, itemIds?: Map<string, string>, scriptIds?: Map<string, string>, groupIds?: Map<string, string>): Profile {
  const { exe: _legacyExe, ...profileData } = profile;
  const stateMap = stateIds ?? new Map(profile.states.map(s => [s.id, uid()]));
  const stateId = (id: string) => stateMap.get(id) ?? id;
  const itemMap = itemIds ?? new Map(profile.overlay_items.map(item => [item.id, uid()]));
  const scriptMap = scriptIds ?? new Map((profile.scripts ?? []).map(script => [script.id, uid()]));
  const remapBehavior = (behavior: string) => mapScriptActions(mapStateActions(behavior, stateId), id => scriptMap.get(id) ?? id);
  const groupMap = groupIds ?? new Map((profile.overlay_groups ?? []).map(g => [g.id, uid()]));
  const mapped: Profile = {
    ...profileData,
    id: profileIds?.get(profile.id) ?? uid(),
    armed: false,
    parent_id: profile.parent_id ? (profileIds?.get(profile.parent_id) ?? profile.parent_id) : null,
    events: (profile.events ?? []).map(event => ({ ...event, behavior: remapBehavior(event.behavior) })),
    scripts: (profile.scripts ?? []).map(s => ({ ...s, id: scriptMap.get(s.id)! })),
    states: profile.states.map(s => ({ ...s, id: stateMap.get(s.id)! })),
    overlay_groups: profile.overlay_groups ?? [],
    hotkeys: profile.hotkeys.map(h => ({
      ...h,
      behavior: remapBehavior(h.behavior),
      state_id: h.state_id ? stateId(h.state_id) : null,
    })),
    overlay_items: profile.overlay_items.map(item => ({
      ...item,
      state_id: item.state_id ? stateId(item.state_id) : null,
      ...(item.type === "timer" && item.timer_state_id
        ? { timer_state_id: stateId(item.timer_state_id) }
        : {}),
    })),
  };
  return remapOverlayReferences(mapped, id => itemMap.get(id) ?? groupMap.get(id) ?? id);
}

function materializeProfile(profile: Profile, profiles: Profile[]): Profile {
  return { ...profile, parent_id: null,
    hotkeys: resolveHotkeys(profiles, profile).map(({ hotkey }) => hotkey),
    events: resolveEvents(profiles, profile).map(({ event }) => event),
    overlay_items: resolveOverlayItems(profiles, profile).map(({ item }) => item),
    overlay_groups: resolveOverlayGroups(profiles, profile),
  };
}

async function exportProfile(profile: Profile, folder: Scope) {
  const profiles = folder.profiles;
  const path = await saveDialog({
    title: "Export Profile",
    defaultPath: `${profile.name || "profile"}.hkm-profile`,
    filters: [{ name: "HKM Profile", extensions: ["hkm-profile"] }],
  });
  if (!path) return;
  const states = folder.states;
  await api.writeTextFile(path, JSON.stringify({ version: 2, type: "profile", data: withReferencedScripts(withReferencedStates(withReferencedOverlayParts(materializeProfile(profile, profiles), profiles), states), profiles.flatMap(profile => profile.scripts)) }, null, 2));
}

async function exportScope(scope: Scope) {
  const path = await saveDialog({
    title: "Export Scope",
    defaultPath: `${scope.name || "scope"}.hkm-scope`,
    filters: [{ name: "HKM Scope", extensions: ["hkm-scope"] }],
  });
  if (!path) return;
  await api.writeTextFile(path, JSON.stringify({ version: 2, type: "scope", data: scope }, null, 2));
}

async function importProfile(): Promise<Profile | null> {
  const path = await openDialog({
    title: "Import Profile",
    filters: [{ name: "HKM Profile", extensions: ["hkm-profile", "json"] }],
    multiple: false, directory: false,
  });
  if (!path) return null;
  const raw = JSON.parse(await api.readTextFile(path as string));
  if (raw.type !== "profile") throw new Error("File is not a profile export");
  return remapProfileIds(raw.data as Profile);
}

async function importScope(): Promise<Scope[] | null> {
  const path = await openDialog({
    title: "Import Scope",
    filters: [{ name: "HKM Scope", extensions: ["hkm-scope", "json"] }],
    multiple: false, directory: false,
  });
  if (!path) return null;
  const raw = JSON.parse(await api.readTextFile(path as string));
  if (raw.type !== "scope") throw new Error("File is not a scope export");
  const scope = raw.data as LegacyScopeExport;
  const profileIds = new Map(scope.profiles.map(profile => [profile.id, uid()]));
  const stateIds = new Map([...(scope.states ?? []), ...scope.profiles.flatMap(profile => profile.states ?? [])].map(state => [state.id, uid()] as const));
  const itemIds = new Map(scope.profiles.flatMap(profile => profile.overlay_items.map(item => [item.id, uid()] as const)));
  const scriptIds = new Map(scope.profiles.flatMap(profile => (profile.scripts ?? []).map(script => [script.id, uid()] as const)));
  const groupIds = new Map(scope.profiles.flatMap(profile => (profile.overlay_groups ?? []).map(group => [group.id, uid()] as const)));
  let entries = scope.profiles.map(profile => ({
    target: typeof scope.exe === "string" ? scope.exe.trim() : (profile.exe ?? "").trim(),
    profile: remapProfileIds(profile, profileIds, stateIds, itemIds, scriptIds, groupIds),
  }));

  const allProfiles = entries.map(entry => entry.profile);
  const targetsByProfile = new Map(entries.map(entry => [entry.profile.id, entry.target]));
  entries = entries.map(entry => {
    const parent = entry.profile.parent_id
      ? allProfiles.find(profile => profile.id === entry.profile.parent_id)
      : undefined;
    if (!parent || (targetsByProfile.get(parent.id) ?? "").toLowerCase() === entry.target.toLowerCase()) {
      return entry;
    }
    return {
      ...entry,
      profile: {
        ...entry.profile,
        parent_id: null,
        hotkeys: resolveHotkeys(allProfiles, entry.profile).map(({ hotkey }) => ({ ...hotkey })),
        events: resolveEvents(allProfiles, entry.profile).map(({ event }) => ({ ...event })),
        states: resolveStates(allProfiles, entry.profile).map(({ state }) => ({ ...state })),
        overlay_items: resolveOverlayItems(allProfiles, entry.profile).map(({ item }) => ({ ...item })),
      },
    };
  });

  const groups: Array<{ exe: string; profiles: Profile[] }> = [];
  for (const entry of entries) {
    const group = groups.find(candidate => candidate.exe.toLowerCase() === entry.target.toLowerCase());
    if (group) group.profiles.push(entry.profile);
    else groups.push({ exe: entry.target, profiles: [entry.profile] });
  }
  if (groups.length === 0) groups.push({ exe: typeof scope.exe === "string" ? scope.exe.trim() : "", profiles: [] });

  return groups.map(group => ({
    ...scope,
    id: uid(),
    name: groups.length === 1
      ? scope.name
      : `${scope.name} (${isGlobalExe(group.exe) ? "Any app" : group.exe || "No app"})`,
    exe: group.exe,
    profiles: group.profiles,
    states: (scope.states ?? []).map(state => ({ ...state, id: stateIds.get(state.id)! })),
  }));
}

function formatDuration(ms: number | null) {
  if (!ms || ms <= 0) return "0s";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

function stateNameById(states: ProfileState[], stateId: string | null | undefined) {
  if (!stateId) return null;
  return states.find(state => state.id === stateId)?.name ?? null;
}

type ResolvedProfileEntry<T> = { value: T; own: boolean };

function resolveProfileEntries<T>(
  profiles: Profile[],
  profile: Profile,
  select: (profile: Profile) => T[],
  keyOf: (value: T) => string,
  visited = new Set<string>(),
): Array<ResolvedProfileEntry<T>> {
  if (visited.has(profile.id)) return [];

  const nextVisited = new Set(visited);
  nextVisited.add(profile.id);

  const resolved: Array<ResolvedProfileEntry<T>> = profile.parent_id
    ? (() => {
        const parent = profiles.find(candidate => candidate.id === profile.parent_id);
        return parent
          ? resolveProfileEntries(profiles, parent, select, keyOf, nextVisited).map(entry => ({ ...entry, own: false }))
          : [];
      })()
    : [];

  for (const value of select(profile)) {
    const key = keyOf(value);
    const index = resolved.findIndex(entry => keyOf(entry.value) === key);
    const entry = { value, own: true };
    if (index >= 0) resolved[index] = entry;
    else resolved.push(entry);
  }

  return resolved;
}

function resolveHotkeys(profiles: Profile[], profile: Profile): Array<{ hotkey: Hotkey; own: boolean }> {
  return resolveProfileEntries(profiles, profile, current => current.hotkeys, hotkey => hotkey.trigger)
    .map(({ value, own }) => ({ hotkey: value, own }));
}

function resolveEvents(profiles: Profile[], profile: Profile): Array<{ event: BehaviorEvent; own: boolean }> {
  return resolveProfileEntries(profiles, profile, current => current.events ?? [], event => event.event)
    .map(({ value, own }) => ({ event: value, own }));
}

function resolveStates(profiles: Profile[], profile: Profile): Array<{ state: ProfileState; own: boolean }> {
  return resolveProfileEntries(profiles, profile, current => current.states, state => state.id)
    .map(({ value, own }) => ({ state: value, own }));
}

function resolveOverlayItems(profiles: Profile[], profile: Profile): Array<{ item: OverlayItem; own: boolean }> {
  const entries = resolveProfileEntries(profiles, profile, current => current.overlay_items, item => item.id);
  const items = nameOverlayParts(entries.map(({ value }) => value), resolveOverlayGroups(profiles, profile));
  return entries.map(({ own }, index) => ({ item: items[index], own }));
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Placeholder({ label }: { label?: string }) {
  return (
    <div className="placeholder">
      <span>{label ?? "[ image ]"}</span>
    </div>
  );
}

// ── Redesigned shell: library tree + focused editor ───────────────────────────

type Selection =
  | { kind: "profile"; folderId: string; profileId: string }
  | { kind: "settings" }
  | { kind: "empty" };

/** Whether an armed profile's folder app is present (so its hotkeys can fire). "*" is always present. */
function profileAppActive(exe: string, openExes: Set<string>): boolean {
  return isGlobalExe(exe) || openExes.has(exe.trim().toLowerCase());
}

/** Green when armed and its app is active, yellow when armed but the app is not, hollow when off. */
function StatusDot({ armed, active }: { armed: boolean; active: boolean }) {
  const cls = !armed ? "status-dot--off" : active ? "status-dot--live" : "status-dot--armed";
  return <span className={`status-dot ${cls}`} />;
}

function TargetChip({ exe }: { exe: string }) {
  const label = isGlobalExe(exe) ? "Any app" : (exe.trim() === "" ? "No app" : exe);
  return <span className="target-chip" title={label}>{label}</span>;
}

function ArmSwitch({ armed, size, onChange }: { armed: boolean; size?: "lg"; onChange: (a: boolean) => void }) {
  return <EnableSwitch enabled={armed} size={size} label="Profile enabled" onChange={onChange} />;
}

type CtxItem = { label: string; danger?: boolean; onClick: () => void };

/** Right-click context menu positioned at the cursor and portaled to body. */
function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: CtxItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 210);
  const top = Math.min(y, window.innerHeight - (items.length * 34 + 16));
  return createPortal(
    <div ref={ref} className="menu menu--fixed" style={{ left, top }}>
      {items.map((it, i) => (
        <button key={i} className={it.danger ? "menu--danger" : ""}
          onClick={() => { onClose(); it.onClick(); }}>{it.label}</button>
      ))}
    </div>, document.body);
}

function EmptyState({ title, hint, action, secondary }: {
  title: string; hint?: string;
  action?: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
}) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      {hint && <p>{hint}</p>}
      {(action || secondary) && (
        <div style={{ display: "flex", gap: 8 }}>
          {action && <IconButton icon="plus" label={action.label}  className="btn btn--primary" onClick={action.onClick} />}
          {secondary && <IconButton icon="file-import" label={secondary.label}  className="btn btn--ghost" onClick={secondary.onClick} />}
        </div>
      )}
    </div>
  );
}

function Resizer({ onPointerDown }: { onPointerDown: (e: ReactPointerEvent) => void }) {
  const [drag, setDrag] = useState(false);
  return (
    <div className={`resizer ${drag ? "resizer--dragging" : ""}`}
      onPointerDown={e => {
        setDrag(true);
        onPointerDown(e);
        const up = () => { setDrag(false); window.removeEventListener("pointerup", up); };
        window.addEventListener("pointerup", up);
      }} />
  );
}

function useLibraryWidth(savedWidth?: number | null) {
  const reportError = useErrorReporter();
  const [w, setW] = useState(() => {
    const s = Number(localStorage.getItem("libW"));
    return s >= 240 && s <= 520 ? s : 300;
  });
  const wRef = useRef(w); wRef.current = w;
  useEffect(() => {
    if (savedWidth != null) setW(Math.min(520, Math.max(240, savedWidth)));
  }, [savedWidth]);
  const onPointerDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = w;
    const move = (ev: PointerEvent) => setW(Math.min(520, Math.max(240, w0 + ev.clientX - x0)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      void api.setLibraryWidth(Math.round(wRef.current)).catch(e => reportError(`Could not save sidebar width: ${e}`));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return { w, onPointerDown };
}

function ProfileRow({ profile, folderExe, openExes, selected, onSelect, onToggleArmed, onContext }: {
  profile: Profile; folderExe: string; openExes: Set<string>; selected: boolean;
  onSelect: () => void; onToggleArmed: (a: boolean) => void; onContext: (e: ReactMouseEvent) => void;
}) {
  return (
    <button
      className={`profile-row ${selected ? "profile-row--active" : ""} ${profile.armed ? "profile-row--armed" : ""}`}
      onClick={onSelect} onContextMenu={onContext} title={profile.name}>
      <StatusDot armed={profile.armed} active={profileAppActive(folderExe, openExes)} />
      <span className="profile-row__name">{profile.name || "Untitled"}</span>
      <ArmSwitch armed={profile.armed} onChange={onToggleArmed} />
    </button>
  );
}

function FolderGroup({ folder, openExes, open, selectedProfileId, visibleProfiles, onToggle, onSelectProfile, onToggleArmed, onProfileContext, onFolderContext, onModal }: {
  folder: Scope; openExes: Set<string>; open: boolean; selectedProfileId?: string;
  visibleProfiles: Profile[];
  onToggle: () => void; onSelectProfile: (id: string) => void; onToggleArmed: (pid: string, a: boolean) => void;
  onProfileContext: (e: ReactMouseEvent, folderId: string, profile: Profile) => void;
  onFolderContext: (e: ReactMouseEvent, folder: Scope) => void;
  onModal: (m: Modal) => void;
}) {
  const newProfile = (kind: ProfileKind) => onModal({ type: "profileSettings", gameId: folder.id, profile: blankProfile(kind), isNew: true });
  return (
    <div className={`folder-group ${open ? "folder-group--open" : ""}`}>
      <div className="folder-group__head-row" onContextMenu={e => onFolderContext(e, folder)}>
        <button className="folder-group__head" onClick={onToggle}>
          <span className="folder-group__caret"><Icon name="chevron-right" /></span>
          <span className="folder-group__name">{folder.name || "Unnamed"}</span>
        </button>
        <IconButton icon="plus" label="New profile" className="icon-btn" onClick={() => newProfile("hotkeys")} />
      </div>
      {open && visibleProfiles.length > 0 && (
        <div className="folder-group__profiles">
          {visibleProfiles.map(p => (
            <ProfileRow key={p.id} profile={p} folderExe={folder.exe} openExes={openExes} selected={p.id === selectedProfileId}
              onSelect={() => onSelectProfile(p.id)} onToggleArmed={a => onToggleArmed(p.id, a)}
              onContext={e => onProfileContext(e, folder.id, p)} />
          ))}
        </div>
      )}
    </div>
  );
}

function Library({ db, openExes, selection, query, collapsed, width, onQuery, onToggleCollapse, onSelect, onToggleArmed, onProfileContext, onFolderContext, onDb, onModal }: {
  db: Database; openExes: Set<string>; selection: Selection;
  query: string; collapsed: Set<string>; width: number;
  onQuery: (s: string) => void; onToggleCollapse: (id: string) => void;
  onSelect: (s: Selection) => void; onToggleArmed: (pid: string, armed: boolean) => void;
  onProfileContext: (e: ReactMouseEvent, folderId: string, profile: Profile) => void;
  onFolderContext: (e: ReactMouseEvent, folder: Scope) => void;
  onDb: (db: Database) => void; onModal: (m: Modal) => void;
}) {
  const reportError = useErrorReporter();
  const q = query.trim().toLowerCase();
  const filtering = q !== "";
  const match = (p: Profile, folder: Scope) =>
    q === "" || p.name.toLowerCase().includes(q) || folder.exe.toLowerCase().includes(q) || folder.name.toLowerCase().includes(q);
  const selectedProfileId = selection.kind === "profile" ? selection.profileId : undefined;

  const groups = [...db.scopes]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(f => ({ f, visible: f.profiles.filter(p => match(p, f)) }))
    .filter(g => !filtering || g.visible.length > 0);

  return (
    <aside className="library" style={{ width }}>
      <div className="library__header">
        <input className="library__search" placeholder="Search profiles…" value={query} onChange={e => onQuery(e.target.value)} />
      </div>
      <div className="library__list">
        {groups.map(({ f, visible }) => (
          <FolderGroup key={f.id} folder={f} openExes={openExes}
            open={!collapsed.has(f.id) || filtering} selectedProfileId={selectedProfileId} visibleProfiles={visible}
            onToggle={() => onToggleCollapse(f.id)}
            onSelectProfile={pid => onSelect({ kind: "profile", folderId: f.id, profileId: pid })}
            onToggleArmed={onToggleArmed} onProfileContext={onProfileContext} onFolderContext={onFolderContext} onModal={onModal} />
        ))}
        {db.scopes.length === 0 && <div className="library__empty">No folders yet</div>}
        {db.scopes.length > 0 && groups.length === 0 && <div className="library__empty">No matches</div>}
      </div>
      <div className="library__footer">
        <IconButton icon="folder-plus" label="New folder" className="btn btn--ghost btn--full" onClick={() => onModal({ type: "addGame" })} />
        <IconButton icon="file-import" label="Import folder" className="btn btn--ghost btn--full" onClick={async () => {
          try {
            const scopes = await importScope();
            if (!scopes) return;
            let updated: Database | null = null;
            for (const scope of scopes) updated = await api.upsertGame(scope);
            if (updated) onDb(updated);
          } catch (e) { reportError(e); }
        }} />
        <IconButton icon="gear" label="Settings" className={`btn btn--ghost btn--full ${selection.kind === "settings" ? "btn--primary" : ""}`} onClick={() => onSelect({ kind: "settings" })} />
      </div>
    </aside>
  );
}

/** Edit a folder's shared app target, name, and optional image. */
function FolderModal({ initial, onSave, onClose }: {
  initial: Scope;
  onSave: (g: Scope) => void;
  onClose: () => void;
}) {
  const reportError = useErrorReporter();
  const [name, setName] = useState(initial.name);
  const [image, setImage] = useState<string | null>(initial.image);
  const globalFolder = initial.id === GLOBAL_FOLDER_ID;
  const startedGlobal = globalFolder || isGlobalExe(initial.exe);
  const [anyApp, setAnyApp] = useState(startedGlobal);
  const [exe, setExe] = useState(startedGlobal ? "" : initial.exe);
  const [openExes, setOpenExes] = useState<string[]>([]);

  useEffect(() => { api.listOpenExecutables().then(setOpenExes).catch(() => {}); }, []);

  async function browseImage() {
    const selected = await openDialog({
      title: "Select Folder Image",
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif", "ico"] }],
      multiple: false,
      directory: false,
    });
    if (!selected) return;
    try {
      setImage(await api.readImageAsDataUrl(selected as string));
    } catch (e) {
      reportError(`Failed to load image: ${e}`);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{initial.name ? "Edit Folder" : "New Folder"}</h2>
        <div className="image-picker" onClick={browseImage}>
          {image
            ? <img src={image} alt="folder" className="image-picker__preview" />
            : <Placeholder />}
        </div>
        {image && (
          <IconButton icon="trash-can" label="Remove image"  className="btn btn--ghost btn--sm" style={{ alignSelf: "flex-start" }} onClick={e => { e.stopPropagation(); setImage(null); }} />
        )}
        <input className="modal-name" value={name} onChange={e => setName(e.target.value)} placeholder="Folder name" autoFocus />
        <label className="checkbox-row">
          <input type="checkbox" checked={anyApp} disabled={globalFolder}
            onChange={e => setAnyApp(e.target.checked)} />
          <span>Any app</span>
        </label>
        {!anyApp && (
          <div className="form-grid form-grid--2">
            <label>Target app <input value={exe} onChange={e => setExe(e.target.value)} placeholder="game.exe" /></label>
            <label>Open apps <select value="" onChange={e => { if (e.target.value) setExe(e.target.value); }}>
              <option value="">Choose app…</option>
              {openExes.map(exeName => <option key={exeName} value={exeName}>{exeName}</option>)}
            </select></label>
          </div>
        )}
        <div className="modal__actions">
          <IconButton icon="arrow-left" label="Cancel" className="btn btn--secondary" onClick={onClose} />
          <IconButton icon="check" label="Save" className="btn btn--primary" onClick={() => onSave({
            ...initial,
            name,
            exe: globalFolder || anyApp ? GLOBAL_EXE : exe.trim(),
            image,
          })} />
        </div>
      </div>
    </div>
  );
}

/** Edit profile-owned options. The application target is owned by the containing folder. */
function ProfileSettingsModal({ initial, isNew, onSave, onClose }: {
  initial: Profile;
  isNew: boolean;
  onSave: (p: Profile) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [overlayOn, setOverlayOn] = useState(!initial.overlay_disabled);
  const [toggleHotkeysKey, setToggleHotkeysKey] = useState(initial.toggle_hotkeys_key ?? "");
  const [toggleOverlayKey, setToggleOverlayKey] = useState(initial.toggle_overlay_key ?? "");

  function build(): Profile {
    return {
      ...initial,
      name: name.trim(),
      overlay_disabled: !overlayOn,
      toggle_hotkeys_key: toggleHotkeysKey || null,
      toggle_overlay_key: toggleOverlayKey || null,
    };
  }


  return (
    <div className="modal-overlay">
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{isNew ? "New Profile" : "Profile"}</h2>
        <input className="modal-name" value={name} onChange={e => setName(e.target.value)} placeholder="Profile name" autoFocus />
        <label className="checkbox-row">
          <input type="checkbox" checked={overlayOn} onChange={e => setOverlayOn(e.target.checked)} />
          <span>Show overlay</span>
        </label>
        <KeyInput value={toggleHotkeysKey} onChange={setToggleHotkeysKey} placeholder="Enable-hotkeys key" allowChord />
        <KeyInput value={toggleOverlayKey} onChange={setToggleOverlayKey} placeholder="Toggle-overlay key" allowChord />
        <div className="modal__actions">
          <IconButton icon="arrow-left" label="Cancel" className="btn btn--secondary" onClick={onClose} />
          <IconButton icon="check" label="Save" className="btn btn--primary" onClick={() => onSave(build())} disabled={!name.trim()} />
        </div>
      </div>
    </div>
  );
}

// ── Step types & helpers ──────────────────────────────────────────────────────

const BEHAVIOR_EVENTS: Array<{ value: BehaviorEventKind; label: string }> = [
  { value: "app_started", label: "App started" },
  { value: "window_ready", label: "Window ready" },
  { value: "focus_gained", label: "Focus gained" },
  { value: "focus_lost", label: "Focus lost" },
  { value: "app_stopped", label: "App stopped" },
];

function behaviorEventLabel(event: BehaviorEventKind): string {
  return BEHAVIOR_EVENTS.find(candidate => candidate.value === event)?.label ?? event;
}

// ── Step sub-components ───────────────────────────────────────────────────────

function HotkeyModal({ initial, gameExe, states, overlays, scripts, onSave, onClose }: {
  initial: Hotkey;
  gameExe: string;
  states: ProfileState[];
  overlays: OverlayTarget[];
  scripts: Script[];
  onSave: (hk: Hotkey) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [trigger, setTrigger] = useState(initial.trigger);
  const [allowExtraModifiers, setAllowExtraModifiers] = useState(() => allowsExtraModifiers(initial));
  const [recordingTrigger, setRecordingTrigger] = useState(false);
  const [steps, setSteps] = useState<Step[]>(() => {
    const parsed = parseSteps(initial.behavior);
    if (initial.state_id) {
      return [...parsed, { type: "state", stateId: initial.state_id }];
    }
    return parsed.length || initial.trigger ? parsed : [{ type: "press", key: "" }];
  });

  useBindingRecorder(recordingTrigger, key => {
    setTrigger(key);
    setRecordingTrigger(false);
  }, true);

  return (
    <div className="modal-overlay">
      <div className="modal modal--wide" onClick={e => e.stopPropagation()}>
        <h2>{initial.trigger ? "Edit Hotkey" : "Add Hotkey"}</h2>

        <input className="modal-name" value={name} onChange={e => setName(e.target.value)} placeholder="Name" autoFocus />

        <div className="input-row">
          {recordingTrigger
            ? <div className="key-recording">Hold the key/button combination, then release…</div>
            : <input value={trigger} onChange={e => setTrigger(e.target.value)} placeholder="Trigger" />
          }
          <IconButton showLabel icon={recordingTrigger ? "arrow-left" : "keyboard"} label={recordingTrigger ? "Cancel recording" : "Record hotkey"} className="btn btn--ghost btn--sm" onClick={() => setRecordingTrigger(r => !r)} />
        </div>

        <label className="checkbox-row">
          <input type="checkbox" checked={allowExtraModifiers} onChange={e => setAllowExtraModifiers(e.target.checked)} />
          <span>Allow extra modifiers</span>
        </label>

        <BehaviorStepsEditor steps={steps} gameExe={gameExe} states={states} overlays={overlays} scripts={scripts} onChange={setSteps} />

        <div className="modal__actions">
          <IconButton icon="arrow-left" label="Cancel" className="btn btn--secondary" onClick={onClose} />
          <IconButton icon="check" label="Save" className="btn btn--primary" disabled={!areStepsValid(steps)} onClick={() => trigger.trim() && areStepsValid(steps) && onSave({ name: name.trim(), trigger: trigger.trim(), behavior: stepsToString(steps), allow_extra_modifiers: allowExtraModifiers, state_id: null })} />
        </div>
      </div>
    </div>
  );
}

function EventModal({ initial, eventKinds, gameExe, states, overlays, scripts, onSave, onClose }: {
  initial: BehaviorEvent;
  eventKinds: BehaviorEventKind[];
  gameExe: string;
  states: ProfileState[];
  overlays: OverlayTarget[];
  scripts: Script[];
  onSave: (event: BehaviorEvent) => void;
  onClose: () => void;
}) {
  const [event, setEvent] = useState(initial.event);
  const [steps, setSteps] = useState<Step[]>(() => initial.behavior ? parseSteps(initial.behavior) : [{ type: "press", key: "" }]);
  const behavior = stepsToString(steps);

  return (
    <div className="modal-overlay">
      <div className="modal modal--wide" onClick={e => e.stopPropagation()}>
        <h2>{initial.behavior ? "Edit Event" : "Add Event"}</h2>
        <select value={event} onChange={e => setEvent(e.target.value as BehaviorEventKind)} autoFocus>
          {BEHAVIOR_EVENTS.filter(candidate => eventKinds.includes(candidate.value)).map(candidate => (
            <option key={candidate.value} value={candidate.value}>{candidate.label}</option>
          ))}
        </select>
        <BehaviorStepsEditor steps={steps} gameExe={gameExe} states={states} overlays={overlays} scripts={scripts} onChange={setSteps} />
        <div className="modal__actions">
          <IconButton icon="arrow-left" label="Cancel" className="btn btn--secondary" onClick={onClose} />
          <IconButton icon="check" label="Save" className="btn btn--primary" disabled={!behavior || !areStepsValid(steps)} onClick={() => behavior && areStepsValid(steps) && onSave({ event, behavior })} />
        </div>
      </div>
    </div>
  );
}

function SetParentModal({ profiles, current, onSave, onClose }: {
  profiles: Profile[];
  current: Profile;
  onSave: (parentId: string | null) => void;
  onClose: () => void;
}) {
  const [parentId, setParentId] = useState(current.parent_id ?? "");
  const options = profiles.filter(p => p.id !== current.id);
  return (
    <div className="modal-overlay">
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Set Parent Profile</h2>
        <select value={parentId} onChange={e => setParentId(e.target.value)}>
          <option value="">Don't inherit</option>
          {options.map(p => <option key={p.id} value={p.id}>Inherit from {p.name}</option>)}
        </select>
        <div className="modal__actions">
          <IconButton icon="arrow-left" label="Cancel" className="btn btn--secondary" onClick={onClose} />
          <IconButton icon="check" label="Save" className="btn btn--primary" onClick={() => onSave(parentId || null)} />
        </div>
      </div>
    </div>
  );
}

function CopyProfileModal({ games, sourceProfile, onSave, onClose }: {
  games: Scope[];
  sourceProfile: Profile;
  onSave: (targetGameId: string, name: string) => void;
  onClose: () => void;
}) {
  const [targetGameId, setTargetGameId] = useState(games[0]?.id ?? "");
  const [name, setName] = useState(`${sourceProfile.name} (copy)`);
  return (
    <div className="modal-overlay">
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Copy Profile</h2>
        <select value={targetGameId} onChange={e => setTargetGameId(e.target.value)}>
          {[...games].sort((a, b) => a.name.localeCompare(b.name)).map(g => (
            <option key={g.id} value={g.id}>Copy to {g.name}</option>
          ))}
        </select>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Profile name" />
        <div className="modal__actions">
          <IconButton icon="arrow-left" label="Cancel" className="btn btn--secondary" onClick={onClose} />
          <IconButton icon="copy" label="Copy" className="btn btn--primary" onClick={() => targetGameId && name.trim() && onSave(targetGameId, name.trim())} />
        </div>
      </div>
    </div>
  );
}

function CopyToProfileModal({
  games,
  title,
  sourceGameId,
  sourceProfileId,
  onSave,
  onClose,
  folderOnly = false,
}: {
  folderOnly?: boolean;
  games: Scope[];
  title: string;
  sourceGameId: string;
  sourceProfileId: string;
  onSave: (targetGameId: string, targetProfileId: string) => void;
  onClose: () => void;
}) {
  const [targetGameId, setTargetGameId] = useState(sourceGameId);
  const targetProfiles = [...(games.find(game => game.id === targetGameId)?.profiles ?? [])]
    .sort((a, b) => a.name.localeCompare(b.name));
  const [targetProfileId, setTargetProfileId] = useState(sourceProfileId);

  useEffect(() => {
    if (targetProfiles.some(profile => profile.id === targetProfileId)) return;
    setTargetProfileId(targetProfiles[0]?.id ?? "");
  }, [targetProfileId, targetProfiles]);

  return (
    <div className="modal-overlay">
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{title}</h2>
        <select value={targetGameId} onChange={e => setTargetGameId(e.target.value)}>
          {[...games].sort((a, b) => a.name.localeCompare(b.name)).map(game => (
            <option key={game.id} value={game.id}>Copy to {game.name}</option>
          ))}
        </select>
        {!folderOnly && <select value={targetProfileId} onChange={e => setTargetProfileId(e.target.value)} disabled={targetProfiles.length === 0}>
          {targetProfiles.map(profile => (
            <option key={profile.id} value={profile.id}>Into {profile.name}</option>
          ))}
          {targetProfiles.length === 0 && <option value="">No profiles</option>}
        </select>}
        <div className="modal__actions">
          <IconButton icon="arrow-left" label="Cancel" className="btn btn--secondary" onClick={onClose} />
          <IconButton icon="copy" label="Copy" className="btn btn--primary" onClick={() => targetGameId && (folderOnly || targetProfileId) && onSave(targetGameId, targetProfileId)} disabled={!targetGameId || (!folderOnly && !targetProfileId)} />
        </div>
      </div>
    </div>
  );
}

// ── Overlay components ────────────────────────────────────────────────────────

function overlayItemDesc(item: OverlayItem, states: ProfileState[]): string {
  const pos = `(${item.x}, ${item.y})`;
  const stateLabel = stateNameById(states, item.state_id);
  const stateText = stateLabel ? `, visible with ${stateLabel}` : "";
  switch (item.type) {
    case "timer": {
      const m = Math.floor(item.duration_ms / 60000);
      const s = String(Math.floor((item.duration_ms % 60000) / 1000)).padStart(2, "0");
      const timerStateLabel = stateNameById(states, item.timer_state_id);
      const timerText = timerStateLabel ? `, reads ${timerStateLabel} timer` : "";
      return `${m}:${s}, ${item.font_size}px at ${pos}${stateText}${timerText}`;
    }
    case "icon":  return `${item.w}x${item.h} at ${pos}${stateText}`;
    case "bar":   return `${item.w}x${item.h} max ${item.max_value} at ${pos}${stateText}`;
    case "text":  return `"${item.content}" ${item.font_size}px at ${pos}${stateText}`;
  }
}

function stateDesc(state: ProfileState): string {
  return state.duration_ms ? `${formatDuration(state.duration_ms)}` : `toggle`;
}

function copyName(name: string, fallback: string) {
  const base = name.trim() || fallback;
  return `${base} (copy)`;
}

function hotkeyLabel(hotkey: Hotkey): string {
  return hotkey.name.trim() ? `${hotkey.name} - hotkey` : "hotkey";
}

function behaviorDesc(behavior: string, states: ProfileState[], overlays: OverlayTarget[]): string {
  return describeBehavior(behavior, id => stateNameById(states, id) ?? id, id => {
    const item = overlays.find(item => item.id === id);
    return item ? item.name || (item.type === "group" ? "Overlay" : item.type) : "Missing overlay";
  });
}

function hotkeyDesc(hotkey: Hotkey, states: ProfileState[], overlays: OverlayTarget[]): string {
  return behaviorDesc(hotkey.behavior, states, overlays);
}

function HotkeyRow({ hotkey, states, overlays, inherited, onEdit, onCopy, onDelete, onOverride }: {
  hotkey: Hotkey;
  states: ProfileState[];
  overlays: OverlayTarget[];
  inherited: boolean;
  onEdit?: () => void;
  onCopy?: () => void;
  onDelete?: () => void;
  onOverride?: () => void;
}) {
  return (
    <div className={`step-row${inherited ? " step-row--muted" : ""}`}>
      <span className="overlay-type-badge overlay-type-badge--text">{hotkeyLabel(hotkey)}</span>
      <span className="hotkey-row__trigger">{hotkey.trigger}</span>
      <span className="overlay-item-desc">{hotkeyDesc(hotkey, states, overlays)}</span>
      <div className="step-row__btns">
        {inherited ? (
          <>
            <IconButton icon="copy" label="Copy" className="icon-btn" onClick={onCopy} />
            <IconButton icon="pen" label="Override" className="icon-btn" onClick={onOverride} />
          </>
        ) : (
          <>
            <IconButton icon="pen" label="Edit" className="icon-btn" onClick={onEdit} />
            <IconButton icon="copy" label="Copy" className="icon-btn" onClick={onCopy} />
            <IconButton icon="trash-can" label="Delete" className="icon-btn icon-btn--danger" onClick={onDelete} />
          </>
        )}
      </div>
    </div>
  );
}

function EventRow({ event, states, overlays, inherited, onEdit, onDelete, onOverride }: {
  event: BehaviorEvent;
  states: ProfileState[];
  overlays: OverlayTarget[];
  inherited: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onOverride?: () => void;
}) {
  return (
    <div className={`step-row${inherited ? " step-row--muted" : ""}`}>
      <span className="overlay-type-badge overlay-type-badge--text">{behaviorEventLabel(event.event)}</span>
      <span className="overlay-item-desc">{behaviorDesc(event.behavior, states, overlays)}</span>
      <div className="step-row__btns">
        {inherited ? (
          <IconButton icon="pen" label="Override" className="icon-btn" onClick={onOverride} />
        ) : (
          <>
            <IconButton icon="pen" label="Edit" className="icon-btn" onClick={onEdit} />
            <IconButton icon="trash-can" label="Delete" className="icon-btn icon-btn--danger" onClick={onDelete} />
          </>
        )}
      </div>
    </div>
  );
}

function OverlayItemRow({ item, states, inherited, onEdit, onDelete, onOverride, onMove, first, last }: {
  item: OverlayItem;
  states: ProfileState[];
  inherited: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onOverride?: () => void;
  onMove?: (direction: -1 | 1) => void;
  first?: boolean;
  last?: boolean;
}) {
  return (
    <div className={`step-row${inherited ? " step-row--muted" : ""}`}>
      <span className={`overlay-type-badge overlay-type-badge--${item.type}`}>{item.name}</span>
      <span className="overlay-item-desc">{overlayItemDesc(item, states)}</span>
      <div className="step-row__btns">
        {onMove && <>
          <IconButton icon="arrow-up" label="Move up"  className="icon-btn" disabled={first} onClick={() => onMove(-1)} />
          <IconButton icon="arrow-down" label="Move down"  className="icon-btn" disabled={last} onClick={() => onMove(1)} />
        </>}
        {inherited ? (
          <IconButton icon="pen" label="Override" className="icon-btn" onClick={onOverride} />
        ) : (
          <>
            <IconButton icon="pen" label="Edit" className="icon-btn" onClick={onEdit} />
            <IconButton icon="trash-can" label="Delete" className="icon-btn icon-btn--danger" onClick={onDelete} />
          </>
        )}
      </div>
    </div>
  );
}

function StateRow({ state, inherited, onEdit, onCopy, onDelete, onOverride }: {
  state: ProfileState;
  inherited: boolean;
  onEdit?: () => void;
  onCopy?: () => void;
  onDelete?: () => void;
  onOverride?: () => void;
}) {
  return (
    <div className={`step-row${inherited ? " step-row--muted" : ""}`}>
      <span className="overlay-type-badge overlay-type-badge--text">{state.name} - state</span>
      <span className="overlay-item-desc">{stateDesc(state)}</span>
      <div className="step-row__btns">
        {inherited ? (
          <>
            <IconButton icon="copy" label="Copy" className="icon-btn" onClick={onCopy} />
            <IconButton icon="pen" label="Override" className="icon-btn" onClick={onOverride} />
          </>
        ) : (
          <>
            <IconButton icon="pen" label="Edit" className="icon-btn" onClick={onEdit} />
            <IconButton icon="copy" label="Copy" className="icon-btn" onClick={onCopy} />
            <IconButton icon="trash-can" label="Delete" className="icon-btn icon-btn--danger" onClick={onDelete} />
          </>
        )}
      </div>
    </div>
  );
}

function OverlayItemModal({ initial, gameExe, states, groups, timers, onSave, onClose }: {
  initial: OverlayItem;
  gameExe: string;
  states: ProfileState[];
  groups: OverlayGroup[];
  timers: OverlayItem[];
  onSave: (item: OverlayItem) => void;
  onClose: () => void;
}) {
  const reportError = useErrorReporter();
  const [x, setX] = useState(String(initial.x));
  const [y, setY] = useState(String(initial.y));
  const [stateId, setStateId] = useState(initial.state_id ?? "");
  const [groupId, setGroupId] = useState(initial.group_id ?? "");
  const [visibleTimerId, setVisibleTimerId] = useState(initial.visible_while_timer_id ?? "");

  const [mins, setMins]         = useState(String(initial.type === "timer" ? Math.floor(initial.duration_ms / 60000) : 1));
  const [secs, setSecs]         = useState(String(initial.type === "timer" ? Math.floor((initial.duration_ms % 60000) / 1000) : 0));
  const [timerColor, setTimerColor] = useState(initial.type === "timer" ? initial.color : "#ffffff");
  const [timerFontSize, setTimerFontSize] = useState(String(initial.type === "timer" ? initial.font_size : 22));
  const [timerBackground, setTimerBackground] = useState(initial.type !== "timer" || initial.show_background !== false);
  const [timerStateId, setTimerStateId] = useState(initial.type === "timer" ? (initial.timer_state_id ?? "") : "");
  const [startWithOverlay, setStartWithOverlay] = useState(initial.type === "timer" && !!initial.start_with_overlay);
  const [showOnlyRunning, setShowOnlyRunning] = useState(initial.type === "timer" && !!initial.show_only_running);

  const [iw, setIw]             = useState(String(initial.type === "icon" ? initial.w : 64));
  const [ih, setIh]             = useState(String(initial.type === "icon" ? initial.h : 64));
  const [src, setSrc]           = useState<string | null>(initial.type === "icon" ? initial.src : null);

  const [bw, setBw]             = useState(String(initial.type === "bar" ? initial.w : 200));
  const [bh, setBh]             = useState(String(initial.type === "bar" ? initial.h : 20));
  const [barColor, setBarColor] = useState(initial.type === "bar" ? initial.color : "#4ade80");
  const [maxVal, setMaxVal]     = useState(String(initial.type === "bar" ? initial.max_value : 100));

  const [fontSize, setFontSize] = useState(String(initial.type === "text" ? initial.font_size : 16));
  const [txtColor, setTxtColor] = useState(initial.type === "text" ? initial.color : "#ffffff");
  const [content, setContent]   = useState(initial.type === "text" ? initial.content : "");

  async function browseIcon() {
    const selected = await openDialog({ title: "Select Icon", filters: [{ name: "Image", extensions: ["png","jpg","jpeg","webp","gif","ico"] }], multiple: false, directory: false });
    if (!selected) return;
    try { setSrc(await api.readImageAsDataUrl(selected as string)); } catch (e) { reportError(e); }
  }

  function build(): OverlayItem {
    const base = {
      id: initial.id,
      name: initial.name,
      x: parseFloat(x)||0,
      y: parseFloat(y)||0,
      state_id: stateId || null,
      group_id: groupId || null,
      visible_while_timer_id: visibleTimerId || null,
    };
    const timerMs = ((parseInt(mins)||0)*60 + (parseInt(secs)||0)) * 1000;
    switch (initial.type) {
      case "timer": return { ...base, type: "timer", duration_ms: timerMs||60000, color: timerColor, font_size: parseInt(timerFontSize)||22, show_background: timerBackground, timer_state_id: timerStateId || null, start_with_overlay: startWithOverlay, show_only_running: showOnlyRunning };
      case "icon":  return { ...base, type: "icon",  w: parseInt(iw)||64, h: parseInt(ih)||64, src };
      case "bar":   return { ...base, type: "bar",   w: parseInt(bw)||200, h: parseInt(bh)||20, color: barColor, max_value: parseFloat(maxVal)||100 };
      case "text":  return { ...base, type: "text",  font_size: parseInt(fontSize)||16, color: txtColor, content };
    }
  }

  const typeLabel = initial.type.charAt(0).toUpperCase() + initial.type.slice(1);

  return (
    <div className="modal-overlay">
      <div className="modal modal--overlay-item" onClick={e => e.stopPropagation()}>
        <h2>{typeLabel}</h2>

        <label>Overlay <select value={groupId} onChange={event => setGroupId(event.target.value)}>
          {groups.map(group => <option key={group.id} value={group.id}>{group.name || "Overlay"}</option>)}
        </select></label>
        <label>Show part <select value={visibleTimerId ? `@timer:${visibleTimerId}` : showOnlyRunning ? "@running" : stateId} onChange={e => {
          const timer = e.target.value.startsWith("@timer:");
          setVisibleTimerId(timer ? e.target.value.slice(7) : "");
          setShowOnlyRunning(e.target.value === "@running");
          setStateId(timer || e.target.value === "@running" ? "" : e.target.value);
        }}>
          <option value="">Always visible</option>
          {initial.type === "timer" && <option value="@running">Only while running</option>}
          {timers.filter(timer => timer.id !== initial.id).map(timer => <option key={timer.id} value={`@timer:${timer.id}`}>While {timer.name || "Timer"} is running</option>)}
          {states.map(state => (
            <option key={state.id} value={state.id}>Visible with {state.name}</option>
          ))}
        </select></label>

        {(!groupId || !groups.some(group => group.id === groupId && (group.layout === "row" || group.layout === "column"))) && <fieldset className="overlay-item-form__section">
          <legend>Position</legend>
          <GotoInput x={x} y={y} gameExe={gameExe} onChange={(nx, ny) => { setX(nx); setY(ny); }} />
        </fieldset>}

        {initial.type === "timer" && <fieldset className="overlay-item-form__section">
          <legend>Timer</legend>
          <label className="checkbox-row">
            <input type="checkbox" checked={startWithOverlay} onChange={e => setStartWithOverlay(e.target.checked)} />
            <span>Start with overlay</span>
          </label>
          <div className="form-grid form-grid--2">
            <div className="form-field" role="group" aria-label="Duration"><span>Duration</span><div className="duration-input">
              <input aria-label="Minutes" type="number" value={mins} onChange={e => setMins(e.target.value)} placeholder="min" min={0} />
              <span>m</span>
              <input aria-label="Seconds" type="number" value={secs} onChange={e => setSecs(e.target.value)} placeholder="sec" min={0} max={59} />
              <span>s</span>
            </div></div>
            <label>Font size (px) <input type="number" value={timerFontSize} onChange={e => setTimerFontSize(e.target.value)} /></label>
          </div>
          <div className="form-grid form-grid--2">
            <div className="form-field" role="group" aria-label="Timer color"><span>Color</span><div className="color-input">
              <input aria-label="Choose timer color" className="color-input__swatch" type="color" value={timerColor} onChange={e => setTimerColor(e.target.value)} />
              <input aria-label="Timer color" value={timerColor} onChange={e => setTimerColor(e.target.value)} placeholder="#RRGGBB" />
            </div></div>
            <label>Timer source <select value={timerStateId} onChange={e => setTimerStateId(e.target.value)}>
              <option value="">Use fixed duration above</option>
              {states.filter(state => !!state.duration_ms).map(state => (
                <option key={state.id} value={state.id}>Use timer from {state.name}</option>
              ))}
            </select></label>
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={timerBackground} onChange={e => setTimerBackground(e.target.checked)} />
            <span>Text background</span>
          </label>
        </fieldset>}

        {initial.type === "icon" && <fieldset className="overlay-item-form__section">
          <legend>Image</legend>
          <div className="image-picker" onClick={browseIcon}>
            {src ? (
              <img
                src={src}
                className="image-picker__preview image-picker__preview--contain"
                alt="icon"
                style={{
                  width: `${Math.max(1, parseInt(iw) || 64)}px`,
                  height: `${Math.max(1, parseInt(ih) || 64)}px`,
                }}
              />
            ) : <Placeholder />}
          </div>
          <div className="input-row">
            <IconButton showLabel icon="folder-open" label={src ? "Change image" : "Choose image"} className="btn btn--ghost btn--sm" onClick={browseIcon} />
            {src && <IconButton icon="trash-can" label="Remove image" className="btn btn--ghost btn--sm" onClick={() => setSrc(null)} />}
          </div>
          <div className="form-grid form-grid--2">
            <label>Width (px) <input type="number" value={iw} onChange={e => setIw(e.target.value)} /></label>
            <label>Height (px) <input type="number" value={ih} onChange={e => setIh(e.target.value)} /></label>
          </div>
        </fieldset>}

        {initial.type === "bar" && <fieldset className="overlay-item-form__section">
          <legend>Bar</legend>
          <div className="form-grid form-grid--3">
            <label>Width (px) <input type="number" value={bw} onChange={e => setBw(e.target.value)} /></label>
            <label>Height (px) <input type="number" value={bh} onChange={e => setBh(e.target.value)} /></label>
            <label>Maximum value <input type="number" value={maxVal} onChange={e => setMaxVal(e.target.value)} /></label>
          </div>
          <div className="form-field" role="group" aria-label="Bar color"><span>Color</span><div className="color-input">
            <input aria-label="Choose bar color" className="color-input__swatch" type="color" value={barColor} onChange={e => setBarColor(e.target.value)} />
            <input aria-label="Bar color" value={barColor} onChange={e => setBarColor(e.target.value)} placeholder="#RRGGBB" />
          </div></div>
        </fieldset>}

        {initial.type === "text" && <fieldset className="overlay-item-form__section">
          <legend>Text</legend>
          <label>Content <input value={content} onChange={e => setContent(e.target.value)} /></label>
          <div className="form-grid form-grid--2">
            <label>Font size (px) <input type="number" value={fontSize} onChange={e => setFontSize(e.target.value)} /></label>
            <div className="form-field" role="group" aria-label="Text color"><span>Color</span><div className="color-input">
              <input aria-label="Choose text color" className="color-input__swatch" type="color" value={txtColor} onChange={e => setTxtColor(e.target.value)} />
              <input aria-label="Text color" value={txtColor} onChange={e => setTxtColor(e.target.value)} placeholder="#RRGGBB" />
            </div></div>
          </div>
        </fieldset>}

        <div className="modal__actions">
          <button type="button" className="btn btn--secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn--primary" onClick={() => onSave(build())} disabled={!groupId}>Save</button>
        </div>
      </div>
    </div>
  );
}

function StateModal({ initial, onSave, onClose }: {
  initial: ProfileState;
  onSave: (state: ProfileState) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [mins, setMins] = useState(String(Math.floor((initial.duration_ms ?? 0) / 60000)));
  const [secs, setSecs] = useState(String(Math.floor(((initial.duration_ms ?? 0) % 60000) / 1000)));
  const durationMs = ((parseInt(mins) || 0) * 60 + (parseInt(secs) || 0)) * 1000;

  function build(): ProfileState {
    return {
      id: initial.id,
      name: name.trim(),
      duration_ms: durationMs > 0 ? durationMs : null,
    };
  }

  return (
    <div className="modal-overlay">
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>State</h2>

        <input className="modal-name" value={name} onChange={e => setName(e.target.value)} placeholder="State name" autoFocus />

        <div className="duration-input">
          <input type="number" value={mins} onChange={e => setMins(e.target.value)} min={0} placeholder="min" />
          <span>m</span>
          <input type="number" value={secs} onChange={e => setSecs(e.target.value)} min={0} max={59} placeholder="sec" />
          <span>s</span>
        </div>

        <div className="modal__actions">
          <IconButton icon="arrow-left" label="Cancel" className="btn btn--secondary" onClick={onClose} />
          <IconButton icon="check" label="Save" className="btn btn--primary" onClick={() => onSave(build())} disabled={!name.trim()} />
        </div>
      </div>
    </div>
  );
}

function scriptTriggerDesc(script: Script): string {
  return script.trigger === "hotkey"
    ? `hotkey: ${script.hotkey || "(unset)"}`
    : "on app launch";
}

function scriptLanguageLabel(script: Script): string {
  return script.language === "autohotkey" ? "AutoHotkey" : "Python";
}

function ScriptRow({ script, onEdit, onToggle, onDelete }: {
  script: Script;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`step-row${script.enabled ? "" : " step-row--muted"}`}>
      <span className="overlay-type-badge overlay-type-badge--text">{script.name || "Unnamed"} - script</span>
      <span className="overlay-item-desc">{scriptTriggerDesc(script)} · {scriptLanguageLabel(script)} · {script.source === "path" ? "file" : "inline"}</span>
      <div className="step-row__btns">
        <IconButton icon={script.enabled ? "toggle-on" : "toggle-off"} label={script.enabled ? "Disable script" : "Enable script"} aria-pressed={script.enabled} className="icon-btn" onClick={onToggle} />
        <IconButton icon="pen" label="Edit" className="icon-btn" onClick={onEdit} />
        <IconButton icon="trash-can" label="Delete" className="icon-btn icon-btn--danger" onClick={onDelete} />
      </div>
    </div>
  );
}

function ScriptModal({ initial, onSave, onClose }: {
  initial: Script;
  onSave: (script: Script) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [trigger, setTrigger] = useState(initial.trigger);
  const [hotkey, setHotkey] = useState(initial.hotkey);
  const [language, setLanguage] = useState(initial.language ?? "python");
  const [source, setSource] = useState(initial.source);
  const [code, setCode] = useState(initial.code);
  const [path, setPath] = useState(initial.path);

  function build(): Script {
    return { id: initial.id, name: name.trim(), enabled, trigger, hotkey, language, source, code, path: path.trim() };
  }

  async function browse() {
    const isAhk = language === "autohotkey";
    const selected = await openDialog({
      title: `Select ${isAhk ? "AutoHotkey" : "Python"} Script`,
      filters: [{ name: isAhk ? "AutoHotkey" : "Python", extensions: [isAhk ? "ahk" : "py"] }],
      multiple: false,
      directory: false,
    });
    if (selected) setPath(selected as string);
  }

  return (
    <div className="modal-overlay">
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{initial.name ? "Edit Script" : "Add Script"}</h2>

        <input className="modal-name" value={name} onChange={e => setName(e.target.value)} placeholder="Script name" autoFocus />

        <select value={trigger} onChange={e => setTrigger(e.target.value as Script["trigger"])}>
          <option value="hotkey">When a hotkey is pressed</option>
          <option value="launch">When the app is launched</option>
        </select>

        {trigger === "hotkey" && (
          <KeyInput value={hotkey} onChange={setHotkey} placeholder="Hotkey" allowChord />
        )}

        <select value={language} onChange={e => setLanguage(e.target.value as Script["language"])}>
          <option value="python">Python</option>
          <option value="autohotkey">AutoHotkey v2</option>
        </select>

        <select value={source} onChange={e => setSource(e.target.value as Script["source"])}>
          <option value="code">Inline code</option>
          <option value="path">Path to a .{language === "autohotkey" ? "ahk" : "py"} file</option>
        </select>

        {source === "code" ? (
          <textarea value={code} onChange={e => setCode(e.target.value)} rows={12} spellCheck={false}
            style={{ fontFamily: "monospace", resize: "vertical" }}
            placeholder={language === "autohotkey" ? '#Requires AutoHotkey v2.0\nMsgBox "Hello"' : "print('hello')"} />
        ) : (
          <div className="input-row">
            <input value={path} onChange={e => setPath(e.target.value)}
              placeholder={`C:\\path\\to\\script.${language === "autohotkey" ? "ahk" : "py"}`} />
            <IconButton showLabel icon="folder-open" label="Browse…" className="btn btn--ghost" onClick={browse} />
          </div>
        )}

        <label className="checkbox-row">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          <span>Enabled</span>
        </label>

        <div className="modal__actions">
          <IconButton icon="arrow-left" label="Cancel" className="btn btn--secondary" onClick={onClose} />
          <IconButton icon="check" label="Save" className="btn btn--primary" onClick={() => onSave(build())} disabled={!name.trim()} />
        </div>
      </div>
    </div>
  );
}

// ── Game detail view ──────────────────────────────────────────────────────────

function ProfileEditor({ folder, profile, showStates, onContext, onDb, onModal }: {
  folder: Scope;
  profile: Profile;
  showStates: boolean;
  onContext: (e: ReactMouseEvent) => void;
  onDb: (db: Database) => void;
  onModal: (m: Modal) => void;
}) {
  const reportError = useErrorReporter();
  const profileId = profile.id;
  const profileExe = folder.exe;
  const eventTargetAvailable = hasSpecificAppTarget(profileExe);

  async function setArmed(armed: boolean) {
    try { onDb(await api.setProfileArmed(profile.id, armed)); } catch (e) { reportError(e); }
  }
  async function saveProfile(updated: Profile) {
    onDb(await api.upsertProfile(folder.id, updated));
  }
  function setSectionEnabled(part: "hotkeys" | "events" | "scripts" | "overlay", value: boolean) {
    api.setProfilePartEnabled(profile.id, part, value).then(onDb).catch(error => reportError(error));
  }
  async function setStatesEnabled(value: boolean) {
    try { onDb(await api.setProfilePartEnabled(profile.id, "states", value)); }
    catch (error) { reportError(error); }
  }
  async function deleteHotkey(index: number) {
    onDb(await api.upsertProfile(folder.id, { ...profile, hotkeys: profile.hotkeys.filter((_, i) => i !== index) }));
  }
  async function deleteEvent(index: number) {
    onDb(await api.upsertProfile(folder.id, { ...profile, events: profile.events.filter((_, i) => i !== index) }));
  }
  async function saveScripts(scripts: Script[]) {
    try {
      let next = { ...folder, profiles: folder.profiles.map(candidate => candidate.id === profile.id ? { ...profile, scripts } : candidate) };
      for (const removed of profile.scripts.filter(script => !scripts.some(candidate => candidate.id === script.id))) next = removeScriptReferences(next, removed.id);
      onDb(await api.upsertGame(next));
    } catch (e) { reportError(e); }
  }

  const resolvedHotkeys = resolveHotkeys(folder.profiles, profile);
  const resolvedEvents = resolveEvents(folder.profiles, profile);
  const resolvedStates = folder.states.map(state => ({ state, own: true }));
  const resolvedOverlayItems = resolveOverlayItems(folder.profiles, profile);
  const stateOptions = folder.states;
  const groups = resolveOverlayGroups(folder.profiles, profile);
  const overlayOptions = availableOverlayTargets(folder.profiles, resolvedOverlayItems.map(({ item }) => item), groups);
  function addOverlay(type: OverlayItem["type"], groupId: string) {
    const factories = { timer: blankTimer, icon: blankIcon, bar: blankBar, text: blankText };
    onModal({ type: "overlayItem", gameId: folder.id, profileId, index: null,
      item: { ...factories[type](), group_id: groupId }, gameExe: profileExe, states: stateOptions });
  }
  function renderOverlayItem({ item, own }: { item: OverlayItem; own: boolean }) {
    const ownIndex = own ? profile.overlay_items.findIndex(candidate => candidate.id === item.id) : -1;
    const siblings = profile.overlay_items.filter(candidate => (candidate.group_id ?? null) === (item.group_id ?? null));
    return <OverlayItemRow key={item.id} item={item} states={stateOptions} inherited={!own}
      onMove={own ? direction => { saveProfile(moveOverlayPart(profile, item.id, direction)).catch(error => reportError(error)); } : undefined}
      first={siblings[0]?.id === item.id} last={siblings[siblings.length - 1]?.id === item.id}
      onEdit={own ? () => onModal({ type: "overlayItem", gameId: folder.id, profileId, index: ownIndex, item, gameExe: profileExe, states: stateOptions }) : undefined}
      onDelete={own ? async () => { onDb(await api.upsertGame(removeOverlayItem(folder, profileId, item.id))); } : undefined}
      onOverride={!own ? async () => { await saveProfile({ ...profile, overlay_items: [...profile.overlay_items, { ...item }] }); } : undefined} />;
  }


  return (
    <div className="editor">
      <div className="editor__header" onContextMenu={onContext}>
        <div className="editor__title-row">
          <div className="editor__title-wrap">
            <span className="editor__title">{profile.name || "Untitled profile"}</span>
            <TargetChip exe={profileExe} />
          </div>
          <div style={{ flex: 1 }} />
          <IconButton icon="gear" label="Profile settings" className="btn btn--ghost btn--sm" onClick={() => onModal({ type: "profileSettings", gameId: folder.id, profile, isNew: false })} />
          <ArmSwitch armed={profile.armed} size="lg" onChange={setArmed} />
        </div>
      </div>

      <div className="editor__content">
        <ProfileSection title="Hotkeys" defaultExpanded enabled={!profile.hotkeys_disabled} onChange={value => setSectionEnabled("hotkeys", value)} actions={<>
<IconButton icon="plus" label="Add hotkey" className="btn btn--primary btn--sm" onClick={() => onModal({ type: "editHotkey", gameId: folder.id, profileId, index: null, hotkey: { name: "", trigger: "", behavior: "", allow_extra_modifiers: false, state_id: null }, gameExe: profileExe, states: stateOptions, overlays: overlayOptions })} />
        </>}>
            <div className="steps-list">
              {resolvedHotkeys.map(({ hotkey: hk, own }, i) => {
                const ownIndex = own ? profile.hotkeys.findIndex(h => h.trigger === hk.trigger) : -1;
                return (
                  <HotkeyRow key={i} hotkey={hk} states={stateOptions} overlays={overlayOptions} inherited={!own}
                    onEdit={() => onModal({ type: "editHotkey", gameId: folder.id, profileId, index: ownIndex, hotkey: hk, gameExe: profileExe, states: stateOptions, overlays: overlayOptions })}
                    onCopy={() => onModal({ type: "copyHotkey", sourceGameId: folder.id, sourceProfileId: profileId, hotkey: hk })}
                    onDelete={() => deleteHotkey(ownIndex)}
                    onOverride={() => saveProfile({ ...profile, hotkeys: [...profile.hotkeys, { ...hk }] })} />
                );
              })}
              {resolvedHotkeys.length === 0 && <div className="steps-empty">No hotkeys yet</div>}
            </div>

        </ProfileSection>
        <ProfileSection title="Events" defaultExpanded enabled={!profile.events_disabled} onChange={value => setSectionEnabled("events", value)} actions={<>
<IconButton icon="plus" label="Add event" className="btn btn--primary btn--sm" disabled={!eventTargetAvailable || profile.events.length >= BEHAVIOR_EVENTS.length} onClick={() => {
                  const eventKinds = BEHAVIOR_EVENTS.map(candidate => candidate.value)
                    .filter(event => !profile.events.some(existing => existing.event === event));
                  if (eventKinds.length === 0) return;
                  onModal({ type: "editEvent", gameId: folder.id, profileId, index: null,
                    event: { event: eventKinds[0], behavior: "" }, eventKinds, gameExe: profileExe, states: stateOptions, overlays: overlayOptions });
                }} />
        </>}>
            {!eventTargetAvailable && <div className="steps-empty">Events require a folder with a specific app target.</div>}
            <div className="steps-list">
              {resolvedEvents.map(({ event, own }) => {
                const ownIndex = own ? profile.events.findIndex(candidate => candidate.event === event.event) : -1;
                const eventKinds = BEHAVIOR_EVENTS.map(candidate => candidate.value)
                  .filter(kind => kind === event.event || !profile.events.some((existing, index) => index !== ownIndex && existing.event === kind));
                return (
                  <EventRow key={event.event} event={event} states={stateOptions} overlays={overlayOptions} inherited={!own}
                    onEdit={own ? () => onModal({ type: "editEvent", gameId: folder.id, profileId, index: ownIndex, event, eventKinds, gameExe: profileExe, states: stateOptions, overlays: overlayOptions }) : undefined}
                    onDelete={own ? () => deleteEvent(ownIndex) : undefined}
                    onOverride={!own ? () => saveProfile({ ...profile, events: [...profile.events, { ...event }] }) : undefined} />
                );
              })}
              {resolvedEvents.length === 0 && eventTargetAvailable && <div className="steps-empty">No events yet</div>}
            </div>

        </ProfileSection>
        <ProfileSection title="Overlays" defaultExpanded enabled={!profile.overlay_disabled} onChange={value => setSectionEnabled("overlay", value)} actions={
          <IconButton icon="plus" label="Add overlay" className="btn btn--ghost btn--sm" onClick={() => saveProfile({ ...profile, overlay_groups: [...profile.overlay_groups, { id: uid(), name: "", x: 0, y: 0, layout: "row", gap: 8 }] }).catch(reportError)} />
        }>
            <div className="steps-list" style={{ marginTop: 8 }}>
              {groups.map(group => <OverlayGroupPanel key={group.id} group={group} items={resolvedOverlayItems.filter(({ own }) => own).map(({ item }) => item)} timers={availableOverlayItems(folder.profiles, resolvedOverlayItems.map(({ item }) => item), groups).filter(item => item.type === "timer")} gameExe={profileExe}
                onSave={async (next, members) => { await saveProfile(saveOverlayGroup(profile, next, members)); }}
                onEnabledChange={async value => { onDb(await api.setProfilePartEnabled(profile.id, "overlay", value, group.id)); }}
                onDuplicate={async () => { await saveProfile(duplicateOverlayGroup(profile, group, resolvedOverlayItems.map(({ item }) => item), uid)); }}
                onDelete={profile.overlay_groups.some(candidate => candidate.id === group.id) ? async () => {
                  if (!await confirmDialog(`Delete overlay "${group.name || "Overlay"}" and its parts?`)) return;
                  onDb(await api.upsertGame(removeOverlayGroup(folder, profileId, group.id)));
                } : undefined}
                onAdd={type => addOverlay(type, group.id)}
                onHotkey={() => onModal({ type: "editHotkey", gameId: folder.id, profileId, index: null,
                  hotkey: { name: group.name, trigger: "", behavior: stepsToString([{ type: "startoverlay", itemId: group.id, restart: true }]), allow_extra_modifiers: false, state_id: null },
                  gameExe: profileExe, states: stateOptions, overlays: overlayOptions })}>
                {resolvedOverlayItems.filter(({ item }) => item.group_id === group.id).map(renderOverlayItem)}
              </OverlayGroupPanel>)}
              {resolvedOverlayItems.length === 0 && groups.length === 0 && <div className="steps-empty">No overlays yet</div>}
            </div>

        </ProfileSection>
        <ProfileSection title="Scripts" enabled={!profile.scripts_disabled} onChange={value => setSectionEnabled("scripts", value)} actions={<>
<IconButton icon="plus" label="Add script" className="btn btn--primary btn--sm" onClick={() => onModal({ type: "script", gameId: folder.id, profileId, index: null, script: blankScript() })} />
        </>}>
            <div className="steps-list">
              {profile.scripts.map((script, i) => (
                <ScriptRow key={script.id} script={script}
                  onEdit={() => onModal({ type: "script", gameId: folder.id, profileId, index: i, script })}
                  onToggle={() => saveScripts(profile.scripts.map((s, idx) => idx === i ? { ...s, enabled: !s.enabled } : s))}
                  onDelete={() => saveScripts(profile.scripts.filter((_, idx) => idx !== i))} />
              ))}
              {profile.scripts.length === 0 && <div className="steps-empty">No scripts yet</div>}
            </div>

        </ProfileSection>
        <ProfileSection title="States" reveal={showStates} enabled={!folder.states_disabled} onChange={setStatesEnabled} actions={<>
<IconButton icon="plus" label="Add state" className="btn btn--primary btn--sm" onClick={() => onModal({ type: "profileState", gameId: folder.id, profileId, index: null, state: blankState() })} />
        </>}>
            <div className="steps-list">
              {resolvedStates.map(({ state, own }) => {
                const ownIndex = folder.states.findIndex(candidate => candidate.id === state.id);
                return (
                  <StateRow key={state.id} state={state} inherited={!own}
                    onEdit={own ? () => onModal({ type: "profileState", gameId: folder.id, profileId, index: ownIndex, state }) : undefined}
                    onCopy={() => onModal({ type: "copyState", sourceGameId: folder.id, sourceProfileId: profileId, state })}
                    onDelete={own ? async () => {
                      onDb(await api.upsertGame(removeProfileState(folder, profileId, state.id)));
                    } : undefined}
                    />
                );
              })}
              {resolvedStates.length === 0 && <div className="steps-empty">No states yet</div>}
            </div>

        </ProfileSection>
      </div>
    </div>
  );
}

// ── Settings view ─────────────────────────────────────────────────────────────

function SettingsView({ db, onDb, onCheckUpdates }: {
  db: Database;
  onDb: (db: Database) => void;
  onCheckUpdates: () => Promise<string | null>;
}) {
  const reportError = useErrorReporter();
  const [ahkExe, setAhkExe] = useState(db.settings.ahk_exe);
  const [pythonExe, setPythonExe] = useState(db.settings.python_exe ?? "");
  const [openToTray, setOpenToTray] = useState(db.settings.open_to_tray);
  const [closeToTray, setCloseToTray] = useState(db.settings.close_to_tray);
  const [launchOnStartup, setLaunchOnStartup] = useState(db.settings.launch_on_startup);
  const [saved, setSaved] = useState(false);
  const [checking, setChecking] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  useEffect(() => {
    setAhkExe(db.settings.ahk_exe);
    setPythonExe(db.settings.python_exe ?? "");
    setOpenToTray(db.settings.open_to_tray);
    setCloseToTray(db.settings.close_to_tray);
    setLaunchOnStartup(db.settings.launch_on_startup);
  }, [db.settings.ahk_exe, db.settings.python_exe, db.settings.open_to_tray, db.settings.close_to_tray, db.settings.launch_on_startup]);

  async function checkForUpdates() {
    setChecking(true);
    setUpdateStatus(null);
    try {
      const latest = await onCheckUpdates();
      setUpdateStatus(latest ? `Update ${latest} is available.` : "You're up to date.");
    } catch (error) {
      reportError(`Could not check for updates: ${error}`);
    }
    setChecking(false);
  }

  async function browse() {
    const selected = await openDialog({
      title: "Select AutoHotkey Executable",
      filters: [{ name: "Executable", extensions: ["exe"] }],
      multiple: false,
      directory: false,
    });
    if (selected) setAhkExe(selected as string);
  }

  async function browsePython() {
    const selected = await openDialog({
      title: "Select Python Executable",
      filters: [{ name: "Executable", extensions: ["exe"] }],
      multiple: false,
      directory: false,
    });
    if (selected) setPythonExe(selected as string);
  }

  async function save() {
    try {
      const updated = await api.saveSettings({
        ...db.settings,
        ahk_exe: ahkExe,
        python_exe: pythonExe,
        open_to_tray: openToTray,
        close_to_tray: closeToTray,
        launch_on_startup: launchOnStartup,
      });
      onDb(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { reportError(`Error saving settings: ${e}`); }
  }

  return (
    <div className="settings-view">
      <h2>Settings</h2>
      <div className="input-row">
        <input value={ahkExe} onChange={e => setAhkExe(e.target.value)} placeholder="AutoHotkey v2 executable path" />
        <IconButton showLabel icon="folder-open" label="Browse…" className="btn btn--ghost" onClick={browse} />
      </div>
      <div className="input-row">
        <input value={pythonExe} onChange={e => setPythonExe(e.target.value)} placeholder="Python executable path" />
        <IconButton showLabel icon="folder-open" label="Browse…" className="btn btn--ghost" onClick={browsePython} />
      </div>
      <label className="checkbox-row">
        <input type="checkbox" checked={openToTray} onChange={e => setOpenToTray(e.target.checked)} />
        <span>Open to tray</span>
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={closeToTray} onChange={e => setCloseToTray(e.target.checked)} />
        <span>Close to tray</span>
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={launchOnStartup} onChange={e => setLaunchOnStartup(e.target.checked)} />
        <span>Launch on startup</span>
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <IconButton icon="check" label="Save" className="btn btn--primary" onClick={save} />
        {saved && <span style={{ color: "var(--success)", fontSize: "0.88rem" }}>✓ Saved</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <IconButton showLabel icon={checking ? "spinner" : "rotate"} label={checking ? "Checking for updates" : "Check for updates"} spin={checking} className="btn btn--ghost" onClick={checkForUpdates} disabled={checking} />
        {updateStatus && <span style={{ fontSize: "0.88rem" }}>{updateStatus}</span>}
      </div>
      <CloudSettings />
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

function semverGt(a: string, b: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);
  const [aMaj, aMin, aPat] = parse(a);
  const [bMaj, bMin, bPat] = parse(b);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPat > bPat;
}

export default function App() {
  const reportError = useErrorReporter();
  const [db, setDb] = useState<Database | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selection, setSelection] = useState<Selection>({ kind: "empty" });
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openExes, setOpenExes] = useState<Set<string>>(new Set());
  const [ctx, setCtx] = useState<{ x: number; y: number; items: CtxItem[] } | null>(null);
  const [statesFor, setStatesFor] = useState<string | null>(null);
  const collapseInited = useRef(false);
  const [modal, setModal] = useState<Modal | null>(null);
  const [updateInfo, setUpdateInfo] = useState<{ version: string; downloadUrl: string | null; notesUrl: string } | null>(null);
  const [updating, setUpdating] = useState(false);
  // The version the user dismissed, so the periodic re-check doesn't keep re-surfacing it.
  const dismissedUpdate = useRef<string | null>(null);
  // The version already announced via system notification, so the periodic re-check
  // doesn't toast the same release every 30 minutes.
  const notifiedUpdate = useRef<string | null>(null);
  const launchUpdateCheckStarted = useRef(false);
  const { w: libW, onPointerDown: onResize } = useLibraryWidth(db?.settings.library_width);

  const loadDb = useCallback(async () => {
    setLoadFailed(false);
    try {
      const data = await api.getDatabase();
      const legacyWidth = Number(localStorage.getItem("libW"));
      if (data.settings.library_width == null && legacyWidth >= 240 && legacyWidth <= 520) {
        await api.setLibraryWidth(Math.round(legacyWidth));
        data.settings.library_width = Math.round(legacyWidth);
      }
      localStorage.removeItem("libW");
      setDb(data);
    } catch (error) {
      setLoadFailed(true);
      throw error;
    }
  }, []);

  useEffect(() => {
    const subscription = listen("firebase-restored", () => {
      setModal(null); setCtx(null); setStatesFor(null); setSelection({ kind: "empty" });
      void loadDb().catch(e => reportError(`Could not refresh restored settings: ${e}`));
    });
    return () => { void subscription.then(unlisten => unlisten()); };
  }, [loadDb, reportError]);

  // Check for updates against the latest GitHub release. Returns the new version (and shows
  // the banner) if one is available, null when up to date; throws on network failure. A
  // manual check (the Settings button) ignores a previous dismissal.
  const checkUpdate = useCallback(async (manual = false): Promise<string | null> => {
    const current = await api.getAppVersion();
    const data = await (await fetch("https://api.github.com/repos/facufierro/MacroToolbox/releases/latest")).json();
    const latest: string = data.tag_name ?? "";
    if (!latest || !semverGt(latest, current) || (!manual && dismissedUpdate.current === latest)) return null;
    const asset = (data.assets as { name: string; browser_download_url: string }[])
      ?.find(a => a.name.endsWith("-setup.exe") || a.name.endsWith(".exe"));
    setUpdateInfo({
      version: latest,
      downloadUrl: asset?.browser_download_url ?? null,
      notesUrl: data.html_url,
    });
    // The app usually sits in the tray, so also announce the update with a system
    // notification — the in-app banner is invisible until the window is opened. A manual
    // check skips the toast: the user is already looking at the banner.
    if (!manual && notifiedUpdate.current !== latest) {
      notifiedUpdate.current = latest;
      try {
        let granted = await isPermissionGranted();
        if (!granted) granted = (await requestPermission()) === "granted";
        if (granted) {
          sendNotification({
            title: "MacroToolbox update available",
            body: `Version ${latest} is ready. Open MacroToolbox to install it.`,
          });
        }
      } catch { /* ignore */ }
    }
    return latest;
  }, []);

  useEffect(() => {
    void loadDb().catch(reportError);
    const poll = async () => {
      try { setOpenExes(new Set((await api.listOpenExecutables()).map(e => e.toLowerCase()))); } catch { /* ignore */ }
    };
    poll();
    const id = setInterval(poll, 2000);

    // An available update takes precedence over "Open to tray" at launch so the install banner
    // is visible immediately. Later checks retain the normal tray behavior and use a notification.
    const backgroundCheck = () => { checkUpdate().catch(() => {}); };
    if (!launchUpdateCheckStarted.current) {
      launchUpdateCheckStarted.current = true;
      checkUpdate()
        .then(latest => { if (latest) return api.revealMainWindow(); })
        .catch(() => {});
    }

    // Keep checking periodically: the app can live in the tray for days, so a one-shot check
    // would miss any release published while it stays open.
    const updateId = setInterval(backgroundCheck, 30 * 60 * 1000);
    // WebView2 throttles timers while the window is hidden in the tray, so the periodic
    // check can lag by an hour or more. Re-check whenever the window becomes visible so
    // opening the app always reflects the latest release. visibilitychange alone is not
    // enough: WebView2 doesn't reliably fire it for native show()/hide(), so the backend
    // also emits main-window-shown whenever it restores the window.
    const onVisible = () => { if (!document.hidden) backgroundCheck(); };
    document.addEventListener("visibilitychange", onVisible);
    const unlistenShown = listen("main-window-shown", backgroundCheck);

    return () => {
      clearInterval(id);
      clearInterval(updateId);
      document.removeEventListener("visibilitychange", onVisible);
      unlistenShown.then(f => f());
    };
  }, [loadDb, checkUpdate, reportError]);

  // Suppress the browser's native right-click menu (this is a desktop app), but keep it in
  // text fields so paste still works.
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, [contenteditable]")) return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", onCtx);
    return () => document.removeEventListener("contextmenu", onCtx);
  }, []);

  function handleDb(updated: Database) {
    setDb(updated);
  }

  async function runUpdate() {
    if (!updateInfo?.downloadUrl) return;
    const ok = await ask(
      `MacroToolbox ${updateInfo.version} is available.\n\nDownload and install it now? The app will close to finish updating.`,
      { title: "Update available", kind: "info", okLabel: "Update now", cancelLabel: "Later" }
    );
    if (!ok) return;
    setUpdating(true);
    try {
      // On success the installer launches and the app exits, so control never
      // returns here; a rejection means the download or launch failed.
      await api.downloadAndInstallUpdate(updateInfo.downloadUrl);
    } catch (e) {
      setUpdating(false);
      reportError(`Update failed: ${e}`);
    }
  }

  useEffect(() => {
    if (!db) return;
    // Every folder starts collapsed on first load.
    if (!collapseInited.current) {
      collapseInited.current = true;
      setCollapsed(new Set(db.scopes.map(s => s.id)));
    }
    // Heal a selection whose profile/folder was deleted; otherwise leave it (no auto-select).
    setSelection(sel => {
      if (sel.kind !== "profile") return sel;
      const folder = db.scopes.find(s => s.id === sel.folderId);
      if (folder?.profiles.some(p => p.id === sel.profileId)) return sel;
      if (folder?.profiles[0]) return { kind: "profile", folderId: folder.id, profileId: folder.profiles[0].id };
      return { kind: "empty" };
    });
  }, [db]);

  useEffect(() => {
    if (selection.kind === "profile") {
      setCollapsed(prev => { if (!prev.has(selection.folderId)) return prev; const n = new Set(prev); n.delete(selection.folderId); return n; });
    }
  }, [selection]);

  function toggleCollapse(id: string) {
    setCollapsed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function toggleArmed(profileId: string, armed: boolean) {
    try { handleDb(await api.setProfileArmed(profileId, armed)); } catch (e) { reportError(e); }
  }

  function selectProfile(sel: Selection) {
    setSelection(sel);
    setStatesFor(null);
  }

  function profileMenu(folderId: string, p: Profile): CtxItem[] {
    return [
      { label: "Settings", onClick: () => setModal({ type: "profileSettings", gameId: folderId, profile: p, isNew: false }) },
      { label: p.parent_id ? "Change parent" : "Inherit from…", onClick: () => setModal({ type: "setParent", gameId: folderId, profile: p }) },
      { label: "Copy to…", onClick: () => setModal({ type: "copyProfile", sourceGameId: folderId, profile: p }) },
      { label: "Edit states…", onClick: () => { setSelection({ kind: "profile", folderId, profileId: p.id }); setStatesFor(p.id); } },
      { label: "Export profile", onClick: () => exportProfile(p, db!.scopes.find(folder => folder.id === folderId)!).catch(e => reportError(e)) },
      { label: "Delete profile", danger: true, onClick: async () => {
        try {
          if (!await confirmDialog(`Delete profile "${p.name}"?`)) return;
          handleDb(await api.deleteProfile(folderId, p.id));
        } catch (e) { reportError(e); }
      } },
    ];
  }

  function onProfileContext(e: ReactMouseEvent, folderId: string, p: Profile) {
    e.preventDefault();
    e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY, items: profileMenu(folderId, p) });
  }

  function folderMenu(folder: Scope): CtxItem[] {
    const newProfile = (kind: ProfileKind) => setModal({ type: "profileSettings", gameId: folder.id, profile: blankProfile(kind), isNew: true });
    const armAll = async (target: boolean) => {
      try { let db: Database | null = null; for (const p of folder.profiles) db = await api.setProfileArmed(p.id, target); if (db) handleDb(db); }
      catch (e) { reportError(e); }
    };
    const isGlobalFolder = folder.id === GLOBAL_FOLDER_ID;
    const targetExe = folder.exe.trim();
    const hasProcessTarget = targetExe !== "" && !isGlobalExe(targetExe);
    return [
      { label: "New profile", onClick: () => newProfile("hotkeys") },
      { label: "Import profile…", onClick: async () => {
        try { const imported = await importProfile(); if (!imported) return; imported.name = imported.name || "Imported Profile"; handleDb(await api.upsertProfile(folder.id, imported)); }
        catch (e) { reportError(e); }
      } },
      { label: "Arm all", onClick: () => armAll(true) },
      { label: "Disarm all", onClick: () => armAll(false) },
      { label: "Folder settings…", onClick: () => setModal({ type: "editGame", game: folder }) },
      { label: "Export folder", onClick: () => exportScope(folder).catch(e => reportError(e)) },
      ...(hasProcessTarget ? [
        { label: "Kill process", onClick: async () => {
          try {
            if (!await confirmDialog(`Force-kill "${targetExe}"?`)) return;
            await api.killGame(targetExe);
          } catch (e) { reportError(e); }
        } },
      ] : []),
      ...(!isGlobalFolder ? [{ label: "Delete folder", danger: true, onClick: async () => {
        try {
          if (!await confirmDialog(`Delete folder "${folder.name}" and all its profiles?`)) return;
          handleDb(await api.deleteGame(folder.id));
        } catch (e) { reportError(e); }
      } }] : []),
    ];
  }

  function onFolderContext(e: ReactMouseEvent, folder: Scope) {
    e.preventDefault();
    setCtx({ x: e.clientX, y: e.clientY, items: folderMenu(folder) });
  }

  // Modal handlers
  async function handleGameSave(game: Scope) {
    try {
      handleDb(await api.upsertGame(game));
      setModal(null);
    } catch (e) { reportError(`Error saving folder: ${e}`); }
  }

  async function handleProfileSettingsSave(gameId: string, profile: Profile, isNew: boolean) {
    try {
      handleDb(await api.upsertProfile(gameId, profile));
      setModal(null);
      if (isNew) setSelection({ kind: "profile", folderId: gameId, profileId: profile.id });
    } catch (e) { reportError(`Error saving profile: ${e}`); }
  }

  async function handleSetParent(gameId: string, profile: Profile, parentId: string | null) {
    try {
      const updated = await api.upsertProfile(gameId, { ...profile, parent_id: parentId });
      handleDb(updated);
      setModal(null);
    } catch (e) { reportError(`Error setting parent: ${e}`); }
  }

  async function handleOverlayItemSave(gameId: string, profileId: string, index: number | null, item: OverlayItem) {
    try {
      const game = db!.scopes.find(g => g.id === gameId)!;
      const profile = game.profiles.find(p => p.id === profileId)!;
      const items = [...profile.overlay_items];
      if (index === null) items.push(item);
      else items[index] = item;
      const updated = await api.upsertProfile(gameId, { ...profile, overlay_items: items });
      handleDb(updated);
      setModal(null);
    } catch (e) { reportError(`Error saving overlay item: ${e}`); }
  }

  async function handleStateSave(gameId: string, _profileId: string, index: number | null, state: ProfileState) {
    try {
      const game = db!.scopes.find(g => g.id === gameId)!;
      const states = [...game.states];
      if (index === null) states.push(state);
      else states[index] = state;
      const updated = await api.upsertGame({ ...game, states });
      handleDb(updated);
      setModal(null);
    } catch (e) { reportError(`Error saving state: ${e}`); }
  }

  async function handleCopyProfile(sourceGameId: string, profile: Profile, targetGameId: string, name: string) {
    try {
      const source = db!.scopes.find(folder => folder.id === sourceGameId)!;
      const portable = withReferencedOverlayParts(materializeProfile(profile, source.profiles), source.profiles);
      const copy: Profile = { ...remapProfileIds(portable, undefined, new Map()), name, parent_id: null };
      const updated = await api.upsertProfile(targetGameId, carryStates(sourceGameId, profile.id, targetGameId, copy));
      handleDb(updated);
      setModal(null);
    } catch (e) { reportError(`Error copying profile: ${e}`); }
  }

  function carryStates(sourceGameId: string, _sourceProfileId: string, targetGameId: string, profile: Profile) {
    const source = db!.scopes.find(folder => folder.id === sourceGameId)!;
    const target = db!.scopes.find(folder => folder.id === targetGameId)!;
    const sourceStates = source.states;
    const targetStates = target.states;
    return carryReferencedScripts(carryReferencedStates(carryReferencedOverlayParts(profile, source.profiles, target.profiles), sourceStates, targetStates), source.profiles.flatMap(profile => profile.scripts), target.profiles.flatMap(profile => profile.scripts));
  }

  async function handleCopyHotkey(sourceGameId: string, sourceProfileId: string, hotkey: Hotkey, targetGameId: string, targetProfileId: string) {
    try {
      const game = db!.scopes.find(candidate => candidate.id === targetGameId)!;
      const profile = game.profiles.find(candidate => candidate.id === targetProfileId)!;
      const isSameProfile = sourceGameId === targetGameId && sourceProfileId === targetProfileId;
      const copy = isSameProfile
        ? { ...hotkey, name: copyName(hotkey.name, hotkey.trigger || "Behavior"), trigger: "", allow_extra_modifiers: allowsExtraModifiers(hotkey) }
        : { ...hotkey };
      const updated = await api.upsertProfile(targetGameId, carryStates(sourceGameId, sourceProfileId, targetGameId, { ...profile, hotkeys: [...profile.hotkeys, copy] }));
      handleDb(updated);
      setModal(null);
    } catch (e) { reportError(`Error copying hotkey: ${e}`); }
  }

  async function handleCopyState(sourceGameId: string, _sourceProfileId: string, state: ProfileState, targetGameId: string, _targetProfileId: string) {
    try {
      const game = db!.scopes.find(candidate => candidate.id === targetGameId)!;
      const isSameProfile = sourceGameId === targetGameId || game.states.some(candidate => candidate.id === state.id);
      const copy = {
        ...state,
        id: isSameProfile ? uid() : state.id,
        name: isSameProfile ? copyName(state.name, "State") : state.name,
      };
      const updated = await api.upsertGame({ ...game, states: [...game.states, copy] });
      handleDb(updated);
      setModal(null);
    } catch (e) { reportError(`Error copying state: ${e}`); }
  }

  async function handleHotkeySave(gameId: string, profileId: string, index: number | null, hotkey: Hotkey) {
    try {
      const game = db!.scopes.find(g => g.id === gameId)!;
      const profile = game.profiles.find(p => p.id === profileId)!;
      const hotkeys = [...profile.hotkeys];
      if (index === null) hotkeys.push(hotkey);
      else hotkeys[index] = hotkey;
      const updated = await api.upsertProfile(gameId, { ...profile, hotkeys });
      handleDb(updated);
      setModal(null);
    } catch (e) { reportError(`Error saving hotkey: ${e}`); }
  }

  async function handleEventSave(gameId: string, profileId: string, index: number | null, event: BehaviorEvent) {
    try {
      const game = db!.scopes.find(g => g.id === gameId)!;
      const profile = game.profiles.find(p => p.id === profileId)!;
      const events = [...profile.events];
      if (index === null) events.push(event);
      else events[index] = event;
      const updated = await api.upsertProfile(gameId, { ...profile, events });
      handleDb(updated);
      setModal(null);
    } catch (e) { reportError(`Error saving event: ${e}`); }
  }

  if (!db) {
    return <div className="loading">{loadFailed
      ? <IconButton icon="rotate" label="Retry" className="btn btn--ghost" onClick={() => { void loadDb().catch(reportError); }} />
      : "Loading…"}</div>;
  }

  const selFolder = selection.kind === "profile" ? db.scopes.find(s => s.id === selection.folderId) ?? null : null;
  const selProfile = selection.kind === "profile" ? selFolder?.profiles.find(p => p.id === selection.profileId) ?? null : null;

  async function importFolder() {
    try {
      const scopes = await importScope();
      if (!scopes) return;
      let updated: Database | null = null;
      for (const scope of scopes) updated = await api.upsertGame(scope);
      if (updated) handleDb(updated);
    }
    catch (e) { reportError(e); }
  }

  return (
    <div className="layout">
      {updateInfo && (
        <div className="update-banner">
          <span>Update available: <strong>{updateInfo.version}</strong></span>
          {updateInfo.downloadUrl && (
            <IconButton showLabel icon={updating ? "spinner" : "download"} label={updating ? "Downloading update" : "Install update"} spin={updating} className="btn btn--primary btn--sm" disabled={updating} onClick={runUpdate} />
          )}
          <IconButton showLabel icon="arrow-up-right-from-square" label="Release Notes" className="btn btn--ghost btn--sm" disabled={updating} onClick={() => openUrl(updateInfo.notesUrl).catch(() => {})} />
          <IconButton icon="xmark" label="Dismiss" className="btn btn--ghost btn--sm" disabled={updating} onClick={() => { dismissedUpdate.current = updateInfo.version; setUpdateInfo(null); }} />
        </div>
      )}
      <div className="layout__body">
        <Library db={db} openExes={openExes} selection={selection}
          query={query} collapsed={collapsed} width={libW}
          onQuery={setQuery} onToggleCollapse={toggleCollapse}
          onSelect={selectProfile} onToggleArmed={toggleArmed} onProfileContext={onProfileContext} onFolderContext={onFolderContext} onDb={handleDb} onModal={setModal} />
        <Resizer onPointerDown={onResize} />
        <div className="detail">
          {selection.kind === "settings" && (
            <div className="detail__scroll"><SettingsView db={db} onDb={handleDb} onCheckUpdates={() => checkUpdate(true)} /></div>
          )}
          {selProfile && selFolder && (
            <ProfileEditor key={selProfile.id} folder={selFolder} profile={selProfile}
              showStates={statesFor === selProfile.id}
              onContext={e => onProfileContext(e, selFolder.id, selProfile)}
              onDb={handleDb} onModal={setModal} />
          )}
          {selection.kind === "empty" && (
            <div className="detail__empty">
              {db.scopes.length === 0
                ? <EmptyState title="No folders yet"
                    hint="Each folder targets one app shared by its profiles, which hold the hotkeys, scripts, overlay, and states."
                    action={{ label: "New folder", onClick: () => setModal({ type: "addGame" }) }}
                    secondary={{ label: "Import folder", onClick: importFolder }} />
                : <EmptyState title="Select a profile"
                    hint="Pick a profile on the left to edit its hotkeys, scripts, overlay, and states." />}
            </div>
          )}
        </div>

      {/* Modals */}
      {modal?.type === "addGame" && (
        <FolderModal initial={blankGame()} onSave={handleGameSave} onClose={() => setModal(null)} />
      )}
      {modal?.type === "editGame" && (
        <FolderModal initial={modal.game} onSave={handleGameSave} onClose={() => setModal(null)} />
      )}
      {modal?.type === "profileSettings" && (() => {
        const { gameId, profile, isNew } = modal;
        return <ProfileSettingsModal initial={profile} isNew={isNew}
          onSave={p => handleProfileSettingsSave(gameId, p, isNew)} onClose={() => setModal(null)} />;
      })()}
      {modal?.type === "editHotkey" && (() => {
        const { gameId, profileId: pid, index, hotkey, gameExe, states, overlays } = modal;
        return <HotkeyModal initial={hotkey} gameExe={gameExe} states={states} overlays={overlays} scripts={db.scopes.find(scope => scope.id === gameId)?.profiles.flatMap(profile => profile.scripts) ?? []}
          onSave={hk => handleHotkeySave(gameId, pid, index, hk)}
          onClose={() => setModal(null)} />;
      })()}
      {modal?.type === "editEvent" && (() => {
        const { gameId, profileId: pid, index, event, eventKinds, gameExe, states, overlays } = modal;
        return <EventModal initial={event} eventKinds={eventKinds} gameExe={gameExe} states={states} overlays={overlays} scripts={db.scopes.find(scope => scope.id === gameId)?.profiles.flatMap(profile => profile.scripts) ?? []}
          onSave={next => handleEventSave(gameId, pid, index, next)}
          onClose={() => setModal(null)} />;
      })()}
      {modal?.type === "copyHotkey" && (() => {
        const { sourceGameId, sourceProfileId, hotkey } = modal;
        return <CopyToProfileModal games={db.scopes} title="Copy Behavior To Profile" sourceGameId={sourceGameId} sourceProfileId={sourceProfileId}
          onSave={(targetGameId, targetProfileId) => handleCopyHotkey(sourceGameId, sourceProfileId, hotkey, targetGameId, targetProfileId)}
          onClose={() => setModal(null)} />;
      })()}
      {modal?.type === "setParent" && (() => {
        const { gameId, profile } = modal;
        const game = db.scopes.find(g => g.id === gameId)!;
        return <SetParentModal profiles={game.profiles} current={profile}
          onSave={parentId => handleSetParent(gameId, profile, parentId)}
          onClose={() => setModal(null)} />;
      })()}
      {modal?.type === "copyProfile" && (() => {
        const { sourceGameId, profile } = modal;
        return <CopyProfileModal games={db.scopes} sourceProfile={profile}
          onSave={(targetGameId, name) => handleCopyProfile(sourceGameId, profile, targetGameId, name)}
          onClose={() => setModal(null)} />;
      })()}
      {modal?.type === "overlayItem" && (() => {
        const { gameId, profileId, index, item, gameExe, states } = modal;
        const folder = db.scopes.find(folder => folder.id === gameId)!;
        const profile = folder.profiles.find(profile => profile.id === profileId)!;
        return <OverlayItemModal initial={item} gameExe={gameExe} states={states}
          groups={resolveOverlayGroups(folder.profiles, profile)} timers={availableOverlayItems(folder.profiles, resolveOverlayItems(folder.profiles, profile).map(({ item }) => item), resolveOverlayGroups(folder.profiles, profile)).filter(item => item.type === "timer")}
          onSave={it => handleOverlayItemSave(gameId, profileId, index, it)}
          onClose={() => setModal(null)} />;
      })()}
      {modal?.type === "profileState" && (() => {
        const { gameId, profileId, index, state } = modal;
        return <StateModal initial={state}
          onSave={nextState => handleStateSave(gameId, profileId, index, nextState)}
          onClose={() => setModal(null)} />;
      })()}
      {modal?.type === "copyState" && (() => {
        const { sourceGameId, sourceProfileId, state } = modal;
        return <CopyToProfileModal folderOnly games={db.scopes} title="Copy State To Folder" sourceGameId={sourceGameId} sourceProfileId={sourceProfileId}
          onSave={(targetGameId, targetProfileId) => handleCopyState(sourceGameId, sourceProfileId, state, targetGameId, targetProfileId)}
          onClose={() => setModal(null)} />;
      })()}
      {modal?.type === "script" && (() => {
        const { gameId, profileId, index, script } = modal;
        return <ScriptModal initial={script}
          onSave={async next => {
            const game = db.scopes.find(g => g.id === gameId);
            const profile = game?.profiles.find(p => p.id === profileId);
            if (!profile) return;
            const scripts = index === null
              ? [...profile.scripts, next]
              : profile.scripts.map((s, i) => i === index ? next : s);
            try { handleDb(await api.upsertProfile(gameId, { ...profile, scripts })); setModal(null); }
            catch (e) { reportError(e); }
          }}
          onClose={() => setModal(null)} />;
      })()}
      </div>{/* layout__body */}
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctx.items} onClose={() => setCtx(null)} />}
    </div>
  );
}
