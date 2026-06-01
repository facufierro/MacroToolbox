import { useState, useEffect, useCallback, useRef } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import type {
  Database,
  Game,
  Profile,
  Hotkey,
  OverlayItem,
  ProfileState,
} from "./types";
import "./App.css";

type View = "dashboard" | "game" | "settings";

type Modal =
  | { type: "addGame" }
  | { type: "editGame"; game: Game }
  | { type: "addProfile"; gameId: string }
  | { type: "editProfile"; gameId: string; profile: Profile }
  | { type: "editHotkey"; gameId: string; profileId: string; index: number | null; hotkey: Hotkey; gameExe: string; states: ProfileState[] }
  | { type: "setParent"; gameId: string; profile: Profile }
  | { type: "copyProfile"; sourceGameId: string; profile: Profile }
  | { type: "overlayItem"; gameId: string; profileId: string; index: number | null; item: OverlayItem; gameExe: string; states: ProfileState[] }
  | { type: "profileState"; gameId: string; profileId: string; index: number | null; state: ProfileState };

// ── Helpers ──────────────────────────────────────────────────────────────────

function uid() {
  return crypto.randomUUID();
}

function blankGame(): Game {
  return { id: uid(), name: "", exe: "", image: null, active_profile: null, profiles: [], toggle_hotkeys_key: null, toggle_overlay_key: null };
}

function blankProfile(gameId: string): Profile {
  void gameId;
  return { id: uid(), name: "", parent_id: null, hotkeys: [], states: [], overlay_items: [], overlay_triggers: [] };
}

function blankTimer():   OverlayItem { return { type: "timer", id: uid(), x: 0, y: 0, duration_ms: 60000, color: "#ffffff", font_size: 22, state_id: null, timer_state_id: null }; }
function blankIcon():    OverlayItem { return { type: "icon",  id: uid(), x: 0, y: 0, w: 64, h: 64, src: null, state_id: null }; }
function blankBar():     OverlayItem { return { type: "bar",   id: uid(), x: 0, y: 0, w: 200, h: 20, color: "#4ade80", max_value: 100, state_id: null }; }
function blankText():    OverlayItem { return { type: "text",  id: uid(), x: 0, y: 0, font_size: 16, color: "#ffffff", content: "", state_id: null }; }
function blankState(): ProfileState { return { id: uid(), name: "", duration_ms: null }; }

function normalizeOptional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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

function toAhkKey(e: KeyboardEvent): string {
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return "";
  const mods: string[] = [];
  if (e.ctrlKey)  mods.push("ctrl");
  if (e.shiftKey) mods.push("shift");
  if (e.altKey)   mods.push("alt");
  if (e.metaKey)  mods.push("win");
  const keyMap: Record<string, string> = {
    " ": "Space", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
    PageUp: "PgUp", PageDown: "PgDn", Enter: "Enter", Escape: "Esc", Tab: "Tab",
    Backspace: "Backspace", Delete: "Del", Insert: "Ins", Home: "Home", End: "End",
    PrintScreen: "PrintScreen", NumLock: "NumLock", CapsLock: "CapsLock",
  };
  let key = e.key;
  if (key in keyMap) key = keyMap[key];
  else if (/^F\d+$/.test(key)) key = key.toLowerCase();
  else if (key.length === 1) key = key.toLowerCase();
  return [...mods, key].join(" ");
}

function KeyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [recording, setRecording] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!recording) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const key = toAhkKey(e);
      if (key) { onChangeRef.current(key); setRecording(false); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [recording]);

  return recording ? (
    <div className="key-recording" onClick={() => setRecording(false)}>Press any key…</div>
  ) : (
    <div className="input-row" style={{ margin: 0, flex: 1 }}>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder="key" />
      <button className="btn btn--ghost btn--sm" onClick={() => setRecording(true)} title="Record key">⌨</button>
    </div>
  );
}

function HotkeySuggestions({ options, onPick }: { options: string[]; onPick: (value: string) => void }) {
  if (options.length === 0) return null;
  return (
    <div className="step-add-btns" style={{ marginTop: 8 }}>
      <span className="step-add-label">Use existing:</span>
      {options.map(option => (
        <button key={option} type="button" className="btn btn--ghost btn--sm" onClick={() => onPick(option)}>{option}</button>
      ))}
    </div>
  );
}

