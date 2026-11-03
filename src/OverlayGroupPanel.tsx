import { IconButton } from "./Icon";
import { useErrorReporter } from "./AppConsole";
import { useState, type DragEventHandler, type ReactNode } from "react";
import { GotoInput } from "./BehaviorEditor";
import { CompactNumber } from "./CompactNumber";
import { EnableSwitch } from "./EnableSwitch";
import type { OverlayGroup, OverlayItem } from "./types";

const PART_ICONS = { timer: "clock", icon: "image", bar: "chart-simple", text: "font" } as const;
const PART_LABELS = { timer: "Timer", icon: "Icon", bar: "Bar", text: "Text" } as const;

export function OverlayGroupPanel({ group, items, timers, gameExe, children, partsEditable = true, dropActive, onDragOver, onDragLeave, onDrop, onSave, onEnabledChange, onDuplicate, onDelete, onAdd, onHotkey }: {
  group: OverlayGroup;
  items: OverlayItem[];
  timers: OverlayItem[];
  gameExe: string;
  children: ReactNode;
  partsEditable?: boolean;
  dropActive?: boolean;
  onDragOver?: DragEventHandler<HTMLFieldSetElement>;
  onDragLeave?: DragEventHandler<HTMLFieldSetElement>;
  onDrop?: DragEventHandler<HTMLFieldSetElement>;
  onSave: (group: OverlayGroup, members: string[]) => Promise<void>;
  onEnabledChange: (enabled: boolean) => Promise<void>;
  onDuplicate: () => Promise<void>;
  onDelete?: () => Promise<void>;
  onAdd: (type: OverlayItem["type"]) => void;
  onHotkey: () => void;
}) {
  const reportError = useErrorReporter();
  const [changes, setChanges] = useState<Partial<OverlayGroup>>({});
  const current = { ...group, name: group.name || "Overlay" };
  const draft = { ...current, ...changes };
  const dirty = Object.keys(changes).some(key => draft[key as keyof OverlayGroup] !== current[key as keyof OverlayGroup]);
  function change(patch: Partial<OverlayGroup>) { setChanges(previous => ({ ...previous, ...patch })); }
  const [addingPart, setAddingPart] = useState(false);
  const [choosingParts, setChoosingParts] = useState(false);
  const members = items.filter(item => item.group_id === group.id).map(item => item.id);
  const availableParts = items.filter(item => item.group_id !== group.id);
  const [saving, setSaving] = useState(false);
  const flow = draft.layout === "row" || draft.layout === "column";
  async function save() {
    setSaving(true);
    try { await onSave({ ...draft, disabled: group.disabled, name: draft.name.trim() }, members); setChanges({}); }
    catch (error) { reportError(error); }
    finally { setSaving(false); }
  }
  async function movePart(id: string) {
    setSaving(true);
    try { await onSave(group, [...members, id]); }
    catch (error) { reportError(error); }
    finally { setSaving(false); }
  }
  async function duplicate() {
    setSaving(true);
    try { await onDuplicate(); }
    catch (error) { reportError(error); }
    finally { setSaving(false); }
  }
  return <fieldset className={`overlay-group${group.disabled ? " overlay-group--disabled" : ""}`} aria-label={group.name || "Overlay"} disabled={saving}
    data-item-drop={dropActive || undefined} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
    <div className="section-head overlay-group__head">
      <input className="overlay-group__name" aria-label="Overlay name" title="Overlay name" value={draft.name} onChange={event => change({ name: event.target.value })} />
      <div className="section-head__actions">
        <IconButton showLabel icon="plus" label="Add part" className="btn btn--ghost btn--sm" disabled={!partsEditable} aria-expanded={addingPart} onClick={() => setAddingPart(!addingPart)} />
        {availableParts.length > 0 && <IconButton icon="right-left" label="Move existing" className="btn btn--ghost btn--sm" disabled={!partsEditable} aria-expanded={choosingParts} onClick={() => setChoosingParts(!choosingParts)} />}
        <IconButton icon="keyboard" label="Add hotkey" className="btn btn--ghost btn--sm" onClick={onHotkey} />
        <IconButton icon="copy" label="Duplicate overlay" className="icon-btn" onClick={duplicate} />
        {onDelete && <IconButton icon="trash-can" label="Delete overlay" className="icon-btn icon-btn--danger" disabled={!partsEditable} onClick={() => onDelete().catch(error => reportError(error))} />}
        <EnableSwitch enabled={!group.disabled} label={`${group.name || "Overlay"} enabled`} onChange={value => onEnabledChange(value).catch(error => reportError(error))} />
      </div>
    </div>
    <fieldset className="overlay-group__config" aria-label="Overlay settings">
        <select className="overlay-group__visibility" aria-label="Show overlay" title="Show this overlay always or while a selected timer is running" value={draft.visible_while_timer_id ?? ""} onChange={event => change({ visible_while_timer_id: event.target.value || null })}>
          <option value="">Always</option>
          {timers.map(item => <option key={item.id} value={item.id}>While {item.name || "Timer"}</option>)}
        </select>
        <select className="overlay-group__layout" aria-label="Arrange parts" title="Arrange parts horizontally, vertically, or at individual positions" value={draft.layout ?? "free"} onChange={event => change({ layout: event.target.value as OverlayGroup["layout"] })}>
          <option value="row">Horizontal</option><option value="column">Vertical</option><option value="free">Individual</option>
        </select>
        <CompactNumber label="Gap (px)" prefix="Gap" unit="px" min={0} disabled={!flow} value={draft.gap ?? 8} onChange={value => change({ gap: Number(value) })} />
        <div className="overlay-group__position">
          <GotoInput x={String(draft.x ?? 0)} y={String(draft.y ?? 0)} gameExe={gameExe}
            onChange={(x, y) => change({ x: Number(x), y: Number(y) })} />
        </div>
        {dirty && <div className="overlay-group__save">
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => setChanges({})}>Cancel</button>
          <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={!draft.name.trim() || !Number.isFinite(draft.x ?? 0) || !Number.isFinite(draft.y ?? 0) || !Number.isInteger(draft.gap ?? 8) || (draft.gap ?? 8) < 0}>Save</button>
        </div>}
    </fieldset>
    {addingPart && <div className="overlay-group__add" aria-label="Part types">
      {(["timer", "icon", "bar", "text"] as const).map(type => <IconButton showLabel icon={PART_ICONS[type]} label={PART_LABELS[type]} key={type} className="btn btn--ghost btn--sm" disabled={!partsEditable} onClick={() => { setAddingPart(false); onAdd(type); }} />)}
    </div>}
    {choosingParts && <fieldset className="overlay-group__members" aria-label="Move existing parts">
      {availableParts.map(item => <button type="button" className="btn btn--ghost btn--sm" disabled={!partsEditable} key={item.id} onClick={() => { void movePart(item.id); }}>{item.name || item.type}</button>)}
    </fieldset>}
    <div className="steps-list">{children}</div>
  </fieldset>;
}
