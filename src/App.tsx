import { useState, useEffect, useCallback, useRef } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import type { Database, Game, Profile, Hotkey } from "./types";
import "./App.css";

type View = "dashboard" | "game" | "settings";

type Modal =
  | { type: "addGame" }
  | { type: "editGame"; game: Game }
  | { type: "addProfile"; gameId: string }
  | { type: "editProfile"; gameId: string; profile: Profile }
  | { type: "editHotkey"; gameId: string; profileId: string; index: number | null; hotkey: Hotkey; gameExe: string }
  | { type: "setParent"; gameId: string; profile: Profile }
  | { type: "copyProfile"; sourceGameId: string; profile: Profile };

// ── Helpers ──────────────────────────────────────────────────────────────────

function uid() {
  return crypto.randomUUID();
}

function blankGame(): Game {
  return { id: uid(), name: "", exe: "", image: null, active_profile: null, profiles: [] };
}

function blankProfile(gameId: string): Profile {
  void gameId;
  return { id: uid(), name: "", parent_id: null, hotkeys: [] };
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
            : <Placeholder label="click to set image" />}
        </div>
        {image && (
          <button className="btn btn--ghost btn--sm" style={{ alignSelf: "flex-start" }}
            onClick={e => { e.stopPropagation(); setImage(null); }}>
            ✕ Remove image
          </button>
        )}
        <label>Name
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. My Game" />
        </label>
        <label>Executable
          <input value={exe} onChange={e => setExe(e.target.value)} placeholder="e.g. game.exe" />
        </label>
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={() => onSave({ ...initial, name, exe, image })}>Save</button>
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
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Default" autoFocus />
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
  | { type: "sleep"; ms: string }
  | { type: "send"; text: string }
  | { type: "lock" | "savecursor" | "restorecursor" };

function parseSteps(behavior: string): Step[] {
  if (!behavior.trim()) return [];
  return behavior.split(";").map(s => s.trim()).filter(Boolean).flatMap(s => {
    let m: RegExpMatchArray | null;
    if ((m = s.match(/^press\((.+)\)$/))) return [{ type: "press" as const, key: m[1] }];
    if ((m = s.match(/^hold\((.+)\)$/))) return [{ type: "hold" as const, key: m[1] }];
    if ((m = s.match(/^goto\((-?\d+),\s*(-?\d+)\)$/))) return [{ type: "goto" as const, x: m[1], y: m[2] }];
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
      case "sleep": return `sleep(${s.ms})`;
      case "send":  return `send(${s.text})`;
      default:      return s.type;
    }
  }).join(";");
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

// ── Step sub-components ───────────────────────────────────────────────────────

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
      <input type="number" value={x} onChange={e => onChange(e.target.value, y)} placeholder="x" />
      <input type="number" value={y} onChange={e => onChange(x, e.target.value)} placeholder="y" />
      <button className="btn btn--ghost btn--sm" onClick={pick} disabled={picking}>
        {picking ? "Click game…" : "🎯 Pick"}
      </button>
    </div>
  );
}

