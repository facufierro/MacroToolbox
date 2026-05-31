import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { OverlayItem } from "./types";
import "./overlay.css";

function resolveCoord(value: number, size: number) {
  if (Math.abs(value) <= 100) {
    return (value / 100) * size;
  }
  return value;
}

export default function OverlayApp() {
  const [items, setItems] = useState<OverlayItem[]>([]);
  const [origin, setOrigin] = useState<[number, number, number, number]>([0, 0, 0, 0]);
  const lastDebug = useRef("");
  const scale = window.devicePixelRatio || 1;
  const logicalOrigin: [number, number, number, number] = [
    origin[0] / scale,
    origin[1] / scale,
    origin[2] / scale,
    origin[3] / scale,
  ];

  useEffect(() => {
    console.log("[overlay] OverlayApp mounted");
    invoke<OverlayItem[]>("get_overlay_items")
      .then(items => { console.log("[overlay] get_overlay_items:", items); setItems(items); })
      .catch(e => console.error("[overlay] get_overlay_items error:", e));

    invoke<[number, number, number, number]>("get_overlay_origin")
      .then(setOrigin)
      .catch(e => console.error("[overlay] get_overlay_origin error:", e));

    const interval = window.setInterval(() => {
      invoke<[number, number, number, number]>("get_overlay_origin")
        .then(setOrigin)
        .catch(e => console.error("[overlay] get_overlay_origin error:", e));
    }, 250);

    let unlisten: (() => void) | undefined;
    listen<OverlayItem[]>("overlay-items", e => {
      console.log("[overlay] overlay-items event:", e.payload);
      setItems(e.payload);
    }).then(fn => { unlisten = fn; });
    return () => {
      window.clearInterval(interval);
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const first = items[0];
    const firstLeft = first ? logicalOrigin[0] + resolveCoord(first.x, logicalOrigin[2]) : null;
    const firstTop = first ? logicalOrigin[1] + resolveCoord(first.y, logicalOrigin[3]) : null;
    const message = JSON.stringify({
      origin,
      logicalOrigin,
      itemCount: items.length,
      firstItem: first
        ? { id: first.id, type: first.type, x: first.x, y: first.y, left: firstLeft, top: firstTop }
        : null,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      screenX: window.screenX,
      screenY: window.screenY,
      devicePixelRatio: scale,
    });
    if (lastDebug.current === message) return;
    lastDebug.current = message;
    invoke("debug_overlay_log", { message }).catch(console.error);
  }, [items, origin, scale]);

  return (
    <div className="overlay-root">
      {items.map(item => <OverlayItemView key={item.id} item={item} origin={logicalOrigin} />)}
    </div>
  );
}

function OverlayItemView({ item, origin }: { item: OverlayItem; origin: [number, number, number, number] }) {
  const base: React.CSSProperties = {
    position: "absolute",
    left: origin[0] + resolveCoord(item.x, origin[2]),
    top: origin[1] + resolveCoord(item.y, origin[3]),
  };
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
