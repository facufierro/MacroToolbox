import { IconButton } from "./Icon";
import { useErrorReporter } from "./AppConsole";
import { useState, type ReactNode } from "react";
import { GotoInput } from "./BehaviorEditor";
import { EnableSwitch } from "./EnableSwitch";
import type { OverlayGroup, OverlayItem } from "./types";

const PART_ICONS = { timer: "clock", icon: "image", bar: "chart-simple", text: "font" } as const;
const PART_LABELS = { timer: "Timer", icon: "Icon", bar: "Bar", text: "Text" } as const;

export function OverlayGroupPanel({ group, items, timers, gameExe, children, onSave, onEnabledChange, onDelete, onAdd, onHotkey }: {
  group: OverlayGroup;
  items: OverlayItem[];
  timers: OverlayItem[];
  gameExe: string;
  children: ReactNode;
  onSave: (group: OverlayGroup, members: string[]) => Promise<void>;
  onEnabledChange: (enabled: boolean) => Promise<void>;
  onDelete?: () => Promise<void>;
  onAdd: (type: OverlayItem["type"]) => void;
  onHotkey: () => void;
}) {
  const reportError = useErrorReporter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(group);
  const [choosingParts, setChoosingParts] = useState(false);
  const members = items.filter(item => item.group_id === group.id).map(item => item.id);
  const availableParts = items.filter(item => item.group_id !== group.id);
  const [saving, setSaving] = useState(false);
  const flow = draft.layout === "row" || draft.layout === "column";
  function edit() {
    setDraft({ ...group, name: group.name || "Overlay" });
    setEditing(true);
  }
  async function save() {
    setSaving(true);
    try { await onSave({ ...draft, disabled: group.disabled, name: draft.name.trim() }, members); setEditing(false); }
    catch (error) { reportError(error); }
    finally { setSaving(false); }
  }
  async function movePart(id: string) {
    setSaving(true);
    try { await onSave(group, [...members, id]); }
    catch (error) { reportError(error); }
    finally { setSaving(false); }
  }
  return <fieldset className={`overlay-group${group.disabled ? " overlay-group--disabled" : ""}`} aria-label={group.name || "Overlay"} disabled={saving}>
    <div className="section-head overlay-group__head">
      <h3>{group.name || "Overlay"}</h3>
      {group.visible_while_timer_id && <span className="overlay-item-desc">While {timers.find(item => item.id === group.visible_while_timer_id)?.name || "Timer"} is running</span>}
      <div className="section-head__actions">
        <IconButton icon="plus" label="Add hotkey" className="btn btn--ghost btn--sm" onClick={onHotkey} />
        <IconButton showLabel icon="gear" label="Settings" className="btn btn--ghost btn--sm" aria-expanded={editing} onClick={() => editing ? setEditing(false) : edit()} />
        {onDelete && <IconButton icon="trash-can" label="Delete overlay" className="icon-btn icon-btn--danger" onClick={() => onDelete().catch(error => reportError(error))} />}
        <EnableSwitch enabled={!group.disabled} label={`${group.name || "Overlay"} enabled`} onChange={value => onEnabledChange(value).catch(error => reportError(error))} />
      </div>
    </div>
    {editing && <fieldset className="overlay-group__config" aria-label="Overlay settings">
        <label>Name <input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Show overlay
          <select value={draft.visible_while_timer_id ?? ""} onChange={event => setDraft({ ...draft, visible_while_timer_id: event.target.value || null })}>
            <option value="">Always</option>
            {timers.map(item => <option key={item.id} value={item.id}>While {item.name || "Timer"} is running</option>)}
          </select>
        </label>
        <div className="overlay-group__layout-row">
          <div className="overlay-group__field">
            <span>Arrange parts</span>
            <div className="overlay-group__layouts" role="group" aria-label="Arrange parts">
              {([
                ["row", "Horizontal"], ["column", "Vertical"], ["free", "Individual positions"],
              ] as const).map(([layout, label]) => <button key={layout} type="button"
                aria-pressed={(draft.layout ?? "free") === layout} onClick={() => setDraft({ ...draft, layout })}>{label}</button>)}
            </div>
          </div>
          <label>Gap (px) <input type="number" min={0} disabled={!flow} value={draft.gap ?? 8} onChange={event => setDraft({ ...draft, gap: Number(event.target.value) })} /></label>
        </div>
        <div className="overlay-group__position">
          <span>Position</span>
          <GotoInput x={String(draft.x ?? 0)} y={String(draft.y ?? 0)} gameExe={gameExe}
            onChange={(x, y) => setDraft({ ...draft, x: Number(x), y: Number(y) })} />
        </div>
        <div className="overlay-group__save">
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => setEditing(false)}>Cancel</button>
          <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={!draft.name.trim() || !Number.isFinite(draft.x ?? 0) || !Number.isFinite(draft.y ?? 0) || !Number.isInteger(draft.gap ?? 8) || (draft.gap ?? 8) < 0}>Save</button>
        </div>
    </fieldset>}
    <div className="overlay-group__parts-head">
      <h4>Parts</h4>
      <div className="overlay-group__add">
        {(["timer", "icon", "bar", "text"] as const).map(type => <IconButton showLabel icon={PART_ICONS[type]} label={PART_LABELS[type]} key={type} className="btn btn--ghost btn--sm" onClick={() => onAdd(type)} />)}
        {availableParts.length > 0 && <IconButton showLabel icon="right-left" label="Move existing" className="btn btn--ghost btn--sm" aria-expanded={choosingParts} onClick={() => setChoosingParts(!choosingParts)} />}
      </div>
    </div>
    {choosingParts && <fieldset className="overlay-group__members" aria-label="Move existing parts">
      {availableParts.map(item => <button type="button" className="btn btn--ghost btn--sm" key={item.id} onClick={() => { void movePart(item.id); }}>{item.name || item.type}</button>)}
    </fieldset>}
    <div className="steps-list">{children}</div>
  </fieldset>;
}
