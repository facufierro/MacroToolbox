import { useState, useEffect, useCallback } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import type { Database, Game, Profile, Hotkey } from "./types";
import "./App.css";

type View = "dashboard" | "game" | "settings";

type Modal =
  | { type: "addGame" }
  | { type: "editGame"; game: Game }
  | { type: "addProfile"; gameId: string }
  | { type: "editHotkey"; gameId: string; profileId: string; index: number | null; hotkey: Hotkey };

// ── Helpers ──────────────────────────────────────────────────────────────────

function uid() {
  return crypto.randomUUID();
}

function blankGame(): Game {
  return { id: uid(), name: "", exe: "", image: null, active_profile: null, profiles: [] };
}

function blankProfile(gameId: string): Profile {
  void gameId;
  return { id: uid(), name: "", hotkeys: [] };
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

function ProfileModal({ onSave, onClose }: {
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <div className="modal-overlay">
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>New Profile</h2>
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

function HotkeyModal({ initial, onSave, onClose }: {
  initial: Hotkey;
  onSave: (hk: Hotkey) => void;
  onClose: () => void;
}) {
  const [trigger, setTrigger] = useState(initial.trigger);
  const [behavior, setBehavior] = useState(initial.behavior);

  return (
    <div className="modal-overlay">
      <div className="modal modal--wide" onClick={e => e.stopPropagation()}>
        <h2>{initial.trigger ? "Edit Hotkey" : "Add Hotkey"}</h2>
        <label>Trigger
          <input value={trigger} onChange={e => setTrigger(e.target.value)}
            placeholder="e.g.  f1  /  shift f1  /  ctrl alt z" />
        </label>
        <label>Behavior
          <textarea rows={4} value={behavior} onChange={e => setBehavior(e.target.value)}
            placeholder="e.g.  press(ctrl 0);lock;goto(1638,621);press(m1);restorecursor" />
        </label>
        <p className="hint">
          Steps separated by <code>;</code> — available: <code>press(key)</code>, <code>hold(key)</code>,
          <code>goto(x,y)</code>, <code>lock</code>, <code>restorecursor</code>,
          <code>savecursor</code>, <code>sleep(ms)</code>, <code>send(text)</code>
        </p>
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary"
            onClick={() => trigger.trim() && onSave({ trigger: trigger.trim(), behavior: behavior.trim() })}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Game detail view ──────────────────────────────────────────────────────────

function GameView({ game, running, onDb, onModal }: {
  game: Game;
  running: boolean;
  onDb: (db: Database) => void;
  onModal: (m: Modal) => void;
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
    await api.deactivateAhk();
    const db = await api.deleteGame(game.id);
    onDb(db);
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
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {profile.hotkeys.map((hk, i) => (
                <tr key={i}>
                  <td><code>{hk.trigger}</code></td>
                  <td className="hk-behavior">{hk.behavior}</td>
                  <td className="hk-actions">
                    <button className="icon-btn" title="Edit"
                      onClick={() => onModal({ type: "editHotkey", gameId: game.id, profileId, index: i, hotkey: hk })}>
                      ✏
                    </button>
                    <button className="icon-btn icon-btn--danger" title="Delete" onClick={() => deleteHotkey(i)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {profile.hotkeys.length === 0 && (
                <tr><td colSpan={3} className="empty-row">No hotkeys yet</td></tr>
              )}
            </tbody>
          </table>
          <button className="btn btn--ghost btn--sm add-hk-btn"
            onClick={() => onModal({ type: "editHotkey", gameId: game.id, profileId, index: null, hotkey: { trigger: "", behavior: "" } })}>
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
          <GameView game={selectedGame} running={running} onDb={handleDb} onModal={setModal} />
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
        return <ProfileModal onSave={name => handleProfileSave(gameId, name)} onClose={() => setModal(null)} />;
      })()}
      {modal?.type === "editHotkey" && (() => {
        const { gameId, profileId: pid, index, hotkey } = modal;
        return <HotkeyModal initial={hotkey}
          onSave={hk => handleHotkeySave(gameId, pid, index, hk)}
          onClose={() => setModal(null)} />;
      })()}
    </div>
  );
}
