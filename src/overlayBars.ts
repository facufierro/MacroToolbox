import type { OverlayBar, Scope } from "./types";

export type LegacyOverlayBar = Omit<OverlayBar, "direction"> & { layout: "row" | "column" };

export function readOverlayBar(bar: OverlayBar | LegacyOverlayBar): OverlayBar {
  if ("direction" in bar) return bar;
  const { layout, ...rest } = bar;
  if (layout !== "row" && layout !== "column") throw new Error("Invalid overlay bar direction");
  return { ...rest, direction: layout === "row" ? "right" : "down" };
}

export function isHorizontalBar(direction: OverlayBar["direction"]): boolean {
  return direction === "right" || direction === "left";
}

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

export function getOverlayBarOffsets(extents: OverlayExtent[], direction: OverlayBar["direction"], gap: number): Record<string, number> {
  const offsets: Record<string, number> = {};
  const horizontal = isHorizontalBar(direction);
  const reverse = direction === "left" || direction === "up";
  let previousEdge: number | undefined;
  for (const extent of extents) {
    const start = horizontal ? extent.left : extent.top;
    const end = horizontal ? extent.right : extent.bottom;
    const offset = previousEdge === undefined ? 0 : reverse ? previousEdge - gap - end : previousEdge + gap - start;
    offsets[extent.id] = offset;
    previousEdge = offset + (reverse ? start : end);
  }
  return offsets;
}