function StepRow({ step, index, total, gameExe, onChange, onDelete, onMove }: {
  step: Step;
  index: number;
  total: number;
  gameExe: string;
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

function HotkeyModal({ initial, gameExe, onSave, onClose }: {
  initial: Hotkey;
  gameExe: string;
  onSave: (hk: Hotkey) => void;
  onClose: () => void;
}) {
  const [trigger, setTrigger] = useState(initial.trigger);
  const [recordingTrigger, setRecordingTrigger] = useState(false);
  const [steps, setSteps] = useState<Step[]>(() => parseSteps(initial.behavior));

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
              : <input value={trigger} onChange={e => setTrigger(e.target.value)} placeholder="e.g. f1 / shift f1 / ctrl alt z" />
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
              <StepRow key={i} step={step} index={i} total={steps.length} gameExe={gameExe}
                onChange={s => updateStep(i, s)}
                onDelete={() => removeStep(i)}
                onMove={dir => moveStep(i, dir)} />
            ))}
            {steps.length === 0 && <div className="steps-empty">No steps — add one below</div>}
          </div>
          <div className="step-add-btns">
            <span className="step-add-label">+ Add:</span>
            <button className="btn btn--ghost btn--sm" onClick={() => addStep({ type: "press", key: "" })}>press</button>
            <button className="btn btn--ghost btn--sm" onClick={() => addStep({ type: "hold", key: "" })}>hold</button>
            <button className="btn btn--ghost btn--sm" onClick={() => addStep({ type: "goto", x: "", y: "" })}>goto</button>
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
            onClick={() => trigger.trim() && onSave({ trigger: trigger.trim(), behavior: stepsToString(steps) })}>
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
            <option value="">— None —</option>
            {options.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <p className="hint">Hotkeys from the parent are inherited. Hotkeys with the same trigger in this profile override the parent.</p>
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

  useEffect(() => {
    const valid = game.profiles.some(p => p.id === profileId);
    if (!valid) {
      setProfileId(game.active_profile ?? game.profiles[0]?.id ?? "");
    }
  }, [game.id, game.profiles.length, game.active_profile]);

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
              try { await api.makeBorderlessFullscreen(game.exe); }
              catch (e) { alert(String(e)); }
            }}>⛶ Borderless</button>
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
          {game.profiles.length === 0 && <option value="">— no profiles —</option>}
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

      {/* Hotkeys table */}
      {profile ? (
        <>
          <table className="hk-table">
            <thead>
              <tr>
                <th>Trigger</th>
                <th>Behavior</th>
                <th style={{ width: 100 }}></th>
              </tr>
            </thead>
            <tbody>
              {resolveHotkeys(game.profiles, profile).map(({ hotkey: hk, own }, i) => {
                const ownIndex = own ? profile.hotkeys.findIndex(h => h.trigger === hk.trigger) : -1;
                return (
                  <tr key={i} className={own ? "" : "hk-row--inherited"}>
                    <td><code>{hk.trigger}</code></td>
                    <td className="hk-behavior">{hk.behavior}</td>
                    <td className="hk-actions">
                      {own ? (
                        <>
                          <button className="icon-btn" title="Edit"
                            onClick={() => onModal({ type: "editHotkey", gameId: game.id, profileId, index: ownIndex, hotkey: hk, gameExe: game.exe })}>
                            ✏
                          </button>
                          <button className="icon-btn icon-btn--danger" title="Delete" onClick={() => deleteHotkey(ownIndex)}>
                            ✕
                          </button>
                        </>
                      ) : (
                        <button className="icon-btn" title="Override in this profile"
                          onClick={async () => {
                            const db = await api.upsertProfile(game.id, { ...profile, hotkeys: [...profile.hotkeys, { ...hk }] });
                            onDb(db);
                          }}>
                          ✎ Override
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {resolveHotkeys(game.profiles, profile).length === 0 && (
                <tr><td colSpan={3} className="empty-row">No hotkeys yet</td></tr>
              )}
            </tbody>
          </table>
          <button className="btn btn--ghost btn--sm add-hk-btn"
            onClick={() => onModal({ type: "editHotkey", gameId: game.id, profileId, index: null, hotkey: { trigger: "", behavior: "" }, gameExe: game.exe })}>
            + Add Hotkey
          </button>
        </>
      ) : (
        <p className="empty-row">Create a profile to start adding hotkeys.</p>
      )}
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
          <input value={ahkExe} onChange={e => setAhkExe(e.target.value)}
            placeholder="Leave empty to use AutoHotkey.exe from PATH" />
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
      const profile: Profile = { id: uid(), name, hotkeys: [] };
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

  async function handleCopyProfile(sourceGameId: string, profile: Profile, targetGameId: string, name: string) {
    try {
      const copy: Profile = { id: uid(), name, parent_id: null, hotkeys: [...profile.hotkeys] };
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
        const { gameId, profileId: pid, index, hotkey, gameExe } = modal;
        return <HotkeyModal initial={hotkey} gameExe={gameExe}
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
    </div>
  );
}
