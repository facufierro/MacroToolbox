import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { OverlayConfig, OverlayItem, ProfileState } from "./types";
import "./overlay.css";

type OverlayRuntimeEvent = {
  event: string;
  hotkey_trigger?: string | null;
  state_id?: string | null;
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

function normalizeHotkey(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function getState(config: OverlayConfig, stateId: string | null | undefined): ProfileState | null {
  if (!stateId) return null;
  return config.states.find(state => state.id === stateId) ?? null;
}

function applyHotkeyStateEvent(config: OverlayConfig, state: OverlayRuntimeState, event: OverlayRuntimeEvent, now: number) {
  if (event.event !== "hotkey_triggered") {
    return state;
  }

  const next = pruneRuntime(state, now);
  const trigger = normalizeHotkey(event.hotkey_trigger);
  for (const binding of config.hotkeys) {
    if (!binding.state_id || normalizeHotkey(binding.trigger) !== trigger) continue;
    const profileState = getState(config, binding.state_id);
    if (!profileState) continue;

    if ((profileState.duration_ms ?? 0) > 0) {
      next.timers[profileState.id] = now + (profileState.duration_ms ?? 0);
      delete next.flags[profileState.id];
      continue;
    }

    next.flags[profileState.id] = !next.flags[profileState.id];
  }

  return next;
}

function applyStateToggle(state: OverlayRuntimeState, profileState: ProfileState, now: number) {
  const next = pruneRuntime(state, now);
  if ((profileState.duration_ms ?? 0) > 0) {
    next.timers[profileState.id] = now + (profileState.duration_ms ?? 0);
    delete next.flags[profileState.id];
    return next;
  }

  next.flags[profileState.id] = !next.flags[profileState.id];
  return next;
}

function applyRuntimeEvent(config: OverlayConfig, state: OverlayRuntimeState, event: OverlayRuntimeEvent, now: number) {
  let next = event.event === "profile_activated" || event.event === "profile_deactivated"
    ? { ...EMPTY_RUNTIME, flags: {}, timers: {} }
    : pruneRuntime(state, now);

  if (event.event === "state_triggered" && event.state_id) {
    const profileState = getState(config, event.state_id);
    if (profileState) {
      next = applyStateToggle(next, profileState, now);
    }
  }

  next = applyHotkeyStateEvent(config, next, event, now);
  return pruneRuntime(next, now);
}

function isStateActive(state: OverlayRuntimeState, stateId: string | null | undefined, now: number) {
  if (!stateId) return true;
  return state.flags[stateId] === true || (state.timers[stateId] ?? 0) > now;
}

function isItemVisible(item: OverlayItem, state: OverlayRuntimeState, now: number) {
  return isStateActive(state, item.state_id, now);
}

function getTimerRemaining(config: OverlayConfig, item: OverlayItem & { type: "timer" }, state: OverlayRuntimeState, now: number) {
  const linkedState = getState(config, item.timer_state_id);
  if (linkedState && item.timer_state_id) {
    const expiresAt = state.timers[item.timer_state_id] ?? 0;
    const fallback = linkedState.duration_ms ?? item.duration_ms;
    return expiresAt > 0 ? Math.max(0, expiresAt - now) : fallback;
  }
  return item.duration_ms;
}

export default function OverlayApp() {
  const [config, setConfig] = useState<OverlayConfig>({ items: [], states: [], hotkeys: [] });
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
        if (payload.items.length > 0 || payload.states.length > 0 || payload.hotkeys.length > 0) {
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
      stateCount: config.states.length,
      hotkeyStateCount: config.hotkeys.filter(binding => binding.state_id).length,
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
        <OverlayItemView key={item.id} item={item} origin={logicalOrigin} remainingMs={item.type === "timer" ? getTimerRemaining(config, item, runtime, now) : null} />
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
