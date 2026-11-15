import "./overlayParts.css";
import { Children, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { OverlayBar, OverlayGroup, OverlayItem } from "./types";
import { getOverlayItemPosition } from "./overlayPosition";
import { getOverlayBarOffsets, isHorizontalBar, type OverlayExtent } from "./overlayBars";

export function OverlayBarView({ bar, origin, groups }: { bar: OverlayBar; origin: [number, number, number, number]; groups: Array<{ id: string; view: ReactNode }> }) {
  const slots = useRef(new Map<string, HTMLDivElement>());
  const [offsets, setOffsets] = useState<Record<string, number>>({});
  const horizontal = isHorizontalBar(bar.direction);
  // Absolute parts and centered timers can overflow their group. Space their full visible bounds.
  useLayoutEffect(() => {
    const extents: OverlayExtent[] = [];
    for (const { id } of groups) {
      const slot = slots.current.get(id);
      if (!slot) continue;
      const anchor = slot.getBoundingClientRect();
      const parts = [...slot.querySelectorAll<HTMLElement>("[data-overlay-part]")].map(part => part.getBoundingClientRect())
        .filter(rect => rect.width > 0 && rect.height > 0);
      if (parts.length) extents.push({ id, left: Math.min(...parts.map(rect => rect.left)) - anchor.left,
        top: Math.min(...parts.map(rect => rect.top)) - anchor.top,
        right: Math.max(...parts.map(rect => rect.right)) - anchor.left,
        bottom: Math.max(...parts.map(rect => rect.bottom)) - anchor.top });
    }
    const next = getOverlayBarOffsets(extents, bar.direction, bar.gap);
    // Scaled DOM measurements can alternate by tiny rounding errors after placement.
    // Keep positions stable when the difference is less than a thousandth of a pixel.
    setOffsets(previous => Object.keys(previous).length === Object.keys(next).length
      && Object.entries(next).every(([id, offset]) => id in previous && Math.abs(previous[id] - offset) < 0.001)
      ? previous : next);
  });
  return <div className="ov-overlay-bar" style={{ position: "absolute", ...getOverlayItemPosition(bar, origin) }}>
    {groups.map(({ id, view }) => <div key={id} className="ov-bar-slot" ref={element => { if (element) slots.current.set(id, element); else slots.current.delete(id); }}
      style={{ position: "absolute", left: horizontal ? offsets[id] ?? 0 : 0, top: horizontal ? 0 : offsets[id] ?? 0 }}>{view}</div>)}
  </div>;
}

export function OverlayGroupView({ group, origin, children, inBar = false }: { group: OverlayGroup; origin: [number, number, number, number]; children: ReactNode; inBar?: boolean }) {
  const flow = group.layout === "row" || group.layout === "column";
  return <div style={{ ...(inBar ? { position: "relative", width: "max-content" } : { position: "absolute",
    ...getOverlayItemPosition({ x: group.x ?? 0, y: group.y ?? 0 }, origin) }),
    ...(flow ? { display: "flex", flexDirection: group.layout as "row" | "column", alignItems: "center", gap: group.gap ?? 8 } : {}) }}>
    {flow ? Children.map(children, (child, index) => index === 0 ? child :
      <div className={`ov-flow-slot ov-flow-slot--${group.layout}`}>{child}</div>) : children}
  </div>;
}

export function OverlayItemView({ item, origin, remainingMs, value, flow, onMount }: { item: OverlayItem; origin: [number, number, number, number]; remainingMs: number | null; value?: number; flow?: boolean; onMount: (el: HTMLElement | null) => void }) {
  // Put position on the wrapper so getBoundingClientRect() returns real bounds for hit-testing.
  // Inner components get an empty style so they don't double-apply the offset.
  const pos: CSSProperties = {
    display: "flex",
    ...(flow ? { position: "relative", flexShrink: 0 } : {
      position: "absolute",
      ...getOverlayItemPosition(item, origin),
    }),
  };
  switch (item.type) {
    case "timer": return <div data-overlay-part={item.id} ref={onMount} style={pos}><TimerView item={item} style={{}} remainingMs={remainingMs ?? item.duration_ms} /></div>;
    case "icon":  return <div data-overlay-part={item.id} ref={onMount} style={pos}><IconView  item={item} style={{}} /></div>;
    case "bar":   return <div data-overlay-part={item.id} ref={onMount} style={pos}><BarView   item={item} style={{}} value={value} /></div>;
    case "text":  return <div data-overlay-part={item.id} ref={onMount} style={pos}><TextView  item={item} style={{}} /></div>;
  }
}

function TimerView({ item, style, remainingMs }: { item: OverlayItem & { type: "timer" }; style: CSSProperties; remainingMs: number }) {
  const ms = Math.max(0, remainingMs);
  const m = Math.floor(ms / 60000);
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  const color = ms === 0 ? "#f87171" : item.color;

  return (
    <div style={{ ...style, color, fontSize: item.font_size }} className={`ov-timer${item.show_background === false ? " ov-timer--no-background" : ""}${ms === 0 ? " ov-timer--done" : ""}`}>
      <div className="ov-timer__time">{m}:{s}</div>
    </div>
  );
}

function IconView({ item, style }: { item: OverlayItem & { type: "icon" }; style: CSSProperties }) {
  if (!item.src) return null;
  return <img src={item.src} width={item.w} height={item.h} style={{ ...style, display: "block", objectFit: "contain" }} />;
}

function BarView({ item, style, value }: { item: OverlayItem & { type: "bar" }; style: CSSProperties; value?: number }) {
  const pct = item.max_value > 0 ? Math.min(100, Math.max(0, ((value ?? item.max_value) / item.max_value) * 100)) : 0;
  return (
    <div style={{ ...style, width: item.w, height: item.h }} className="ov-bar">
      <div className="ov-bar__fill" style={{ width: `${pct}%`, background: item.color }} />
    </div>
  );
}

function TextView({ item, style }: { item: OverlayItem & { type: "text" }; style: CSSProperties }) {
  return (
    <div style={{ ...style, color: item.color, fontSize: item.font_size, whiteSpace: "nowrap" }} className="ov-text">
      {item.content}
    </div>
  );
}
