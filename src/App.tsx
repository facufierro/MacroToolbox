import { useState, useEffect, useCallback, useRef } from "react";
import { open as openDialog, save as saveDialog, ask } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "./api";
import type {
  Database,
  Scope,
  Profile,
  Hotkey,
  OverlayItem,
  OverlayGroup,
  ProfileState,
} from "./types";
import "./App.css";

type View = "dashboard" | "game" | "settings";

type Modal =
  | { type: "addGame" }
  | { type: "editGame"; game: Scope }
  | { type: "addProfile"; gameId: string }
  | { type: "editProfile"; gameId: string; profile: Profile }
  | { type: "editHotkey"; gameId: string; profileId: string; index: number | null; hotkey: Hotkey; gameExe: string; states: ProfileState[] }
  | { type: "copyHotkey"; sourceGameId: string; sourceProfileId: string; hotkey: Hotkey }
  | { type: "setParent"; gameId: string; profile: Profile }
  | { type: "copyProfile"; sourceGameId: string; profile: Profile }
  | { type: "overlayItem"; gameId: string; profileId: string; index: number | null; item: OverlayItem; gameExe: string; states: ProfileState[]; groups: OverlayGroup[] }
  | { type: "copyOverlayItem"; sourceGameId: string; sourceProfileId: string; item: OverlayItem }
  | { type: "copyState"; sourceGameId: string; sourceProfileId: string; state: ProfileState }
  | { type: "profileState"; gameId: string; profileId: string; index: number | null; state: ProfileState };

// ── Helpers ──────────────────────────────────────────────────────────────────

const GLOBAL_GAME_EXE = "*";

function uid() {
  return crypto.randomUUID();
}

function blankGame(): Scope {
  return { id: uid(), name: "", exe: "", image: null, active_profile: null, profiles: [], overlay_disabled: false, toggle_hotkeys_key: null, toggle_overlay_key: null };
}

function isGlobalGame(game: Pick<Scope, "exe">) {
  return game.exe.trim() === GLOBAL_GAME_EXE;
}

function blankGlobalGame(): Scope {
  return {
    ...blankGame(),
    name: "Global",
    exe: GLOBAL_GAME_EXE,
    profiles: [{ ...blankProfile("global"), name: "Global" }],
  };
}

function blankProfile(gameId: string): Profile {
  void gameId;
  return { id: uid(), name: "", parent_id: null, hotkeys: [], states: [], overlay_items: [], overlay_triggers: [], overlay_groups: [] };
}

function blankTimer():   OverlayItem { return { type: "timer", id: uid(), name: "", x: 0, y: 0, duration_ms: 60000, color: "#ffffff", font_size: 22, state_id: null, timer_state_id: null }; }
function blankIcon():    OverlayItem { return { type: "icon",  id: uid(), name: "", x: 0, y: 0, w: 64, h: 64, src: null, state_id: null }; }
function blankBar():     OverlayItem { return { type: "bar",   id: uid(), name: "", x: 0, y: 0, w: 200, h: 20, color: "#4ade80", max_value: 100, state_id: null }; }
function blankText():    OverlayItem { return { type: "text",  id: uid(), name: "", x: 0, y: 0, font_size: 16, color: "#ffffff", content: "", state_id: null }; }
function blankState(): ProfileState { return { id: uid(), name: "", duration_ms: null }; }

// ── Export / Import helpers ───────────────────────────────────────────────────

function remapProfileIds(profile: Profile): Profile {
  const stateMap = new Map(profile.states.map(s => [s.id, uid()]));
  const groupMap = new Map((profile.overlay_groups ?? []).map(g => [g.id, uid()]));
  return {
    ...profile,
    id: uid(),
    states: profile.states.map(s => ({ ...s, id: stateMap.get(s.id)! })),
    overlay_groups: (profile.overlay_groups ?? []).map(g => ({ ...g, id: groupMap.get(g.id)! })),
    hotkeys: profile.hotkeys.map(h => ({
      ...h,
      state_id: h.state_id ? (stateMap.get(h.state_id) ?? null) : null,
    })),
    overlay_items: profile.overlay_items.map(item => ({
      ...item,
      id: uid(),
      state_id: item.state_id ? (stateMap.get(item.state_id) ?? null) : null,
      group_id: item.group_id ? (groupMap.get(item.group_id) ?? null) : null,
      ...(item.type === "timer" && item.timer_state_id
        ? { timer_state_id: stateMap.get(item.timer_state_id) ?? null }
        : {}),
    })),
  };
}

async function exportProfile(profile: Profile) {
  const path = await saveDialog({
    title: "Export Profile",
    defaultPath: `${profile.name || "profile"}.hkm-profile`,
    filters: [{ name: "HKM Profile", extensions: ["hkm-profile"] }],
  });
  if (!path) return;
  await api.writeTextFile(path, JSON.stringify({ version: 1, type: "profile", data: profile }, null, 2));
}

async function exportScope(scope: Scope) {
  const path = await saveDialog({
    title: "Export Scope",
    defaultPath: `${scope.name || "scope"}.hkm-scope`,
    filters: [{ name: "HKM Scope", extensions: ["hkm-scope"] }],
  });
  if (!path) return;
  const data = { ...scope, active_profile: null };
  await api.writeTextFile(path, JSON.stringify({ version: 1, type: "scope", data }, null, 2));
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

async function importScope(): Promise<Scope | null> {
  const path = await openDialog({
    title: "Import Scope",
    filters: [{ name: "HKM Scope", extensions: ["hkm-scope", "json"] }],
    multiple: false, directory: false,
  });
  if (!path) return null;
  const raw = JSON.parse(await api.readTextFile(path as string));
  if (raw.type !== "scope") throw new Error("File is not a scope export");
  const scope = raw.data as Scope;
  return {
    ...scope,
    id: uid(),
    active_profile: null,
    profiles: scope.profiles.map(remapProfileIds),
  };
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

function sideModifier(code: string): string | null {
  const map: Record<string, string> = {
    ControlLeft: "lctrl",
    ControlRight: "rctrl",
    ShiftLeft: "lshift",
    ShiftRight: "rshift",
    AltLeft: "lalt",
    AltRight: "ralt",
    MetaLeft: "lwin",
    MetaRight: "rwin",
  };
  return map[code] ?? null;
}

function bindingModifiers(
  e: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean },
  activeSideModifiers: Set<string> = new Set(),
) {
  const mods: string[] = [];
  const addSideOrGeneric = (left: string, right: string, generic: string, active: boolean) => {
    const sides = [left, right].filter(mod => activeSideModifiers.has(mod));
    if (sides.length) mods.push(...sides);
    else if (active) mods.push(generic);
  };
  addSideOrGeneric("lctrl", "rctrl", "ctrl", e.ctrlKey);
  addSideOrGeneric("lshift", "rshift", "shift", e.shiftKey);
  addSideOrGeneric("lalt", "ralt", "alt", e.altKey);
  addSideOrGeneric("lwin", "rwin", "win", e.metaKey);
  return mods;
}

function toAhkKey(e: KeyboardEvent, activeSideModifiers: Set<string>): string {
  const mods = bindingModifiers(e, activeSideModifiers);
  const keyMap: Record<string, string> = {
    " ": "Space", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
    PageUp: "PgUp", PageDown: "PgDn", Enter: "Enter", Escape: "Esc", Tab: "Tab",
    Backspace: "Backspace", Delete: "Del", Insert: "Ins", Home: "Home", End: "End",
    PrintScreen: "PrintScreen", NumLock: "NumLock", CapsLock: "CapsLock",
  };
  let key = e.key;
  if (key in keyMap) key = keyMap[key];
  else if (/^F\d+$/.test(key)) key = key.toLowerCase();
  else if (key.length === 1) {
    // Use e.code to get the physical key, ignoring shift transforms (e.g. Shift+5 → "5" not "%")
    const codeMatch = e.code.match(/^(Key|Digit)(.+)$/);
    key = codeMatch ? codeMatch[2].toLowerCase() : key.toLowerCase();
  }
  return [...mods, key].join(" ");
}

function toAhkMouseButton(e: MouseEvent, activeSideModifiers: Set<string>): string {
  const buttonMap: Record<number, string> = {
    0: "LButton",
    1: "MButton",
    2: "RButton",
    3: "XButton1",
    4: "XButton2",
  };
  const button = buttonMap[e.button];
  if (!button) return "";
  return [...bindingModifiers(e, activeSideModifiers), button].join(" ");
}

function useBindingRecorder(recording: boolean, onCapture: (value: string) => void) {
  const onCaptureRef = useRef(onCapture);
  const activeSideModifiersRef = useRef<Set<string>>(new Set());
  onCaptureRef.current = onCapture;

  useEffect(() => {
    if (!recording) return;

    const capture = (value: string) => {
      if (value) onCaptureRef.current(value);
    };
    const keyHandler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const sideMod = sideModifier(e.code);
      if (sideMod) {
        activeSideModifiersRef.current.add(sideMod);
        return;
      }
      capture(toAhkKey(e, activeSideModifiersRef.current));
    };
    const keyUpHandler = (e: KeyboardEvent) => {
      const sideMod = sideModifier(e.code);
      if (sideMod) activeSideModifiersRef.current.delete(sideMod);
    };
    const mouseHandler = (e: MouseEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      capture(toAhkMouseButton(e, activeSideModifiersRef.current));
    };
    const contextMenuHandler = (e: MouseEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };

    window.addEventListener("keydown", keyHandler, true);
    window.addEventListener("keyup", keyUpHandler, true);
    window.addEventListener("mousedown", mouseHandler, true);
    window.addEventListener("contextmenu", contextMenuHandler, true);
    return () => {
      activeSideModifiersRef.current.clear();
      window.removeEventListener("keydown", keyHandler, true);
      window.removeEventListener("keyup", keyUpHandler, true);
      window.removeEventListener("mousedown", mouseHandler, true);
      window.removeEventListener("contextmenu", contextMenuHandler, true);
    };
  }, [recording]);
}

function KeyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [recording, setRecording] = useState(false);
  useBindingRecorder(recording, key => {
    onChange(key);
    setRecording(false);
  });

  return recording ? (
    <div className="key-recording">Press any key or mouse button…</div>
  ) : (
    <div className="input-row" style={{ margin: 0, flex: 1 }}>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder="key" />
      <button className="btn btn--ghost btn--sm" onClick={() => setRecording(true)} title="Record key">⌨</button>
    </div>
  );
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

function resolveStates(profiles: Profile[], profile: Profile): Array<{ state: ProfileState; own: boolean }> {
  return resolveProfileEntries(profiles, profile, current => current.states, state => state.id)
    .map(({ value, own }) => ({ state: value, own }));
}

function resolveOverlayItems(profiles: Profile[], profile: Profile): Array<{ item: OverlayItem; own: boolean }> {
  return resolveProfileEntries(profiles, profile, current => current.overlay_items, item => item.id)
    .map(({ value, own }) => ({ item: value, own }));
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Placeholder({ label }: { label?: string }) {
  return (
    <div className="placeholder">
      <span>{label ?? "[ image ]"}</span>
    </div>
  );
}

function GameCard({ game, active, running, global, onClick }: {
  game: Scope; active: boolean; running: boolean; global?: boolean; onClick: () => void;
}) {
  const armed = !!game.active_profile;
  return (
    <div className={`game-card ${active ? "game-card--active" : ""} ${global ? "game-card--global" : ""}`} onClick={onClick}>
      {game.image
        ? <img src={game.image} alt={game.name} className="game-card__img" />
        : <Placeholder />}
      <div className="game-card__name">{global ? `◎ ${game.name || "Global"}` : (game.name || "Unnamed")}</div>
      {global
        ? <div className="badge badge--on">● Always active</div>
        : armed && (
          <div className={`badge ${running ? "badge--on" : "badge--armed"}`}>
            {running ? "● Running" : "◌ Armed"}
          </div>
        )}
    </div>
  );
}

function GameModal({ initial, onSave, onClose }: {
  initial: Scope;
  onSave: (g: Scope) => void;
  onClose: () => void;
}) {
  const globalGame = isGlobalGame(initial);
  const [name, setName] = useState(initial.name);
  const [exe, setExe] = useState(initial.exe);
  const [openExes, setOpenExes] = useState<string[]>([]);
  const [image, setImage] = useState<string | null>(initial.image);

  useEffect(() => {
    if (globalGame) return;
    api.listOpenExecutables().then(setOpenExes).catch(() => {});
  }, [globalGame]);
  const [toggleHotkeysKey, setToggleHotkeysKey] = useState(initial.toggle_hotkeys_key ?? "");
  const [toggleOverlayKey, setToggleOverlayKey] = useState(initial.toggle_overlay_key ?? "");

  async function browseImage() {
    const selected = await openDialog({
      title: "Select Scope Image",
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif", "ico"] }],
      multiple: false,
      directory: false,
    });
    if (!selected) return;
    try {
      setImage(await api.readImageAsDataUrl(selected as string));
    } catch (e) {
      alert(`Failed to load image: ${e}`);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{initial.name ? "Edit Scope" : "Add Scope"}</h2>
        <div className="image-picker" onClick={browseImage}>
          {image
            ? <img src={image} alt="scope" className="image-picker__preview" />
            : <Placeholder />}
        </div>
        {image && (
          <button className="btn btn--ghost btn--sm" style={{ alignSelf: "flex-start" }}
            onClick={e => { e.stopPropagation(); setImage(null); }}>
            ✕ Remove image
          </button>
        )}
        <label>Name
          <input value={name} onChange={e => setName(e.target.value)} />
        </label>
        <label>Executable
          <div className="input-row">
            <input value={exe} onChange={e => setExe(e.target.value)} disabled={globalGame} />
            {!globalGame && (
              <select value="" onChange={e => { if (e.target.value) setExe(e.target.value); }} title="Pick an open app">
                <option value="">Open apps…</option>
                {openExes.map(exeName => <option key={exeName} value={exeName}>{exeName}</option>)}
              </select>
            )}
          </div>
          {globalGame && <small>Global scopes apply to every app instead of a single executable.</small>}
        </label>
        <label>Enable Hotkeys Key <span style={{ color: "var(--text2)", fontWeight: 400 }}>(optional — leave empty to bind no key)</span>
          <KeyInput value={toggleHotkeysKey} onChange={setToggleHotkeysKey} />
        </label>
        <label>Toggle Overlay And Hotkeys Key <span style={{ color: "var(--text2)", fontWeight: 400 }}>(use a modifier, e.g. ctrl F12)</span>
          <KeyInput value={toggleOverlayKey} onChange={setToggleOverlayKey} />
        </label>
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={() => onSave({
            ...initial, name, exe, image,
            toggle_hotkeys_key: toggleHotkeysKey || null,
            toggle_overlay_key: toggleOverlayKey || null,
          })}>Save</button>
        </div>
      </div>
    </div>
  );
}

function ProfileModal({ initial = "", title, onSave, onClose }: {
  initial?: string;
  title: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <div className="modal-overlay">
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{title}</h2>
        <label>Name
          <input value={name} onChange={e => setName(e.target.value)} autoFocus />
        </label>
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={() => name.trim() && onSave(name.trim())}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ── Step types & helpers ──────────────────────────────────────────────────────

type Step =
  | { type: "press" | "hold"; key: string }
  | { type: "repeat"; key: string; interval: string; hold: string }
  | { type: "goto"; x: string; y: string }
  | { type: "state"; stateId: string }
  | { type: "sleep"; ms: string }
  | { type: "send"; text: string }
  | { type: "lock" | "savecursor" | "restorecursor" };

function parseSteps(behavior: string): Step[] {
  if (!behavior.trim()) return [];
  return behavior.split(";").map(s => s.trim()).filter(Boolean).flatMap((s): Step[] => {
    let m: RegExpMatchArray | null;
    if ((m = s.match(/^press\((.+)\)$/))) return [{ type: "press" as const, key: m[1] }];
    if ((m = s.match(/^hold\((.+)\)$/))) return [{ type: "hold" as const, key: m[1] }];
    if ((m = s.match(/^repeat\((.+?),\s*(\d+)(?:,\s*(\d+))?\)$/))) return [{ type: "repeat" as const, key: m[1].trim(), interval: m[2], hold: m[3] ?? "6" }];
    if ((m = s.match(/^goto\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)$/))) return [{ type: "goto" as const, x: m[1], y: m[2] }];
    if ((m = s.match(/^state\((.+)\)$/))) return [{ type: "state" as const, stateId: m[1] }];
    if ((m = s.match(/^sleep\((\d+)\)$/))) return [{ type: "sleep" as const, ms: m[1] }];
    if ((m = s.match(/^send\((.+)\)$/))) return [{ type: "send" as const, text: m[1] }];
    if (s === "lock") return [{ type: "lock" as const }];
    if (s === "savecursor") return [{ type: "savecursor" as const }];
    if (s === "restorecursor") return [{ type: "restorecursor" as const }];
    return [];
  });
}

function stepsToString(steps: Step[]): string {
  return steps.map(s => {
    switch (s.type) {
      case "press": return `press(${s.key})`;
      case "hold":  return `hold(${s.key})`;
      case "repeat": return `repeat(${s.key},${s.interval},${s.hold || "6"})`;
      case "goto":  return `goto(${s.x},${s.y})`;
      case "state": return `state(${s.stateId})`;
      case "sleep": return `sleep(${s.ms})`;
      case "send":  return `send(${s.text})`;
      default:      return s.type;
    }
  }).join(";");
}

// ── Step sub-components ───────────────────────────────────────────────────────

function GotoInput({ x, y, gameExe, onChange }: { x: string; y: string; gameExe: string; onChange: (x: string, y: string) => void }) {
  const [picking, setPicking] = useState(false);

  async function pick() {
    setPicking(true);
    try {
      const [px, py] = await api.pickCoordinate(gameExe);
      onChange(String(px), String(py));
    } catch (e) {
      alert(String(e));
    } finally {
      setPicking(false);
    }
  }

  return (
    <div className="goto-input">
      <input type="number" min={0} max={100} step={0.1} value={x} onChange={e => onChange(e.target.value, y)} placeholder="x %" />
      <input type="number" min={0} max={100} step={0.1} value={y} onChange={e => onChange(x, e.target.value)} placeholder="y %" />
      <button className="btn btn--ghost btn--sm" onClick={pick} disabled={picking}>
        {picking ? "Click target window…" : "🎯 Pick"}
      </button>
    </div>
  );
}

function StepRow({ step, index, total, gameExe, states, onChange, onDelete, onMove }: {
  step: Step;
  index: number;
  total: number;
  gameExe: string;
  states: ProfileState[];
  onChange: (s: Step) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  return (
    <div className="step-row">
      <span className="step-row__type">{step.type}</span>
      <div className="step-row__params">
        {(step.type === "press" || step.type === "hold") && (
          <KeyInput value={step.key} onChange={key => onChange({ ...step, key })} />
        )}
        {step.type === "repeat" && (
          <>
            <KeyInput value={step.key} onChange={key => onChange({ ...step, key })} />
            <input type="number" min={1} value={step.interval} placeholder="interval ms" title="Interval between presses (ms)"
              onChange={e => onChange({ ...step, interval: e.target.value })} style={{ width: 90 }} />
            <input type="number" min={0} value={step.hold} placeholder="hold ms" title="Key-down time per press (ms). Lower it if a game fires too fast; raise it if presses don't register."
              onChange={e => onChange({ ...step, hold: e.target.value })} style={{ width: 80 }} />
          </>
        )}
        {step.type === "goto" && (
          <GotoInput x={step.x} y={step.y} gameExe={gameExe} onChange={(x, y) => onChange({ ...step, x, y })} />
        )}
        {step.type === "state" && (
          <select value={step.stateId} onChange={e => onChange({ ...step, stateId: e.target.value })}>
            <option value="">Select state</option>
            {states.map(state => (
              <option key={state.id} value={state.id}>{state.name}</option>
            ))}
          </select>
        )}
        {step.type === "sleep" && (
          <input type="number" value={step.ms} placeholder="ms"
            onChange={e => onChange({ ...step, ms: e.target.value })} style={{ width: 90 }} />
        )}
        {step.type === "send" && (
          <input value={step.text} placeholder="text"
            onChange={e => onChange({ ...step, text: e.target.value })} />
        )}
      </div>
      <div className="step-row__btns">
        <button className="icon-btn" disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
        <button className="icon-btn" disabled={index === total - 1} onClick={() => onMove(1)}>↓</button>
        <button className="icon-btn icon-btn--danger" onClick={onDelete}>×</button>
      </div>
    </div>
  );
}

function HotkeyModal({ initial, gameExe, states, onSave, onClose }: {
  initial: Hotkey;
  gameExe: string;
  states: ProfileState[];
  onSave: (hk: Hotkey) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [trigger, setTrigger] = useState(initial.trigger);
  const [recordingTrigger, setRecordingTrigger] = useState(false);
  const [steps, setSteps] = useState<Step[]>(() => {
    const parsed = parseSteps(initial.behavior);
    if (initial.state_id && !parsed.some(step => step.type === "state")) {
      return [...parsed, { type: "state", stateId: initial.state_id }];
    }
    return parsed;
  });

  useBindingRecorder(recordingTrigger, key => {
    setTrigger(key);
    setRecordingTrigger(false);
  });

  function addStep(step: Step) { setSteps(s => [...s, step]); }
  function removeStep(i: number) { setSteps(s => s.filter((_, idx) => idx !== i)); }
  function updateStep(i: number, step: Step) { setSteps(s => s.map((x, idx) => idx === i ? step : x)); }
  function moveStep(i: number, dir: -1 | 1) {
    setSteps(s => {
      const next = [...s];
      const j = i + dir;
      if (j < 0 || j >= next.length) return s;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  return (
    <div className="modal-overlay">
      <div className="modal modal--wide" onClick={e => e.stopPropagation()}>
        <h2>{initial.trigger ? "Edit Hotkey" : "Add Hotkey"}</h2>

        <label>Name
          <input value={name} onChange={e => setName(e.target.value)} />
        </label>

        <label>Trigger
          <div className="input-row">
            {recordingTrigger
              ? <div className="key-recording">Press any key or mouse combination…</div>
              : <input value={trigger} onChange={e => setTrigger(e.target.value)} />
            }
            <button className="btn btn--ghost btn--sm" onClick={() => setRecordingTrigger(r => !r)}>
              {recordingTrigger ? "Cancel" : "⌨ Record"}
            </button>
          </div>
        </label>

        <div className="steps-section">
          <div className="steps-label">Steps</div>
          <div className="steps-list">
            {steps.map((step, i) => (
              <StepRow key={i} step={step} index={i} total={steps.length} gameExe={gameExe} states={states}
                onChange={s => updateStep(i, s)}
                onDelete={() => removeStep(i)}
                onMove={dir => moveStep(i, dir)} />
            ))}
            {steps.length === 0 && <div className="steps-empty">No steps yet</div>}
          </div>
          <div className="step-add-btns">
            <span className="step-add-label">+ Add:</span>
            <button className="btn btn--ghost btn--sm" onClick={() => addStep({ type: "goto", x: "", y: "" })}>goto</button>
            <button className="btn btn--ghost btn--sm" onClick={() => addStep({ type: "hold", key: "" })}>hold</button>
            <button className="btn btn--ghost btn--sm" onClick={() => addStep({ type: "lock" })}>lock</button>
            <button className="btn btn--ghost btn--sm" onClick={() => addStep({ type: "press", key: "" })}>press</button>
            <button className="btn btn--ghost btn--sm" onClick={() => addStep({ type: "repeat", key: "", interval: "100", hold: "6" })}>repeat</button>
            <button className="btn btn--ghost btn--sm" onClick={() => addStep({ type: "restorecursor" })}>restorecursor</button>
            <button className="btn btn--ghost btn--sm" onClick={() => addStep({ type: "savecursor" })}>savecursor</button>
            <button className="btn btn--ghost btn--sm" onClick={() => addStep({ type: "send", text: "" })}>send</button>
            <button className="btn btn--ghost btn--sm" onClick={() => addStep({ type: "sleep", ms: "" })}>sleep</button>
            <button className="btn btn--ghost btn--sm" onClick={() => addStep({ type: "state", stateId: states[0]?.id ?? "" })}>state</button>
          </div>
        </div>

        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary"
            onClick={() => trigger.trim() && onSave({ name: name.trim(), trigger: trigger.trim(), behavior: stepsToString(steps), state_id: null })}>
            Save
          </button>
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
        <label>Inherit from
          <select value={parentId} onChange={e => setParentId(e.target.value)}>
            <option value="">None</option>
            {options.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={() => onSave(parentId || null)}>Save</button>
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
        <label>Target Scope
          <select value={targetGameId} onChange={e => setTargetGameId(e.target.value)}>
            {[...games].sort((a, b) => a.name.localeCompare(b.name)).map(g => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </label>
        <label>Profile Name
          <input value={name} onChange={e => setName(e.target.value)} />
        </label>
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary"
            onClick={() => targetGameId && name.trim() && onSave(targetGameId, name.trim())}>
            Copy
          </button>
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
}: {
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
        <label>Target Scope
          <select value={targetGameId} onChange={e => setTargetGameId(e.target.value)}>
            {[...games].sort((a, b) => a.name.localeCompare(b.name)).map(game => (
              <option key={game.id} value={game.id}>{game.name}</option>
            ))}
          </select>
        </label>
        <label>Target Profile
          <select value={targetProfileId} onChange={e => setTargetProfileId(e.target.value)} disabled={targetProfiles.length === 0}>
            {targetProfiles.map(profile => (
              <option key={profile.id} value={profile.id}>{profile.name}</option>
            ))}
            {targetProfiles.length === 0 && <option value="">No profiles</option>}
          </select>
        </label>
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={() => targetGameId && targetProfileId && onSave(targetGameId, targetProfileId)} disabled={!targetProfileId}>
            Copy
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Overlay components ────────────────────────────────────────────────────────

function overlayItemLabel(item: OverlayItem, groups: OverlayGroup[]): string {
  const base = item.name.trim() ? `${item.name} - ${item.type}` : item.type;
  const group = item.group_id ? groups.find(g => g.id === item.group_id) : null;
  return group ? `${base} [${group.name}]` : base;
}

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

function hotkeyDesc(hotkey: Hotkey, states: ProfileState[]): string {
  const behavior = hotkey.behavior.replace(/state\(([^)]+)\)/g, (_, stateId: string) => {
    return `state(${stateNameById(states, stateId) ?? stateId})`;
  });
  return behavior || "No behavior";
}

function HotkeyRow({ hotkey, states, inherited, onEdit, onCopy, onDelete, onOverride }: {
  hotkey: Hotkey;
  states: ProfileState[];
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
      <span className="overlay-item-desc">{hotkeyDesc(hotkey, states)}</span>
      <div className="step-row__btns">
        {inherited ? (
          <>
            <button className="icon-btn" title="Copy" onClick={onCopy}>⧉</button>
            <button className="icon-btn" title="Override" onClick={onOverride}>✎</button>
          </>
        ) : (
          <>
            <button className="icon-btn" title="Edit" onClick={onEdit}>✏</button>
            <button className="icon-btn" title="Copy" onClick={onCopy}>⧉</button>
            <button className="icon-btn icon-btn--danger" title="Delete" onClick={onDelete}>✕</button>
          </>
        )}
      </div>
    </div>
  );
}

function OverlayItemRow({ item, states, groups, inherited, onEdit, onCopy, onDelete, onOverride }: {
  item: OverlayItem;
  states: ProfileState[];
  groups: OverlayGroup[];
  inherited: boolean;
  onEdit?: () => void;
  onCopy?: () => void;
  onDelete?: () => void;
  onOverride?: () => void;
}) {
  return (
    <div className={`step-row${inherited ? " step-row--muted" : ""}`}>
      <span className={`overlay-type-badge overlay-type-badge--${item.type}`}>{overlayItemLabel(item, groups)}</span>
      <span className="overlay-item-desc">{overlayItemDesc(item, states)}</span>
      <div className="step-row__btns">
        {inherited ? (
          <>
            <button className="icon-btn" title="Copy" onClick={onCopy}>⧉</button>
            <button className="icon-btn" title="Override" onClick={onOverride}>✎</button>
          </>
        ) : (
          <>
            <button className="icon-btn" title="Edit" onClick={onEdit}>✏</button>
            <button className="icon-btn" title="Copy" onClick={onCopy}>⧉</button>
            <button className="icon-btn icon-btn--danger" title="Delete" onClick={onDelete}>✕</button>
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
            <button className="icon-btn" title="Copy" onClick={onCopy}>⧉</button>
            <button className="icon-btn" title="Override" onClick={onOverride}>✎</button>
          </>
        ) : (
          <>
            <button className="icon-btn" title="Edit" onClick={onEdit}>✏</button>
            <button className="icon-btn" title="Copy" onClick={onCopy}>⧉</button>
            <button className="icon-btn icon-btn--danger" title="Delete" onClick={onDelete}>✕</button>
          </>
        )}
      </div>
    </div>
  );
}

function OverlayItemModal({ initial, gameExe, states, groups, onSave, onClose }: {
  initial: OverlayItem;
  gameExe: string;
  states: ProfileState[];
  groups: OverlayGroup[];
  onSave: (item: OverlayItem) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [x, setX] = useState(String(initial.x));
  const [y, setY] = useState(String(initial.y));
  const [stateId, setStateId] = useState(initial.state_id ?? "");
  const [groupId, setGroupId] = useState(initial.group_id ?? "");

  const [mins, setMins]         = useState(String(initial.type === "timer" ? Math.floor(initial.duration_ms / 60000) : 1));
  const [secs, setSecs]         = useState(String(initial.type === "timer" ? Math.floor((initial.duration_ms % 60000) / 1000) : 0));
  const [timerColor, setTimerColor] = useState(initial.type === "timer" ? initial.color : "#ffffff");
  const [timerFontSize, setTimerFontSize] = useState(String(initial.type === "timer" ? initial.font_size : 22));
  const [timerStateId, setTimerStateId] = useState(initial.type === "timer" ? (initial.timer_state_id ?? "") : "");

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
    try { setSrc(await api.readImageAsDataUrl(selected as string)); } catch (e) { alert(String(e)); }
  }

  function build(): OverlayItem {
    const base = {
      id: initial.id,
      name: name.trim(),
      x: parseFloat(x)||0,
      y: parseFloat(y)||0,
      state_id: stateId || null,
      group_id: groupId || null,
    };
    const timerMs = ((parseInt(mins)||0)*60 + (parseInt(secs)||0)) * 1000;
    switch (initial.type) {
      case "timer": return { ...base, type: "timer", duration_ms: timerMs||60000, color: timerColor, font_size: parseInt(timerFontSize)||22, timer_state_id: timerStateId || null };
      case "icon":  return { ...base, type: "icon",  w: parseInt(iw)||64, h: parseInt(ih)||64, src };
      case "bar":   return { ...base, type: "bar",   w: parseInt(bw)||200, h: parseInt(bh)||20, color: barColor, max_value: parseFloat(maxVal)||100 };
      case "text":  return { ...base, type: "text",  font_size: parseInt(fontSize)||16, color: txtColor, content };
    }
  }

  const typeLabel = initial.type.charAt(0).toUpperCase() + initial.type.slice(1);

  return (
    <div className="modal-overlay">
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{typeLabel}</h2>

        <label>Name
          <input value={name} onChange={e => setName(e.target.value)} />
        </label>

        <label>Visible State
          <select value={stateId} onChange={e => setStateId(e.target.value)}>
            <option value="">Always visible</option>
            {states.map(state => (
              <option key={state.id} value={state.id}>{state.name}</option>
            ))}
          </select>
        </label>

        {groups.length > 0 && (
          <label>Group
            <select value={groupId} onChange={e => setGroupId(e.target.value)}>
              <option value="">No group</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </label>
        )}

        <label>Position
          <GotoInput x={x} y={y} gameExe={gameExe} onChange={(nx, ny) => { setX(nx); setY(ny); }} />
        </label>

        {initial.type === "timer" && <>
          <div className="form-grid form-grid--2">
            <label>Duration
              <div className="duration-input">
                <input type="number" value={mins} onChange={e => setMins(e.target.value)} placeholder="min" min={0} />
                <span>m</span>
                <input type="number" value={secs} onChange={e => setSecs(e.target.value)} placeholder="sec" min={0} max={59} />
                <span>s</span>
              </div>
            </label>
            <label>Size
              <input type="number" value={timerFontSize} onChange={e => setTimerFontSize(e.target.value)} />
            </label>
          </div>
          <label>Color
            <div className="color-input">
              <input className="color-input__swatch" type="color" value={timerColor} onChange={e => setTimerColor(e.target.value)} />
              <input value={timerColor} onChange={e => setTimerColor(e.target.value)} />
            </div>
          </label>
          <label>Use State Timer
            <select value={timerStateId} onChange={e => setTimerStateId(e.target.value)}>
              <option value="">Use fixed duration above</option>
              {states.filter(state => !!state.duration_ms).map(state => (
                <option key={state.id} value={state.id}>{state.name}</option>
              ))}
            </select>
          </label>
        </>}

        {initial.type === "icon" && <>
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
          {src && <button className="btn btn--ghost btn--sm modal-inline-action" onClick={() => setSrc(null)}>✕ Remove</button>}
          <div className="form-grid form-grid--2">
            <label>W <input type="number" value={iw} onChange={e => setIw(e.target.value)} /></label>
            <label>H <input type="number" value={ih} onChange={e => setIh(e.target.value)} /></label>
          </div>
        </>}

        {initial.type === "bar" && <>
          <div className="form-grid form-grid--3">
            <label>W <input type="number" value={bw} onChange={e => setBw(e.target.value)} /></label>
            <label>H <input type="number" value={bh} onChange={e => setBh(e.target.value)} /></label>
            <label>Max <input type="number" value={maxVal} onChange={e => setMaxVal(e.target.value)} /></label>
          </div>
          <label>Color
            <div className="color-input">
              <input className="color-input__swatch" type="color" value={barColor} onChange={e => setBarColor(e.target.value)} />
              <input value={barColor} onChange={e => setBarColor(e.target.value)} />
            </div>
          </label>
        </>}

        {initial.type === "text" && <>
          <label>Content
            <input value={content} onChange={e => setContent(e.target.value)} />
          </label>
          <div className="form-grid form-grid--2">
            <label>Size <input type="number" value={fontSize} onChange={e => setFontSize(e.target.value)} /></label>
            <label>Color
              <div className="color-input">
                <input className="color-input__swatch" type="color" value={txtColor} onChange={e => setTxtColor(e.target.value)} />
                <input value={txtColor} onChange={e => setTxtColor(e.target.value)} />
              </div>
            </label>
          </div>
        </>}

        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={() => onSave(build())}>Save</button>
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

        <label>Name
          <input value={name} onChange={e => setName(e.target.value)} />
        </label>

        <label>Duration
          <div className="duration-input">
            <input type="number" value={mins} onChange={e => setMins(e.target.value)} min={0} placeholder="min" />
            <span>m</span>
            <input type="number" value={secs} onChange={e => setSecs(e.target.value)} min={0} max={59} placeholder="sec" />
            <span>s</span>
          </div>
        </label>

        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={() => onSave(build())} disabled={!name.trim()}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ── Game detail view ──────────────────────────────────────────────────────────

function GameView({ game, running, onDb, onModal, onBack }: {
  game: Scope;
  running: boolean;
  onDb: (db: Database) => void;
  onModal: (m: Modal) => void;
  onBack: () => void;
}) {
  const globalGame = isGlobalGame(game);
  const [profileId, setProfileId] = useState<string>(
    game.active_profile ?? game.profiles[0]?.id ?? ""
  );
  const [tab, setTab] = useState<"hotkeys" | "widgets" | "states">("hotkeys");
  const [isBorderless, setIsBorderless] = useState(false);

  useEffect(() => {
    const valid = game.profiles.some(p => p.id === profileId);
    if (!valid) {
      setProfileId(game.active_profile ?? game.profiles[0]?.id ?? "");
    }
  }, [game.id, game.profiles.length, game.active_profile]);

  useEffect(() => {
    setIsBorderless(false);
  }, [game.id]);

  const profile = game.profiles.find(p => p.id === profileId);

  async function activate(id: string = profileId) {
    if (!id) return;
    try {
      const db = await api.activateProfile(game.id, id);
      onDb(db);
    } catch (e) {
      alert(String(e));
    }
  }

  async function deactivate() {
    try {
      const db = await api.deactivateAhk(game.id);
      onDb(db);
    } catch (e) { alert(String(e)); }
  }

  async function deleteHotkey(index: number) {
    if (!profile) return;
    const updated = { ...profile, hotkeys: profile.hotkeys.filter((_, i) => i !== index) };
    const db = await api.upsertProfile(game.id, updated);
    onDb(db);
  }

  async function deleteProfile() {
    if (!profileId) return;
    const db = await api.deleteProfile(game.id, profileId);
    onDb(db);
  }

  async function deleteGame() {
    if (!confirm(`Delete "${game.name}"?`)) return;
    try {
      if (game.active_profile) await api.deactivateAhk(game.id);
      const db = await api.deleteGame(game.id);
      onDb(db);
      onBack();
    } catch (e) { alert(String(e)); }
  }

  const isActive = game.active_profile === profileId;
  const resolvedHotkeys = profile ? resolveHotkeys(game.profiles, profile) : [];
  const resolvedStates = profile ? resolveStates(game.profiles, profile) : [];
  const resolvedOverlayItems = profile ? resolveOverlayItems(game.profiles, profile) : [];
  const stateOptions = resolvedStates.map(({ state }) => state);

  async function toggleOverlayDisabled() {
    try {
      const db = await api.upsertGame({ ...game, overlay_disabled: !game.overlay_disabled });
      onDb(db);
    } catch (e) {
      alert(String(e));
    }
  }

  return (
    <div className="game-view">
      {/* Header */}
      <div className="game-view__header">
        <div className="game-view__art">
          {game.image ? <img src={game.image} alt={game.name} /> : <Placeholder label="scope banner" />}
        </div>
        <div className="game-view__meta">
          <h1>{game.name}</h1>
          <p className="exe-label">{globalGame ? "Global profile for every app" : game.exe}</p>
          <label className="scope-toggle" title="Disable the overlay for this scope">
            <span>Overlay</span>
            <input
              type="checkbox"
              checked={!game.overlay_disabled}
              onChange={toggleOverlayDisabled}
            />
            <span className="scope-toggle__track" aria-hidden="true" />
            <span className="scope-toggle__status">{game.overlay_disabled ? "Off" : "On"}</span>
          </label>
          <div className="game-view__actions">
            <button className="btn btn--ghost btn--sm" onClick={() => onModal({ type: "editGame", game })}>Edit</button>
            <button className="btn btn--ghost btn--sm" onClick={() => exportScope(game).catch(e => alert(String(e)))}>⬇ Export</button>
            {!globalGame && <button className="btn btn--ghost btn--sm" onClick={async () => {
              try { setIsBorderless(await api.makeBorderlessFullscreen(game.exe)); }
              catch (e) { alert(String(e)); }
            }}>⛶ {isBorderless ? "Restore" : "Borderless"}</button>}
            {!globalGame && <button className="btn btn--danger btn--sm" onClick={async () => {
              if (!confirm(`Force-kill "${game.exe}"?`)) return;
              try { await api.killGame(game.exe); }
              catch (e) { alert(String(e)); }
            }}>Kill Process</button>}
            {!globalGame && <button className="btn btn--danger btn--sm" onClick={deleteGame}>Delete Scope</button>}
          </div>
        </div>
      </div>

      {/* Profile bar */}
      <div className="profile-bar">
        <select value={profileId} onChange={e => {
          const id = e.target.value;
          setProfileId(id);
          if (globalGame && id) activate(id);
        }}>
          {game.profiles.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
          {game.profiles.length === 0 && <option value="">No profiles</option>}
        </select>
        <button className="btn btn--ghost btn--sm" onClick={() => onModal({ type: "addProfile", gameId: game.id })}>
          + Profile
        </button>
        {profile && (
          <button className="btn btn--ghost btn--sm" onClick={() => onModal({ type: "editProfile", gameId: game.id, profile })}>Rename</button>
        )}
        {profile && (
          <button className="btn btn--ghost btn--sm" onClick={() => onModal({ type: "setParent", gameId: game.id, profile })}>
            {profile.parent_id ? "⬆ Parent" : "⬆ Inherit"}
          </button>
        )}
        {profile && (
          <button className="btn btn--ghost btn--sm" onClick={() => onModal({ type: "copyProfile", sourceGameId: game.id, profile })}>⧉ Copy</button>
        )}
        {profile && (
          <button className="btn btn--ghost btn--sm" onClick={() => exportProfile(profile).catch(e => alert(String(e)))}>⬇ Export</button>
        )}
        <button className="btn btn--ghost btn--sm" onClick={async () => {
          try {
            const imported = await importProfile();
            if (!imported) return;
            imported.name = imported.name || "Imported Profile";
            onDb(await api.upsertProfile(game.id, imported));
          } catch (e) { alert(String(e)); }
        }}>⬆ Import</button>
        {profileId && (
          <button className="btn btn--ghost btn--sm" onClick={deleteProfile}>Delete</button>
        )}
        <div style={{ flex: 1 }} />
        {globalGame ? (
          <span className="badge badge--on">● Always active</span>
        ) : (
          <>
            {isActive
              ? <button className="btn btn--danger" onClick={() => deactivate()}>■ Deactivate</button>
              : <button className="btn btn--primary" onClick={() => activate()} disabled={!profileId}>▶ Activate</button>
            }
            {isActive && (
              running
                ? <span className="badge badge--on">● Running</span>
                : <span className="badge badge--waiting">⏳ Waiting for game</span>
            )}
          </>
        )}
      </div>

      {/* Tabs */}
      <div className="view-tabs">
        <button className={`view-tab ${tab === "hotkeys" ? "view-tab--active" : ""}`} onClick={() => setTab("hotkeys")}>Hotkeys</button>
        <button className={`view-tab ${tab === "widgets" ? "view-tab--active" : ""}`} onClick={() => setTab("widgets")}>Widgets</button>
        <button className={`view-tab ${tab === "states" ? "view-tab--active" : ""}`} onClick={() => setTab("states")}>States</button>
      </div>

      {/* Hotkeys tab */}
      {tab === "hotkeys" && (profile ? (
        <>
          <div className="step-add-btns">
            <span className="step-add-label">Add:</span>
            <button className="btn btn--ghost btn--sm"
              onClick={() => onModal({ type: "editHotkey", gameId: game.id, profileId, index: null, hotkey: { name: "", trigger: "", behavior: "", state_id: null }, gameExe: game.exe, states: stateOptions })}>
              Hotkey
            </button>
          </div>
          <div className="steps-list" style={{ marginTop: 8 }}>
            {resolvedHotkeys.map(({ hotkey: hk, own }, i) => {
              const ownIndex = own ? profile.hotkeys.findIndex(h => h.trigger === hk.trigger) : -1;
              return (
                <HotkeyRow
                  key={i}
                  hotkey={hk}
                  states={stateOptions}
                  inherited={!own}
                  onEdit={() => onModal({ type: "editHotkey", gameId: game.id, profileId, index: ownIndex, hotkey: hk, gameExe: game.exe, states: stateOptions })}
                  onCopy={() => onModal({ type: "copyHotkey", sourceGameId: game.id, sourceProfileId: profileId, hotkey: hk })}
                  onDelete={() => deleteHotkey(ownIndex)}
                  onOverride={async () => {
                    const db = await api.upsertProfile(game.id, { ...profile, hotkeys: [...profile.hotkeys, { ...hk }] });
                    onDb(db);
                  }}
                />
              );
            })}
            {resolvedHotkeys.length === 0 && (
              <div className="steps-empty">No hotkeys yet</div>
            )}
          </div>
        </>
      ) : (
        <p className="empty-row">Create a profile to start adding hotkeys.</p>
      ))}

      {tab === "states" && (profile ? (
        <div className="overlay-editor">
          <div className="step-add-btns">
            <span className="step-add-label">Add:</span>
            <button className="btn btn--ghost btn--sm" onClick={() => onModal({ type: "profileState", gameId: game.id, profileId, index: null, state: blankState() })}>State</button>
          </div>
          <div className="steps-list" style={{ marginTop: 8 }}>
            {resolvedStates.map(({ state, own }) => {
              const ownIndex = own ? profile.states.findIndex(candidate => candidate.id === state.id) : -1;
              return (
                <StateRow key={state.id} state={state} inherited={!own}
                  onEdit={own ? () => onModal({ type: "profileState", gameId: game.id, profileId, index: ownIndex, state }) : undefined}
                  onCopy={() => onModal({ type: "copyState", sourceGameId: game.id, sourceProfileId: profileId, state })}
                  onDelete={own ? async () => {
                    const remainingStates = profile.states.filter((_, idx) => idx !== ownIndex);
                    const updated = {
                      ...profile,
                      states: remainingStates,
                      hotkeys: profile.hotkeys.map(hotkey => hotkey.state_id === state.id ? { ...hotkey, state_id: null } : hotkey),
                      overlay_items: profile.overlay_items.map(item => item.type === "timer"
                        ? {
                            ...item,
                            state_id: item.state_id === state.id ? null : item.state_id,
                            timer_state_id: item.timer_state_id === state.id ? null : item.timer_state_id,
                          }
                        : { ...item, state_id: item.state_id === state.id ? null : item.state_id }),
                    };
                    onDb(await api.upsertProfile(game.id, updated));
                  } : undefined}
                  onOverride={!own ? async () => {
                    onDb(await api.upsertProfile(game.id, { ...profile, states: [...profile.states, { ...state }] }));
                  } : undefined} />
              );
            })}
            {resolvedStates.length === 0 && <div className="steps-empty">No states yet</div>}
          </div>
        </div>
      ) : (
        <p className="empty-row">Create a profile to start adding states.</p>
      ))}

      {/* Widgets tab */}
      {tab === "widgets" && (profile ? (
        <div className="overlay-editor">
          <div className="step-add-btns">
            <span className="step-add-label">Add:</span>
            <button className="btn btn--ghost btn--sm" onClick={() => onModal({ type: "overlayItem", gameId: game.id, profileId, index: null, item: blankTimer(), gameExe: game.exe, states: stateOptions, groups: profile.overlay_groups ?? [] })}>Timer</button>
            <button className="btn btn--ghost btn--sm" onClick={() => onModal({ type: "overlayItem", gameId: game.id, profileId, index: null, item: blankIcon(),  gameExe: game.exe, states: stateOptions, groups: profile.overlay_groups ?? [] })}>Icon</button>
            <button className="btn btn--ghost btn--sm" onClick={() => onModal({ type: "overlayItem", gameId: game.id, profileId, index: null, item: blankBar(),   gameExe: game.exe, states: stateOptions, groups: profile.overlay_groups ?? [] })}>Bar</button>
            <button className="btn btn--ghost btn--sm" onClick={() => onModal({ type: "overlayItem", gameId: game.id, profileId, index: null, item: blankText(),  gameExe: game.exe, states: stateOptions, groups: profile.overlay_groups ?? [] })}>Text</button>
            <button className="btn btn--ghost btn--sm" onClick={async () => {
              const name = prompt("Group name:");
              if (!name?.trim()) return;
              const group: OverlayGroup = { id: uid(), name: name.trim() };
              onDb(await api.upsertProfile(game.id, { ...profile, overlay_groups: [...(profile.overlay_groups ?? []), group] }));
            }}>+ Group</button>
          </div>
          {(profile.overlay_groups ?? []).length > 0 && (
            <div className="steps-list" style={{ marginTop: 8 }}>
              {(profile.overlay_groups ?? []).map(group => (
                <div key={group.id} className="step-row">
                  <span className="overlay-type-badge overlay-type-badge--text">{group.name} - group</span>
                  <span className="overlay-item-desc">{resolvedOverlayItems.filter(({ item }) => item.group_id === group.id).length} items</span>
                  <div className="step-row__btns">
                    <button className="icon-btn icon-btn--danger" title="Delete group" onClick={async () => {
                      const updated = {
                        ...profile,
                        overlay_groups: (profile.overlay_groups ?? []).filter(g => g.id !== group.id),
                        overlay_items: profile.overlay_items.map(item => item.group_id === group.id ? { ...item, group_id: null } : item),
                      };
                      onDb(await api.upsertProfile(game.id, updated));
                    }}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="steps-list" style={{ marginTop: 8 }}>
            {resolvedOverlayItems.map(({ item, own }) => {
              const ownIndex = own ? profile.overlay_items.findIndex(candidate => candidate.id === item.id) : -1;
              return (
                <OverlayItemRow key={item.id} item={item} states={stateOptions} groups={profile.overlay_groups ?? []} inherited={!own}
                  onEdit={own ? () => onModal({ type: "overlayItem", gameId: game.id, profileId, index: ownIndex, item, gameExe: game.exe, states: stateOptions, groups: profile.overlay_groups ?? [] }) : undefined}
                  onCopy={() => onModal({ type: "copyOverlayItem", sourceGameId: game.id, sourceProfileId: profileId, item })}
                  onDelete={own ? async () => {
                    const updated = { ...profile, overlay_items: profile.overlay_items.filter((_, idx) => idx !== ownIndex) };
                    onDb(await api.upsertProfile(game.id, updated));
                  } : undefined}
                  onOverride={!own ? async () => {
                    onDb(await api.upsertProfile(game.id, { ...profile, overlay_items: [...profile.overlay_items, { ...item }] }));
                  } : undefined} />
              );
            })}
            {resolvedOverlayItems.length === 0 && <div className="steps-empty">No overlay items yet</div>}
          </div>
        </div>
      ) : (
        <p className="empty-row">Create a profile to start adding widgets.</p>
      ))}
    </div>
  );
}

// ── Settings view ─────────────────────────────────────────────────────────────

function SettingsView({ db, onDb }: { db: Database; onDb: (db: Database) => void }) {
  const [ahkExe, setAhkExe] = useState(db.settings.ahk_exe);
  const [openToTray, setOpenToTray] = useState(db.settings.open_to_tray);
  const [closeToTray, setCloseToTray] = useState(db.settings.close_to_tray);
  const [launchOnStartup, setLaunchOnStartup] = useState(db.settings.launch_on_startup);
  const [saved, setSaved] = useState(false);

  async function browse() {
    const selected = await openDialog({
      title: "Select AutoHotkey Executable",
      filters: [{ name: "Executable", extensions: ["exe"] }],
      multiple: false,
      directory: false,
    });
    if (selected) setAhkExe(selected as string);
  }

  async function save() {
    try {
      const updated = await api.saveSettings({
        ahk_exe: ahkExe,
        open_to_tray: openToTray,
        close_to_tray: closeToTray,
        launch_on_startup: launchOnStartup,
      });
      onDb(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { alert(`Error saving settings: ${e}`); }
  }

  return (
    <div className="settings-view">
      <h2>Settings</h2>
      <label>AutoHotkey v2 Executable Path
        <div className="input-row">
          <input value={ahkExe} onChange={e => setAhkExe(e.target.value)} />
          <button className="btn btn--ghost" onClick={browse}>Browse…</button>
        </div>
        <small>Example: C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe</small>
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={openToTray}
          onChange={e => setOpenToTray(e.target.checked)}
        />
        <span>
          Open to tray
          <small>Start hidden and restore from the tray icon.</small>
        </span>
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={closeToTray}
          onChange={e => setCloseToTray(e.target.checked)}
        />
        <span>
          Close to tray
          <small>Hide the main window instead of quitting when closing it.</small>
        </span>
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={launchOnStartup}
          onChange={e => setLaunchOnStartup(e.target.checked)}
        />
        <span>
          Launch on startup
          <small>Start MacroToolbox automatically when you log in to Windows. Pair with “Open to tray” to start hidden.</small>
        </span>
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn btn--primary" onClick={save}>Save</button>
        {saved && <span style={{ color: "var(--success)", fontSize: "0.88rem" }}>✓ Saved</span>}
      </div>
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
  const [db, setDb] = useState<Database | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [modal, setModal] = useState<Modal | null>(null);
  const [updateInfo, setUpdateInfo] = useState<{ version: string; downloadUrl: string | null; notesUrl: string } | null>(null);
  const [updating, setUpdating] = useState(false);

  const loadDb = useCallback(async () => {
    const data = await api.getDatabase();
    setDb(data);
  }, []);

  useEffect(() => {
    loadDb();
    const id = setInterval(async () => {
      setRunning(await api.getAhkStatus());
    }, 2000);

    api.getAppVersion().then(current => {
      fetch("https://api.github.com/repos/facufierro/MacroToolbox/releases/latest")
        .then(r => r.json())
        .then(data => {
          const latest: string = data.tag_name ?? "";
          if (latest && semverGt(latest, current)) {
            const asset = (data.assets as { name: string; browser_download_url: string }[])
              ?.find(a => a.name.endsWith("-setup.exe") || a.name.endsWith(".exe"));
            setUpdateInfo({
              version: latest,
              downloadUrl: asset?.browser_download_url ?? null,
              notesUrl: data.html_url,
            });
          }
        })
        .catch(() => {});
    }).catch(() => {});

    return () => clearInterval(id);
  }, [loadDb]);

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
      alert(`Update failed: ${e}`);
    }
  }

  const selectedGame = db?.scopes.find(g => g.id === selectedGameId) ?? null;

  function selectGame(id: string) {
    setSelectedGameId(id);
    setView("game");
  }

  async function handleCreateGlobalGame() {
    if (!db) return;
    const existing = db.scopes.find(isGlobalGame);
    if (existing) {
      selectGame(existing.id);
      return;
    }

    try {
      const globalGame = blankGlobalGame();
      const updated = await api.upsertGame(globalGame);
      handleDb(updated);
      selectGame(globalGame.id);
    } catch (e) { alert(`Error creating global game: ${e}`); }
  }

  // Modal handlers
  async function handleGameSave(game: Scope) {
    try {
      const updated = await api.upsertGame(game);
      handleDb(updated);
      setModal(null);
      if (view === "dashboard") selectGame(game.id);
    } catch (e) { alert(`Error saving game: ${e}`); }
  }

  async function handleProfileSave(gameId: string, name: string) {
    try {
      const profile: Profile = { ...blankProfile(gameId), name };
      const updated = await api.upsertProfile(gameId, profile);
      handleDb(updated);
      setModal(null);
    } catch (e) { alert(`Error saving profile: ${e}`); }
  }

  async function handleProfileRename(gameId: string, profile: Profile, name: string) {
    try {
      const updated = await api.upsertProfile(gameId, { ...profile, name });
      handleDb(updated);
      setModal(null);
    } catch (e) { alert(`Error renaming profile: ${e}`); }
  }

  async function handleSetParent(gameId: string, profile: Profile, parentId: string | null) {
    try {
      const updated = await api.upsertProfile(gameId, { ...profile, parent_id: parentId });
      handleDb(updated);
      setModal(null);
    } catch (e) { alert(`Error setting parent: ${e}`); }
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
    } catch (e) { alert(`Error saving overlay item: ${e}`); }
  }

  async function handleStateSave(gameId: string, profileId: string, index: number | null, state: ProfileState) {
    try {
      const game = db!.scopes.find(g => g.id === gameId)!;
      const profile = game.profiles.find(p => p.id === profileId)!;
      const states = [...profile.states];
      if (index === null) states.push(state);
      else states[index] = state;
      const updated = await api.upsertProfile(gameId, { ...profile, states });
      handleDb(updated);
      setModal(null);
    } catch (e) { alert(`Error saving state: ${e}`); }
  }

  async function handleCopyProfile(sourceGameId: string, profile: Profile, targetGameId: string, name: string) {
    void sourceGameId;
    try {
      const copy: Profile = {
        id: uid(),
        name,
        parent_id: null,
        hotkeys: [...profile.hotkeys],
        states: [...profile.states],
        overlay_items: [...profile.overlay_items],
        overlay_triggers: [...profile.overlay_triggers],
        overlay_groups: [...(profile.overlay_groups ?? [])],
      };
      const updated = await api.upsertProfile(targetGameId, copy);
      handleDb(updated);
      setModal(null);
    } catch (e) { alert(`Error copying profile: ${e}`); }
  }

  async function handleCopyHotkey(sourceGameId: string, sourceProfileId: string, hotkey: Hotkey, targetGameId: string, targetProfileId: string) {
    try {
      const game = db!.scopes.find(candidate => candidate.id === targetGameId)!;
      const profile = game.profiles.find(candidate => candidate.id === targetProfileId)!;
      const isSameProfile = sourceGameId === targetGameId && sourceProfileId === targetProfileId;
      const copy = isSameProfile
        ? { ...hotkey, name: copyName(hotkey.name, hotkey.trigger || "Behavior"), trigger: "" }
        : { ...hotkey };
      const updated = await api.upsertProfile(targetGameId, { ...profile, hotkeys: [...profile.hotkeys, copy] });
      handleDb(updated);
      setModal(null);
    } catch (e) { alert(`Error copying hotkey: ${e}`); }
  }

  async function handleCopyOverlayItem(sourceGameId: string, sourceProfileId: string, item: OverlayItem, targetGameId: string, targetProfileId: string) {
    try {
      const game = db!.scopes.find(candidate => candidate.id === targetGameId)!;
      const profile = game.profiles.find(candidate => candidate.id === targetProfileId)!;
      const isSameProfile = sourceGameId === targetGameId && sourceProfileId === targetProfileId;
      const copy = {
        ...item,
        id: uid(),
        name: isSameProfile ? copyName(item.name, item.type) : item.name,
      };
      const updated = await api.upsertProfile(targetGameId, { ...profile, overlay_items: [...profile.overlay_items, copy] });
      handleDb(updated);
      setModal(null);
    } catch (e) { alert(`Error copying overlay item: ${e}`); }
  }

  async function handleCopyState(sourceGameId: string, sourceProfileId: string, state: ProfileState, targetGameId: string, targetProfileId: string) {
    try {
      const game = db!.scopes.find(candidate => candidate.id === targetGameId)!;
      const profile = game.profiles.find(candidate => candidate.id === targetProfileId)!;
      const isSameProfile = sourceGameId === targetGameId && sourceProfileId === targetProfileId;
      const copy = {
        ...state,
        id: isSameProfile ? uid() : state.id,
        name: isSameProfile ? copyName(state.name, "State") : state.name,
      };
      const updated = await api.upsertProfile(targetGameId, { ...profile, states: [...profile.states, copy] });
      handleDb(updated);
      setModal(null);
    } catch (e) { alert(`Error copying state: ${e}`); }
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
    } catch (e) { alert(`Error saving hotkey: ${e}`); }
  }

  if (!db) {
    return <div className="loading">Loading…</div>;
  }

  const globalGame = db.scopes.find(isGlobalGame) ?? null;

  return (
    <div className="layout">
      {updateInfo && (
        <div className="update-banner">
          <span>Update available: <strong>{updateInfo.version}</strong></span>
          {updateInfo.downloadUrl && (
            <button className="btn btn--primary btn--sm" disabled={updating} onClick={runUpdate}>
              {updating ? "Downloading…" : "Update Now"}
            </button>
          )}
          <button className="btn btn--ghost btn--sm" disabled={updating}
            onClick={() => openUrl(updateInfo.notesUrl).catch(() => {})}>Release Notes</button>
          <button className="btn btn--ghost btn--sm" disabled={updating} onClick={() => setUpdateInfo(null)}>Dismiss</button>
        </div>
      )}
      {/* Sidebar + main */}
      <div className="layout__body">
      <aside className="sidebar">
        <div className="sidebar__logo">⌨ HKM</div>
        <nav className="sidebar__games">
          <button
            className={`sidebar__item sidebar__item--global ${globalGame && selectedGameId === globalGame.id ? "sidebar__item--active" : ""}`}
            onClick={handleCreateGlobalGame}
            title="Global scope — always active">
            <div className="sidebar__thumb sidebar__thumb--placeholder">◎</div>
            <span className="sidebar__label">{globalGame ? (globalGame.name || "Global") : "Add Global Scope"}</span>
            {globalGame && (
              <span className="sidebar__dot sidebar__dot--on" />
            )}
          </button>
          {[...db.scopes].filter(g => !isGlobalGame(g)).sort((a, b) => a.name.localeCompare(b.name)).map(g => (
            <button key={g.id}
              className={`sidebar__item ${selectedGameId === g.id ? "sidebar__item--active" : ""}`}
              onClick={() => selectGame(g.id)}
              title={g.name}>
              {g.image
                ? <img src={g.image} alt={g.name} className="sidebar__thumb" />
                : <div className="sidebar__thumb sidebar__thumb--placeholder">{g.name[0] ?? "?"}</div>}
              <span className="sidebar__label">{g.name || "Unnamed"}</span>
              {g.active_profile && (
                <span className={`sidebar__dot ${running ? "sidebar__dot--on" : "sidebar__dot--armed"}`} />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar__bottom">
          <button className="btn btn--ghost btn--full"
            onClick={() => { setModal({ type: "addGame" }); setView("dashboard"); }}>
            + Add Scope
          </button>
          <button className={`sidebar__nav-btn ${view === "settings" ? "sidebar__nav-btn--active" : ""}`}
            onClick={() => setView("settings")}>
            ⚙ Settings
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="main">
        {view === "settings" && (
          <SettingsView db={db} onDb={handleDb} />
        )}
        {view === "game" && selectedGame && (
          <GameView game={selectedGame} running={running} onDb={handleDb} onModal={setModal}
            onBack={() => { setSelectedGameId(null); setView("dashboard"); }} />
        )}
        {view === "dashboard" && (
          <div className="dashboard">
            <h2>Scopes</h2>
            <div className="game-grid">
              {globalGame ? (
                <GameCard key={globalGame.id} game={globalGame} active={selectedGameId === globalGame.id}
                  running={running} global onClick={() => selectGame(globalGame.id)} />
              ) : (
                <div className="game-card game-card--add game-card--global" onClick={handleCreateGlobalGame}>
                  <span>◎</span>
                  <div className="game-card__name">Add Global Scope</div>
                </div>
              )}
              {[...db.scopes].filter(g => !isGlobalGame(g)).sort((a, b) => a.name.localeCompare(b.name)).map(g => (
                <GameCard key={g.id} game={g} active={selectedGameId === g.id}
                  running={running} onClick={() => selectGame(g.id)} />
              ))}
              <div className="game-card game-card--add" onClick={() => setModal({ type: "addGame" })}>
                <span>＋</span>
                <div className="game-card__name">Add Scope</div>
              </div>
              <div className="game-card game-card--add" onClick={async () => {
                try {
                  const scope = await importScope();
                  if (!scope) return;
                  handleDb(await api.upsertGame(scope));
                } catch (e) { alert(String(e)); }
              }}>
                <span>⬆</span>
                <div className="game-card__name">Import Scope</div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Modals */}
      {modal?.type === "addGame" && (
        <GameModal initial={blankGame()} onSave={handleGameSave} onClose={() => setModal(null)} />
      )}
      {modal?.type === "editGame" && (
        <GameModal initial={modal.game} onSave={handleGameSave} onClose={() => setModal(null)} />
      )}
      {modal?.type === "addProfile" && (() => {
        const { gameId } = modal;
        return <ProfileModal title="New Profile" onSave={name => handleProfileSave(gameId, name)} onClose={() => setModal(null)} />;
      })()}
      {modal?.type === "editProfile" && (() => {
        const { gameId, profile } = modal;
        return <ProfileModal title="Rename Profile" initial={profile.name}
          onSave={name => handleProfileRename(gameId, profile, name)} onClose={() => setModal(null)} />;
      })()}
      {modal?.type === "editHotkey" && (() => {
        const { gameId, profileId: pid, index, hotkey, gameExe, states } = modal;
        return <HotkeyModal initial={hotkey} gameExe={gameExe} states={states}
          onSave={hk => handleHotkeySave(gameId, pid, index, hk)}
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
        const { gameId, profileId, index, item, gameExe, states, groups } = modal;
        return <OverlayItemModal initial={item} gameExe={gameExe} states={states} groups={groups}
          onSave={it => handleOverlayItemSave(gameId, profileId, index, it)}
          onClose={() => setModal(null)} />;
      })()}
      {modal?.type === "copyOverlayItem" && (() => {
        const { sourceGameId, sourceProfileId, item } = modal;
        return <CopyToProfileModal games={db.scopes} title="Copy Widget To Profile" sourceGameId={sourceGameId} sourceProfileId={sourceProfileId}
          onSave={(targetGameId, targetProfileId) => handleCopyOverlayItem(sourceGameId, sourceProfileId, item, targetGameId, targetProfileId)}
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
        return <CopyToProfileModal games={db.scopes} title="Copy State To Profile" sourceGameId={sourceGameId} sourceProfileId={sourceProfileId}
          onSave={(targetGameId, targetProfileId) => handleCopyState(sourceGameId, sourceProfileId, state, targetGameId, targetProfileId)}
          onClose={() => setModal(null)} />;
      })()}
      </div>{/* layout__body */}
    </div>
  );
}