function resolveHotkeys(profiles: Profile[], profile: Profile): Array<{ hotkey: Hotkey; own: boolean }> {
  const base: Array<{ hotkey: Hotkey; own: boolean }> = profile.parent_id
    ? (() => {
        const parent = profiles.find(p => p.id === profile.parent_id);
        return parent ? resolveHotkeys(profiles, parent).map(r => ({ ...r, own: false })) : [];
      })()
    : [];
  for (const hk of profile.hotkeys) {
    const idx = base.findIndex(r => r.hotkey.trigger === hk.trigger);
    if (idx >= 0) base[idx] = { hotkey: hk, own: true };
    else base.push({ hotkey: hk, own: true });
  }
  return base;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Placeholder({ label }: { label?: string }) {
  return (
    <div className="placeholder">
      <span>{label ?? "[ image ]"}</span>
    </div>
  );
}

function GameCard({ game, active, running, onClick }: {
  game: Game; active: boolean; running: boolean; onClick: () => void;
}) {
  const armed = !!game.active_profile;
  return (
    <div className={`game-card ${active ? "game-card--active" : ""}`} onClick={onClick}>
      {game.image
        ? <img src={game.image} alt={game.name} className="game-card__img" />
        : <Placeholder />}
      <div className="game-card__name">{game.name || "Unnamed"}</div>
      {armed && (
        <div className={`badge ${running ? "badge--on" : "badge--armed"}`}>
          {running ? "● Running" : "◌ Armed"}
        </div>
      )}
    </div>
  );
}

function GameModal({ initial, onSave, onClose }: {
  initial: Game;
  onSave: (g: Game) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [exe, setExe] = useState(initial.exe);
  const [image, setImage] = useState<string | null>(initial.image);
  const [toggleHotkeysKey, setToggleHotkeysKey] = useState(initial.toggle_hotkeys_key ?? "");
  const [toggleOverlayKey, setToggleOverlayKey] = useState(initial.toggle_overlay_key ?? "");

  async function browseImage() {
    const selected = await openDialog({
      title: "Select Game Image",
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
        <h2>{initial.name ? "Edit Game" : "Add Game"}</h2>
        <div className="image-picker" onClick={browseImage}>
          {image
            ? <img src={image} alt="game" className="image-picker__preview" />
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
          <input value={exe} onChange={e => setExe(e.target.value)} />
        </label>
        <label>Enable Hotkeys Key <span style={{ color: "var(--text2)", fontWeight: 400 }}>(default: `)</span>
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
  | { type: "goto"; x: string; y: string }
  | { type: "state"; stateId: string }
  | { type: "sleep"; ms: string }
  | { type: "send"; text: string }
  | { type: "lock" | "savecursor" | "restorecursor" };

function parseSteps(behavior: string): Step[] {
  if (!behavior.trim()) return [];
  return behavior.split(";").map(s => s.trim()).filter(Boolean).flatMap(s => {
    let m: RegExpMatchArray | null;
    if ((m = s.match(/^press\((.+)\)$/))) return [{ type: "press" as const, key: m[1] }];
    if ((m = s.match(/^hold\((.+)\)$/))) return [{ type: "hold" as const, key: m[1] }];
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
        {picking ? "Click game…" : "🎯 Pick"}
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
  const [trigger, setTrigger] = useState(initial.trigger);
  const [recordingTrigger, setRecordingTrigger] = useState(false);
  const [steps, setSteps] = useState<Step[]>(() => {
    const parsed = parseSteps(initial.behavior);
    if (initial.state_id && !parsed.some(step => step.type === "state")) {
      return [...parsed, { type: "state", stateId: initial.state_id }];
    }
    return parsed;
  });

  useEffect(() => {
    if (!recordingTrigger) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const key = toAhkKey(e);
      if (key) { setTrigger(key); setRecordingTrigger(false); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [recordingTrigger]);

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

        <label>Trigger
          <div className="input-row">
            {recordingTrigger
              ? <div className="key-recording" onClick={() => setRecordingTrigger(false)}>Press any key combination…</div>
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
            <button className="btn btn--ghost btn--sm" onClick={() => addStep({ type: "press", key: "" })}>press</button>
            <button className="btn btn--ghost btn--sm" onClick={() => addStep({ type: "hold", key: "" })}>hold</button>
            <button className="btn btn--ghost btn--sm" onClick={() => addStep({ type: "goto", x: "", y: "" })}>goto</button>
            <button className="btn btn--ghost btn--sm" onClick={() => addStep({ type: "state", stateId: states[0]?.id ?? "" })}>state</button>
            <button className="btn btn--ghost btn--sm" onClick={() => addStep({ type: "lock" })}>lock</button>
            <button className="btn btn--ghost btn--sm" onClick={() => addStep({ type: "savecursor" })}>savecursor</button>
            <button className="btn btn--ghost btn--sm" onClick={() => addStep({ type: "restorecursor" })}>restorecursor</button>
            <button className="btn btn--ghost btn--sm" onClick={() => addStep({ type: "sleep", ms: "" })}>sleep</button>
            <button className="btn btn--ghost btn--sm" onClick={() => addStep({ type: "send", text: "" })}>send</button>
          </div>
        </div>

        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary"
            onClick={() => trigger.trim() && onSave({ trigger: trigger.trim(), behavior: stepsToString(steps), state_id: null })}>
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
  games: Game[];
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
        <label>Target Game
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
  return state.duration_ms ? `${state.name}, ${formatDuration(state.duration_ms)}` : `${state.name}, toggle`;
}

function hotkeyDesc(hotkey: Hotkey, states: ProfileState[]): string {
  const behavior = hotkey.behavior.replace(/state\(([^)]+)\)/g, (_, stateId: string) => {
    return `state(${stateNameById(states, stateId) ?? stateId})`;
  });
  return behavior || "No behavior";
}

function HotkeyRow({ hotkey, states, inherited, onEdit, onDelete, onOverride }: {
  hotkey: Hotkey;
  states: ProfileState[];
  inherited: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onOverride?: () => void;
}) {
  return (
    <div className={`step-row${inherited ? " step-row--muted" : ""}`}>
      <span className="overlay-type-badge overlay-type-badge--text">hotkey</span>
      <span className="hotkey-row__trigger">{hotkey.trigger}</span>
      <span className="overlay-item-desc">{hotkeyDesc(hotkey, states)}</span>
      <div className="step-row__btns">
        {inherited ? (
          <button className="icon-btn" title="Override" onClick={onOverride}>✎</button>
        ) : (
          <>
            <button className="icon-btn" title="Edit" onClick={onEdit}>✏</button>
            <button className="icon-btn icon-btn--danger" title="Delete" onClick={onDelete}>✕</button>
          </>
        )}
      </div>
    </div>
  );
}

function OverlayItemRow({ item, states, onEdit, onDelete }: { item: OverlayItem; states: ProfileState[]; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="step-row">
      <span className={`overlay-type-badge overlay-type-badge--${item.type}`}>{item.type}</span>
      <span className="overlay-item-desc">{overlayItemDesc(item, states)}</span>
      <div className="step-row__btns">
        <button className="icon-btn" onClick={onEdit}>✏</button>
        <button className="icon-btn icon-btn--danger" onClick={onDelete}>✕</button>
      </div>
    </div>
  );
}

function StateRow({ state, onEdit, onDelete }: { state: ProfileState; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="step-row">
      <span className="overlay-type-badge overlay-type-badge--text">state</span>
      <span className="overlay-item-desc">{stateDesc(state)}</span>
      <div className="step-row__btns">
        <button className="icon-btn" onClick={onEdit}>✏</button>
        <button className="icon-btn icon-btn--danger" onClick={onDelete}>✕</button>
      </div>
    </div>
  );
}

function OverlayItemModal({ initial, gameExe, states, onSave, onClose }: {
  initial: OverlayItem;
  gameExe: string;
  states: ProfileState[];
  onSave: (item: OverlayItem) => void;
  onClose: () => void;
}) {
  const [x, setX] = useState(String(initial.x));
  const [y, setY] = useState(String(initial.y));
  const [stateId, setStateId] = useState(initial.state_id ?? "");

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
      x: parseFloat(x)||0,
      y: parseFloat(y)||0,
      state_id: stateId || null,
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

        <label>Visible State
          <select value={stateId} onChange={e => setStateId(e.target.value)}>
            <option value="">Always visible</option>
            {states.map(state => (
              <option key={state.id} value={state.id}>{state.name}</option>
            ))}
          </select>
        </label>

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
            {src ? <img src={src} className="image-picker__preview" alt="icon" /> : <Placeholder />}
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
  game: Game;
  running: boolean;
  onDb: (db: Database) => void;
  onModal: (m: Modal) => void;
  onBack: () => void;
}) {
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

  async function activate() {
    if (!profileId) return;
    try {
      const db = await api.activateProfile(game.id, profileId);
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
  const stateOptions = profile?.states ?? [];

  return (
    <div className="game-view">
      {/* Header */}
      <div className="game-view__header">
        <div className="game-view__art">
          {game.image ? <img src={game.image} alt={game.name} /> : <Placeholder label="game banner" />}
        </div>
        <div className="game-view__meta">
          <h1>{game.name}</h1>
          <p className="exe-label">{game.exe}</p>
          <div className="game-view__actions">
            <button className="btn btn--ghost btn--sm" onClick={() => onModal({ type: "editGame", game })}>Edit</button>
            <button className="btn btn--ghost btn--sm" onClick={async () => {
              try { setIsBorderless(await api.makeBorderlessFullscreen(game.exe)); }
              catch (e) { alert(String(e)); }
            }}>⛶ {isBorderless ? "Restore" : "Borderless"}</button>
            <button className="btn btn--danger btn--sm" onClick={async () => {
              if (!confirm(`Force-kill "${game.exe}"?`)) return;
              try { await api.killGame(game.exe); }
              catch (e) { alert(String(e)); }
            }}>Kill Game</button>
            <button className="btn btn--danger btn--sm" onClick={deleteGame}>Delete Game</button>
          </div>
        </div>
      </div>

      {/* Profile bar */}
      <div className="profile-bar">
        <select value={profileId} onChange={e => setProfileId(e.target.value)}>
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
        {profileId && (
          <button className="btn btn--ghost btn--sm" onClick={deleteProfile}>Delete</button>
        )}
        <div style={{ flex: 1 }} />
        {isActive
          ? <button className="btn btn--danger" onClick={deactivate}>■ Deactivate</button>
          : <button className="btn btn--primary" onClick={activate} disabled={!profileId}>▶ Activate</button>
        }
        {isActive && (
          running
            ? <span className="badge badge--on">● Running</span>
            : <span className="badge badge--waiting">⏳ Waiting for game</span>
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
              onClick={() => onModal({ type: "editHotkey", gameId: game.id, profileId, index: null, hotkey: { trigger: "", behavior: "", state_id: null }, gameExe: game.exe, states: stateOptions })}>
              Hotkey
            </button>
          </div>
          <div className="steps-list" style={{ marginTop: 8 }}>
            {resolveHotkeys(game.profiles, profile).map(({ hotkey: hk, own }, i) => {
              const ownIndex = own ? profile.hotkeys.findIndex(h => h.trigger === hk.trigger) : -1;
              return (
                <HotkeyRow
                  key={i}
                  hotkey={hk}
                  states={stateOptions}
                  inherited={!own}
                  onEdit={() => onModal({ type: "editHotkey", gameId: game.id, profileId, index: ownIndex, hotkey: hk, gameExe: game.exe, states: stateOptions })}
                  onDelete={() => deleteHotkey(ownIndex)}
                  onOverride={async () => {
                    const db = await api.upsertProfile(game.id, { ...profile, hotkeys: [...profile.hotkeys, { ...hk }] });
                    onDb(db);
                  }}
                />
              );
            })}
            {resolveHotkeys(game.profiles, profile).length === 0 && (
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
            {profile.states.map((state, i) => (
              <StateRow key={state.id} state={state}
                onEdit={() => onModal({ type: "profileState", gameId: game.id, profileId, index: i, state })}
                onDelete={async () => {
                  const remainingStates = profile.states.filter((_, idx) => idx !== i);
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
                }} />
            ))}
            {profile.states.length === 0 && <div className="steps-empty">No states yet</div>}
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
            <button className="btn btn--ghost btn--sm" onClick={() => onModal({ type: "overlayItem", gameId: game.id, profileId, index: null, item: blankTimer(), gameExe: game.exe, states: stateOptions })}>Timer</button>
            <button className="btn btn--ghost btn--sm" onClick={() => onModal({ type: "overlayItem", gameId: game.id, profileId, index: null, item: blankIcon(),  gameExe: game.exe, states: stateOptions })}>Icon</button>
            <button className="btn btn--ghost btn--sm" onClick={() => onModal({ type: "overlayItem", gameId: game.id, profileId, index: null, item: blankBar(),   gameExe: game.exe, states: stateOptions })}>Bar</button>
            <button className="btn btn--ghost btn--sm" onClick={() => onModal({ type: "overlayItem", gameId: game.id, profileId, index: null, item: blankText(),  gameExe: game.exe, states: stateOptions })}>Text</button>
          </div>
          <div className="steps-list" style={{ marginTop: 8 }}>
            {profile.overlay_items.map((item, i) => (
              <OverlayItemRow key={item.id} item={item} states={stateOptions}
                onEdit={() => onModal({ type: "overlayItem", gameId: game.id, profileId, index: i, item, gameExe: game.exe, states: stateOptions })}
                onDelete={async () => {
                  const updated = { ...profile, overlay_items: profile.overlay_items.filter((_, idx) => idx !== i) };
                  onDb(await api.upsertProfile(game.id, updated));
                }} />
            ))}
            {profile.overlay_items.length === 0 && <div className="steps-empty">No overlay items yet</div>}
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
      const updated = await api.saveSettings({ ahk_exe: ahkExe });
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
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn btn--primary" onClick={save}>Save</button>
        {saved && <span style={{ color: "var(--success)", fontSize: "0.88rem" }}>✓ Saved</span>}
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [db, setDb] = useState<Database | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [modal, setModal] = useState<Modal | null>(null);

  const loadDb = useCallback(async () => {
    const data = await api.getDatabase();
    setDb(data);
  }, []);

  useEffect(() => {
    loadDb();
    const id = setInterval(async () => {
      setRunning(await api.getAhkStatus());
    }, 2000);
    return () => clearInterval(id);
  }, [loadDb]);

  function handleDb(updated: Database) {
    setDb(updated);
  }

  const selectedGame = db?.games.find(g => g.id === selectedGameId) ?? null;

  function selectGame(id: string) {
    setSelectedGameId(id);
    setView("game");
  }

  // Modal handlers
  async function handleGameSave(game: Game) {
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
      const game = db!.games.find(g => g.id === gameId)!;
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
      const game = db!.games.find(g => g.id === gameId)!;
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
    try {
      const copy: Profile = {
        id: uid(),
        name,
        parent_id: null,
        hotkeys: [...profile.hotkeys],
        states: [...profile.states],
        overlay_items: [...profile.overlay_items],
        overlay_triggers: [...profile.overlay_triggers],
      };
      const updated = await api.upsertProfile(targetGameId, copy);
      handleDb(updated);
      setModal(null);
    } catch (e) { alert(`Error copying profile: ${e}`); }
  }

  async function handleHotkeySave(gameId: string, profileId: string, index: number | null, hotkey: Hotkey) {
    try {
      const game = db!.games.find(g => g.id === gameId)!;
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

  return (
    <div className="layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar__logo">⌨ HKM</div>
        <nav className="sidebar__games">
          {[...db.games].sort((a, b) => a.name.localeCompare(b.name)).map(g => (
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
            + Add Game
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
            <h2>Games</h2>
            <div className="game-grid">
              {[...db.games].sort((a, b) => a.name.localeCompare(b.name)).map(g => (
                <GameCard key={g.id} game={g} active={selectedGameId === g.id}
                  running={running} onClick={() => selectGame(g.id)} />
              ))}
              <div className="game-card game-card--add" onClick={() => setModal({ type: "addGame" })}>
                <span>＋</span>
                <div className="game-card__name">Add Game</div>
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
      {modal?.type === "setParent" && (() => {
        const { gameId, profile } = modal;
        const game = db.games.find(g => g.id === gameId)!;
        return <SetParentModal profiles={game.profiles} current={profile}
          onSave={parentId => handleSetParent(gameId, profile, parentId)}
          onClose={() => setModal(null)} />;
      })()}
      {modal?.type === "copyProfile" && (() => {
        const { sourceGameId, profile } = modal;
        return <CopyProfileModal games={db.games} sourceProfile={profile}
          onSave={(targetGameId, name) => handleCopyProfile(sourceGameId, profile, targetGameId, name)}
          onClose={() => setModal(null)} />;
      })()}
      {modal?.type === "overlayItem" && (() => {
        const { gameId, profileId, index, item, gameExe, states } = modal;
        return <OverlayItemModal initial={item} gameExe={gameExe} states={states}
          onSave={it => handleOverlayItemSave(gameId, profileId, index, it)}
          onClose={() => setModal(null)} />;
      })()}
      {modal?.type === "profileState" && (() => {
        const { gameId, profileId, index, state } = modal;
        return <StateModal initial={state}
          onSave={nextState => handleStateSave(gameId, profileId, index, nextState)}
          onClose={() => setModal(null)} />;
      })()}
    </div>
  );
}
