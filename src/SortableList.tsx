import { useRef, useState, type ReactNode } from "react";
import { useErrorReporter } from "./AppConsole";
import { moveItem } from "./listOrder";

const DRAG_TYPE = "application/x-macrotoolbox-sort";

export function SortableList<T>({ items, itemKey, itemLabel, canMove = () => true, onReorder, children, empty, className = "steps-list" }: {
  items: T[];
  itemKey: (item: T, index: number) => string;
  itemLabel: (item: T, index: number) => string;
  canMove?: (item: T) => boolean;
  onReorder: (from: string, to: string, after: boolean) => void | Promise<void>;
  children: (item: T, index: number) => ReactNode;
  empty?: ReactNode;
  className?: string;
}) {
  const reportError = useErrorReporter();
  const source = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<{ key: string; after: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const movable = items.map((item, index) => ({ item, key: itemKey(item, index) })).filter(({ item }) => canMove(item));
  function clearDrag() { source.current = null; setDragging(null); setTarget(null); }
  async function reorder(from: string, to: string, after: boolean) {
    if (saving || moveItem(movable, entry => entry.key, from, to, after) === movable) return;
    setSaving(true);
    try { await onReorder(from, to, after); }
    catch (error) { reportError(error); }
    finally { setSaving(false); }
  }
  return <div className={className} aria-busy={saving}>
    {items.map((item, index) => {
      const key = itemKey(item, index);
      const enabled = canMove(item) && movable.length > 1;
      return <div key={key} className={`sortable-item${dragging === key ? " sortable-item--dragging" : ""}`}
        data-drop={target?.key === key ? target.after ? "after" : "before" : undefined}
        onDragOver={event => {
          if (event.dataTransfer.types.includes(DRAG_TYPE)) event.preventDefault();
          if ((event.target as Element).closest(".sortable-item") !== event.currentTarget) {
            if (source.current !== null) setTarget(null);
            return;
          }
          if (!enabled || saving || source.current === null) { event.dataTransfer.dropEffect = "none"; return; }
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          const bounds = event.currentTarget.getBoundingClientRect();
          setTarget({ key, after: event.clientY >= bounds.top + bounds.height / 2 });
        }}
        onDragLeave={event => {
          if (source.current !== null && !event.currentTarget.contains(event.relatedTarget as Node | null)) setTarget(null);
        }}
        onDrop={event => {
          if (event.dataTransfer.types.includes(DRAG_TYPE)) event.preventDefault();
          if ((event.target as Element).closest(".sortable-item") !== event.currentTarget) return;
          if (!enabled || saving || source.current === null) return;
          event.stopPropagation();
          const from = source.current;
          const bounds = event.currentTarget.getBoundingClientRect();
          clearDrag();
          void reorder(from, key, event.clientY >= bounds.top + bounds.height / 2);
        }}>
        {enabled ? <button type="button" className="drag-handle" draggable={!saving} disabled={saving}
          aria-label={`Move ${itemLabel(item, index)}`}
          onClick={event => event.stopPropagation()}
          onDragStart={event => {
            event.stopPropagation();
            source.current = key; setDragging(key);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData(DRAG_TYPE, key);
            event.dataTransfer.setDragImage(event.currentTarget.parentElement!, 12, 12);
          }}
          onDragEnd={event => { event.stopPropagation(); clearDrag(); }}
          onKeyDown={event => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault(); event.stopPropagation();
            const neighbor = movable[movable.findIndex(entry => entry.key === key) + (event.key === "ArrowUp" ? -1 : 1)];
            if (neighbor) void reorder(key, neighbor.key, event.key === "ArrowDown");
          }}>
          <svg viewBox="0 0 12 18" width="12" height="18" fill="currentColor" aria-hidden="true">
            {[3, 9, 15].flatMap(y => [3, 9].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.4" />))}
          </svg>
        </button> : <span className="drag-handle-placeholder" />}
        <div className="sortable-item__content">{children(item, index)}</div>
      </div>;
    })}
    {items.length === 0 && empty}
  </div>;
}
