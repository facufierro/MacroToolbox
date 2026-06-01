import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { OverlayConfig, OverlayItem, OverlayTrigger } from "./types";
import "./overlay.css";

type OverlayRuntimeEvent = {
  event: string;
  hotkey_trigger?: string | null;
};

type OverlayRuntimeState = {
  flags: Record<string, boolean>;
  timers: Record<string, number>;
};

const EMPTY_RUNTIME: OverlayRuntimeState = { flags: {}, timers: {} };

function resolveCoord(value: number, size: number) {
  if (Math.abs(value) <= 100) {
    return (value / 100) * size;
  }
  return value;
}

function pruneRuntime(state: OverlayRuntimeState, now: number): OverlayRuntimeState {
  const timers = Object.fromEntries(
    Object.entries(state.timers).filter(([, expiresAt]) => expiresAt > now),
  );
  return { flags: { ...state.flags }, timers };
}

function triggerMatches(trigger: OverlayTrigger, event: OverlayRuntimeEvent) {
  if (trigger.event !== event.event) return false;
  if (trigger.event !== "hotkey_triggered") return true;
  return (trigger.hotkey_trigger ?? "").trim().toLowerCase() === (event.hotkey_trigger ?? "").trim().toLowerCase();
}

function applyTrigger(state: OverlayRuntimeState, trigger: OverlayTrigger, now: number): OverlayRuntimeState {
  const next = pruneRuntime(state, now);
  const key = trigger.state_key.trim();
  if (!key) return next;

  switch (trigger.action) {
    case "set_flag":
      next.flags[key] = true;
      break;
    case "clear_flag":
      next.flags[key] = false;
      break;
    case "toggle_flag":
      next.flags[key] = !next.flags[key];
      break;
    case "start_timer":
      next.timers[key] = now + Math.max(0, trigger.duration_ms ?? 0);
      break;
    case "stop_timer":
      delete next.timers[key];
      break;
  }

  return next;
}

function applyRuntimeEvent(config: OverlayConfig, state: OverlayRuntimeState, event: OverlayRuntimeEvent, now: number) {
  let next = event.event === "profile_activated" || event.event === "profile_deactivated"
    ? { ...EMPTY_RUNTIME, flags: {}, timers: {} }
    : pruneRuntime(state, now);

  for (const trigger of config.triggers) {
    if (triggerMatches(trigger, event)) {
      next = applyTrigger(next, trigger, now);
    }
  }

  return pruneRuntime(next, now);
}

function isStateKeyActive(state: OverlayRuntimeState, key: string, now: number) {
  return state.flags[key] === true || (state.timers[key] ?? 0) > now;
}

function isItemVisible(item: OverlayItem, state: OverlayRuntimeState, now: number) {
  const visibilityKey = item.visible_when ?? (item.type === "timer" ? item.timer_key : null);
  if (!visibilityKey) return true;
  return isStateKeyActive(state, visibilityKey, now);
}

function getTimerRemaining(item: OverlayItem & { type: "timer" }, state: OverlayRuntimeState, now: number) {
  if (!item.timer_key) return item.duration_ms;
  const expiresAt = state.timers[item.timer_key] ?? 0;
  return Math.max(0, expiresAt - now);
}

export default function OverlayApp() {
  const [config, setConfig] = useState<OverlayConfig>({ items: [], triggers: [] });
  const [origin, setOrigin] = useState<[number, number, number, number]>([0, 0, 0, 0]);
  const [runtime, setRuntime] = useState<OverlayRuntimeState>(EMPTY_RUNTIME);
  const [now, setNow] = useState(() => Date.now());
  const lastDebug = useRef("");
  const configRef = useRef(config);
  const scale = window.devicePixelRatio || 1;
  const logicalOrigin: [number, number, number, number] = [
    origin[0] / scale,
    origin[1] / scale,
    origin[2] / scale,
    origin[3] / scale,
  ];
  const visibleItems = config.items.filter(item => isItemVisible(item, runtime, now));

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    console.log("[overlay] OverlayApp mounted");
    invoke<OverlayConfig>("get_overlay_config")
      .then(payload => {
        console.log("[overlay] get_overlay_config:", payload);
        setConfig(payload);
        if (payload.items.length > 0 || payload.triggers.length > 0) {
          const eventTime = Date.now();
          setNow(eventTime);
          setRuntime(applyRuntimeEvent(payload, EMPTY_RUNTIME, { event: "profile_activated" }, eventTime));
        }
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
    listen<OverlayConfig>("overlay-config", e => {
      console.log("[overlay] overlay-config event:", e.payload);
      setConfig(e.payload);
    }).then(fn => { unlistenConfig = fn; });
    listen<OverlayRuntimeEvent>("overlay-event", e => {
      console.log("[overlay] overlay-event:", e.payload);
      const eventTime = Date.now();
      setNow(eventTime);
      setRuntime(prev => applyRuntimeEvent(configRef.current, prev, e.payload, eventTime));
    }).then(fn => { unlistenEvent = fn; });
    return () => {
      window.clearInterval(interval);
      window.clearInterval(clock);
      unlistenConfig?.();
      unlistenEvent?.();
    };
  }, []);

  useEffect(() => {
    const first = visibleItems[0];
    const firstLeft = first ? logicalOrigin[0] + resolveCoord(first.x, logicalOrigin[2]) : null;
    const firstTop = first ? logicalOrigin[1] + resolveCoord(first.y, logicalOrigin[3]) : null;
    const message = JSON.stringify({
      origin,
      logicalOrigin,
      itemCount: config.items.length,
      visibleCount: visibleItems.length,
      triggerCount: config.triggers.length,
      runtime,
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
  }, [config, logicalOrigin, origin, runtime, scale, visibleItems]);

  return (
    <div className="overlay-root">
      {visibleItems.map(item => (
        <OverlayItemView key={item.id} item={item} origin={logicalOrigin} remainingMs={item.type === "timer" ? getTimerRemaining(item, runtime, now) : null} />
      ))}
    </div>
  );
}

function OverlayItemView({ item, origin, remainingMs }: { item: OverlayItem; origin: [number, number, number, number]; remainingMs: number | null }) {
  const base: React.CSSProperties = {
    position: "absolute",
    left: origin[0] + resolveCoord(item.x, origin[2]),
    top: origin[1] + resolveCoord(item.y, origin[3]),
  };
  switch (item.type) {
    case "timer": return <TimerView item={item} style={base} remainingMs={remainingMs ?? item.duration_ms} />;
    case "icon":  return <IconView  item={item} style={base} />;
    case "bar":   return <BarView   item={item} style={base} />;
    case "text":  return <TextView  item={item} style={base} />;
  }
}

function TimerView({ item, style, remainingMs }: { item: OverlayItem & { type: "timer" }; style: React.CSSProperties; remainingMs: number }) {
  const ms = Math.max(0, remainingMs);
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
