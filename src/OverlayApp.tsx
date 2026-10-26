import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { OverlayConfig, OverlayItem } from "./types";
import { getOverlayItemPosition, toLogicalOverlayBounds } from "./overlayPosition";
import {
  applyOverlaySessionConfig, applyOverlaySessionEvent, dismissOverlaySessionItem, EMPTY_OVERLAY_SESSIONS,
  EMPTY_RUNTIME, getActiveOverlaySession, getTimerRemaining, isItemVisible,
  type OverlayRuntimeEvent,
} from "./overlayRuntime";
import "./overlay.css";

const EMPTY_CONFIG: OverlayConfig = { profile_id: null, items: [], states: [], hotkeys: [] };

export default function OverlayApp() {
  const [sessions, setSessions] = useState(EMPTY_OVERLAY_SESSIONS);
  const [origin, setOrigin] = useState<[number, number, number, number]>([0, 0, 0, 0]);
  const [now, setNow] = useState(() => Date.now());
  const itemEls = useRef<Map<string, HTMLElement>>(new Map());
  const lastDebug = useRef("");
  const active = getActiveOverlaySession(sessions);
  const config = active?.config ?? EMPTY_CONFIG;
  const runtime = active?.runtime ?? EMPTY_RUNTIME;
  const scale = window.devicePixelRatio || 1;
  const logicalOrigin = toLogicalOverlayBounds(origin, scale);
  const visibleItems = config.items.filter(item => isItemVisible(config, item, runtime, now));

  useEffect(() => {
    console.log("[overlay] OverlayApp mounted");
    invoke<OverlayConfig>("get_overlay_config")
      .then(payload => {
        console.log("[overlay] get_overlay_config:", payload);
        const eventTime = Date.now();
        setNow(eventTime);
        setSessions(prev => applyOverlaySessionConfig(prev, payload, eventTime));
      })
      .catch(e => console.error("[overlay] get_overlay_config error:", e));

    invoke<[number, number, number, number]>("get_overlay_origin")
      .then(setOrigin)
      .catch(e => console.error("[overlay] get_overlay_origin error:", e));

    const interval = window.setInterval(() => {
      invoke<[number, number, number, number]>("get_overlay_origin")
        .then(setOrigin)
        .catch(e => console.error("[overlay] get_overlay_origin error:", e));
    }, 250);
    const clock = window.setInterval(() => setNow(Date.now()), 100);

    let unlistenConfig: (() => void) | undefined;
    let unlistenEvent: (() => void) | undefined;
    let unlistenRightClick: (() => void) | undefined;
    listen<[number, number]>("overlay-right-click", e => {
      const [sx, sy] = e.payload;
      const scale = window.devicePixelRatio || 1;
      // Convert physical screen pixels → CSS viewport pixels
      const cx = sx / scale - window.screenX;
      const cy = sy / scale - window.screenY;
      console.log("[overlay] right-click screen=", sx, sy, "viewport=", cx, cy, "items=", itemEls.current.size);
      for (const [id, el] of itemEls.current) {
        const rect = el.getBoundingClientRect();
        console.log("[overlay] item", id, "rect=", rect.left, rect.top, rect.right, rect.bottom);
        if (cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom) {
          setSessions(prev => dismissOverlaySessionItem(prev, id));
          break;
        }
      }
    }).then(fn => { unlistenRightClick = fn; });
    listen<OverlayConfig>("overlay-config", e => {
      console.log("[overlay] overlay-config event:", e.payload);
      const eventTime = Date.now();
      setNow(eventTime);
      setSessions(prev => applyOverlaySessionConfig(prev, e.payload, eventTime));
    }).then(fn => { unlistenConfig = fn; });
    listen<OverlayRuntimeEvent>("overlay-event", e => {
      console.log("[overlay] overlay-event:", e.payload);
      const eventTime = Date.now();
      setNow(eventTime);
      setSessions(prev => applyOverlaySessionEvent(prev, e.payload, eventTime));
    }).then(fn => { unlistenEvent = fn; });
    return () => {
      window.clearInterval(interval);
      window.clearInterval(clock);
      unlistenConfig?.();
      unlistenEvent?.();
      unlistenRightClick?.();
    };
  }, []);

  useEffect(() => {
    const first = visibleItems[0];
    const firstPosition = first ? getOverlayItemPosition(first, logicalOrigin) : null;
    const message = JSON.stringify({
      origin,
      logicalOrigin,
      itemCount: config.items.length,
      visibleCount: visibleItems.length,
      stateCount: config.states.length,
      hotkeyStateCount: config.hotkeys.filter(binding => binding.state_id).length,
      runtime,
      firstItem: first
        ? { id: first.id, type: first.type, x: first.x, y: first.y, ...firstPosition }
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
  }, [config, logicalOrigin, origin, runtime, scale, visibleItems]);

  return (
    <div className="overlay-root">
      {visibleItems.map(item => (
        <OverlayItemView key={item.id} item={item} origin={logicalOrigin}
          remainingMs={item.type === "timer" ? getTimerRemaining(config, item, runtime, now) : null}
          onMount={el => { if (el) itemEls.current.set(item.id, el); else itemEls.current.delete(item.id); }} />
      ))}
    </div>
  );
}

function OverlayItemView({ item, origin, remainingMs, onMount }: { item: OverlayItem; origin: [number, number, number, number]; remainingMs: number | null; onMount: (el: HTMLElement | null) => void }) {
  // Put position on the wrapper so getBoundingClientRect() returns real bounds for hit-testing.
  // Inner components get an empty style so they don't double-apply the offset.
  const pos: React.CSSProperties = {
    position: "absolute",
    ...getOverlayItemPosition(item, origin),
  };
  switch (item.type) {
    case "timer": return <div ref={onMount} style={pos}><TimerView item={item} style={{}} remainingMs={remainingMs ?? item.duration_ms} /></div>;
    case "icon":  return <div ref={onMount} style={pos}><IconView  item={item} style={{}} /></div>;
    case "bar":   return <div ref={onMount} style={pos}><BarView   item={item} style={{}} /></div>;
    case "text":  return <div ref={onMount} style={pos}><TextView  item={item} style={{}} /></div>;
  }
}

function TimerView({ item, style, remainingMs }: { item: OverlayItem & { type: "timer" }; style: React.CSSProperties; remainingMs: number }) {
  const ms = Math.max(0, remainingMs);
  const m = Math.floor(ms / 60000);
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  const color = ms === 0 ? "#f87171" : item.color;

  return (
    <div style={{ ...style, color, fontSize: item.font_size }} className={`ov-timer${ms === 0 ? " ov-timer--done" : ""}`}>
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
