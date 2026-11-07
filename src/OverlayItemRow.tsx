import { IconButton } from "./Icon";
import type { OverlayItem, ProfileState } from "./types";

function overlayItemDesc(item: OverlayItem, states: ProfileState[]): string {
  const pos = `(${item.x}, ${item.y})`;
  const stateLabel = states.find(state => state.id === item.state_id)?.name;
  const stateText = stateLabel ? `, visible with ${stateLabel}` : "";
  switch (item.type) {
    case "timer": {
      const m = Math.floor(item.duration_ms / 60000);
      const s = String(Math.floor((item.duration_ms % 60000) / 1000)).padStart(2, "0");
      const timerStateLabel = states.find(state => state.id === item.timer_state_id)?.name;
      const timerText = timerStateLabel ? `, reads ${timerStateLabel} timer` : "";
      return `${m}:${s}, ${item.font_size}px at ${pos}${stateText}${timerText}`;
    }
    case "icon":  return `${item.w}x${item.h} at ${pos}${stateText}`;
    case "bar":   return `${item.w}x${item.h} max ${item.max_value} at ${pos}${stateText}`;
    case "text":  return `"${item.content}" ${item.font_size}px at ${pos}${stateText}`;
  }
}

export function OverlayItemRow({ item, groupName, states, inherited, onEdit, onDelete, onOverride, selected, editing }: {
  item: OverlayItem;
  groupName: string;
  states: ProfileState[];
  inherited: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onOverride?: () => void;
  selected: boolean;
  editing: boolean;
}) {
  const prefix = `${groupName} `;
  const name = item.name.startsWith(prefix) ? item.name.slice(prefix.length) : item.name;
  const description = overlayItemDesc(item, states);
  const label = <><span className={`overlay-type-badge overlay-type-badge--${item.type}`} title={item.name}>{name}</span><span className="overlay-item-desc" title={description}>{description}</span></>;
  return (
    <div className={`step-row${inherited ? " step-row--muted" : ""}${selected ? " overlay-item-row--selected" : ""}`}>
      {onEdit ? <button type="button" className="overlay-item-row__open" aria-label={`Edit ${item.name}`} title={`Edit ${item.name}`} aria-expanded={selected} disabled={editing && !selected} onClick={onEdit}>{label}</button>
        : <div className="overlay-item-row__open">{label}</div>}
      <div className="step-row__btns">
        {inherited ? (
          <IconButton icon="pen" label="Override" className="icon-btn" disabled={editing} onClick={onOverride} />
        ) : (
          <IconButton icon="trash-can" label="Delete" className="icon-btn icon-btn--danger" disabled={editing} onClick={onDelete} />
        )}
      </div>
    </div>
  );
}
