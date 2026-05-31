import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { OverlayItem } from "./types";
import "./overlay.css";

export default function OverlayApp() {
  const [items, setItems] = useState<OverlayItem[]>([]);

  useEffect(() => {
    console.log("[overlay] OverlayApp mounted");
    invoke<OverlayItem[]>("get_overlay_items")
      .then(items => { console.log("[overlay] get_overlay_items:", items); setItems(items); })
      .catch(e => console.error("[overlay] get_overlay_items error:", e));

    let unlisten: (() => void) | undefined;
    listen<OverlayItem[]>("overlay-items", e => {
      console.log("[overlay] overlay-items event:", e.payload);
      setItems(e.payload);
    }).then(fn => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  return (
    <div className="overlay-root">
      {items.map(item => <OverlayItemView key={item.id} item={item} />)}
    </div>
  );
}

function OverlayItemView({ item }: { item: OverlayItem }) {
  const base: React.CSSProperties = { position: "absolute", left: item.x, top: item.y };
  switch (item.type) {
    case "timer": return <TimerView item={item} style={base} />;
    case "icon":  return <IconView  item={item} style={base} />;
    case "bar":   return <BarView   item={item} style={base} />;
    case "text":  return <TextView  item={item} style={base} />;
  }
}

function TimerView({ item, style }: { item: OverlayItem & { type: "timer" }; style: React.CSSProperties }) {
  const [ms, setMs] = useState(item.duration_ms);

  useEffect(() => {
    setMs(item.duration_ms);
    const id = setInterval(() => setMs(r => Math.max(0, r - 100)), 100);
    return () => clearInterval(id);
  }, [item.id, item.duration_ms]);

  const m = Math.floor(ms / 60000);
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");

  return (
    <div style={style} className={`ov-timer${ms === 0 ? " ov-timer--done" : ""}`}>
      {item.label && <div className="ov-timer__label">{item.label}</div>}
      <div className="ov-timer__time">{m}:{s}</div>
    </div>
  );
}

function IconView({ item, style }: { item: OverlayItem & { type: "icon" }; style: React.CSSProperties }) {
  if (!item.src) return null;
  return <img src={item.src} width={item.w} height={item.h} style={{ ...style, display: "block", objectFit: "contain" }} />;
}

function BarView({ item, style }: { item: OverlayItem & { type: "bar" }; style: React.CSSProperties }) {
  const [value, setValue] = useState(item.max_value);
  void setValue;
  const pct = Math.min(100, Math.max(0, (value / item.max_value) * 100));
  return (
    <div style={{ ...style, width: item.w, height: item.h }} className="ov-bar">
      <div className="ov-bar__fill" style={{ width: `${pct}%`, background: item.color }} />
    </div>
  );
}

function TextView({ item, style }: { item: OverlayItem & { type: "text" }; style: React.CSSProperties }) {
  return (
    <div style={{ ...style, color: item.color, fontSize: item.font_size, whiteSpace: "nowrap" }} className="ov-text">
      {item.content}
    </div>
  );
}
