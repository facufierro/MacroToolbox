import { useState } from "react";
import { CompactNumber } from "./CompactNumber";
import { GotoInput } from "./GotoInput";
import { IconButton } from "./Icon";
import { SortableList } from "./SortableList";
import { moveItem } from "./listOrder";
import type { OverlayBar, OverlayGroup } from "./types";

export function OverlayBarEditor({ initial, groups, bars, gameExe, onSave, onDelete, onClose }: {
  initial: OverlayBar;
  groups: OverlayGroup[];
  bars: OverlayBar[];
  gameExe: string;
  onSave: (bar: OverlayBar) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [bar, setBar] = useState(initial);
  const available = groups.filter(group => !bar.group_ids.includes(group.id)
    && !bars.some(other => other.id !== bar.id && other.group_ids.includes(group.id)));
  const valid = bar.name.trim() && Number.isFinite(bar.x) && Number.isFinite(bar.y)
    && Number.isInteger(bar.gap) && bar.gap >= 0 && bar.gap <= 0xffffffff;
  return <fieldset className="overlay-group overlay-bar-editor" aria-label="Edit overlay bar">
    <div className="section-head overlay-group__head">
      <input className="overlay-group__name" aria-label="Bar name" value={bar.name} onChange={event => setBar({ ...bar, name: event.target.value })} />
      {onDelete && <IconButton icon="trash-can" label="Remove bar" className="icon-btn icon-btn--danger" onClick={onDelete} />}
    </div>
    <fieldset className="overlay-group__config" aria-label="Bar layout">
      <select aria-label="Bar direction" value={bar.layout} onChange={event => setBar({ ...bar, layout: event.target.value as OverlayBar["layout"] })}>
        <option value="row">Horizontal</option><option value="column">Vertical</option>
      </select>
      <CompactNumber label="Bar gap (px)" prefix="Gap" unit="px" min={0} value={Number.isNaN(bar.gap) ? "" : bar.gap} onChange={value => setBar({ ...bar, gap: value === "" ? NaN : Number(value) })} />
      <GotoInput x={Number.isNaN(bar.x) ? "" : String(bar.x)} y={Number.isNaN(bar.y) ? "" : String(bar.y)} gameExe={gameExe}
        onChange={(x, y) => setBar({ ...bar, x: x === "" ? NaN : Number(x), y: y === "" ? NaN : Number(y) })} />
    </fieldset>
    <SortableList className="steps-list" items={bar.group_ids} itemKey={id => id} itemLabel={id => groups.find(group => group.id === id)?.name || "Overlay"}
      onReorder={(from, to, after) => setBar({ ...bar, group_ids: moveItem(bar.group_ids, id => id, from, to, after) })}
      empty={<div className="steps-empty">No overlays in this bar</div>}>
      {id => <div className="overlay-bar-member"><span>{groups.find(group => group.id === id)?.name || "Missing overlay"}</span>
        <IconButton icon="xmark" label="Remove from bar" className="icon-btn" onClick={() => setBar({ ...bar, group_ids: bar.group_ids.filter(member => member !== id) })} />
      </div>}
    </SortableList>
    <select aria-label="Add overlay to bar" value="" onChange={event => setBar({ ...bar, group_ids: [...bar.group_ids, event.target.value] })}>
      <option value="">Add overlay…</option>
      {available.map(group => <option key={group.id} value={group.id}>{group.name || "Overlay"}</option>)}
    </select>
    <div className="modal__actions">
      <button type="button" className="btn btn--secondary btn--sm" onClick={onClose}>Cancel bar</button>
      <button type="button" className="btn btn--primary btn--sm" disabled={!valid} onClick={() => onSave({ ...bar, name: bar.name.trim() })}>Apply bar</button>
    </div>
  </fieldset>;
}
