import "./overlayParts.css";
import { Children, type CSSProperties, type ReactNode } from "react";
import type { OverlayGroup, OverlayItem } from "./types";
import { getOverlayItemPosition } from "./overlayPosition";

export function OverlayGroupView({ group, origin, children }: { group: OverlayGroup; origin: [number, number, number, number]; children: ReactNode }) {
  const flow = group.layout === "row" || group.layout === "column";
  return <div style={{ position: "absolute",
    ...getOverlayItemPosition({ x: group.x ?? 0, y: group.y ?? 0 }, origin),
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
    case "timer": return <div ref={onMount} style={pos}><TimerView item={item} style={{}} remainingMs={remainingMs ?? item.duration_ms} /></div>;
    case "icon":  return <div ref={onMount} style={pos}><IconView  item={item} style={{}} /></div>;
    case "bar":   return <div ref={onMount} style={pos}><BarView   item={item} style={{}} value={value} /></div>;
    case "text":  return <div ref={onMount} style={pos}><TextView  item={item} style={{}} /></div>;
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
