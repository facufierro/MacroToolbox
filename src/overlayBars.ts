import type { OverlayBar, Scope } from "./types";

export function assignOverlayBar(bars: OverlayBar[], groupId: string, barId: string): OverlayBar[] {
  return bars.map(bar => ({ ...bar, group_ids: bar.id === barId
    ? bar.group_ids.includes(groupId) ? bar.group_ids : [...bar.group_ids, groupId]
    : bar.group_ids.filter(id => id !== groupId) }));
}

export function saveOverlayBar(bars: OverlayBar[], bar: OverlayBar): OverlayBar[] {
  const others = bars.map(current => current.id === bar.id ? bar
    : { ...current, group_ids: current.group_ids.filter(id => !bar.group_ids.includes(id)) });
  return others.some(current => current.id === bar.id) ? others : [...others, bar];
}

// Merge only edited bars. A second editor must not silently overwrite their layout or order.
export function updateOverlayBars(scope: Scope, original: OverlayBar[], edited: OverlayBar[]): Scope {
  const latest = scope.overlay_bars ?? [];
  const changed = new Set([...original, ...edited].map(bar => bar.id).filter(id =>
    JSON.stringify(original.find(bar => bar.id === id)) !== JSON.stringify(edited.find(bar => bar.id === id))));
  for (const id of changed) {
    if (JSON.stringify(latest.find(bar => bar.id === id)) !== JSON.stringify(original.find(bar => bar.id === id))) {
      throw new Error("The overlay bar changed in another editor. Reopen this overlay before saving.");
    }
  }
  return { ...scope, overlay_bars: [...latest.flatMap(bar => changed.has(bar.id) ? edited.filter(current => current.id === bar.id) : [bar]),
    ...edited.filter(bar => changed.has(bar.id) && !latest.some(current => current.id === bar.id))] };
}

export type OverlayExtent = { id: string; left: number; top: number; right: number; bottom: number };

export function getOverlayBarOffsets(extents: OverlayExtent[], layout: OverlayBar["layout"], gap: number): Record<string, number> {
  const offsets: Record<string, number> = {};
  let previousEnd: number | undefined;
  for (const extent of extents) {
    const start = layout === "row" ? extent.left : extent.top;
    const end = layout === "row" ? extent.right : extent.bottom;
    const offset = previousEnd === undefined ? 0 : previousEnd + gap - start;
    offsets[extent.id] = offset;
    previousEnd = offset + end;
  }
  return offsets;
}
