import { useEffect, useRef, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { OverlayConfig } from "./types";
import { getOverlayItemPosition, toLogicalOverlayBounds } from "./overlayPosition";
import { EMPTY_RUNTIME, getTimerRemaining, isItemVisible, acceptSnapshot, type OverlaySnapshot } from "./overlayRuntime";
import { OverlayItemView } from "./OverlayParts";
import { captureWindowErrors, errorMessage } from "./consoleLog";
import "./overlay.css";

const EMPTY_CONFIG: OverlayConfig = { profile_id: null, items: [], states: [], hotkeys: [] };

function reportError(error: unknown) {
  console.error(error);
  void emitTo("main", "console-error", errorMessage(error)).catch(console.error);
}

export default function OverlayApp() {
  const [snapshot, setSnapshot] = useState<OverlaySnapshot>({ config: EMPTY_CONFIG, runtime: EMPTY_RUNTIME, revision: 0 });
  const [origin, setOrigin] = useState<[number, number, number, number]>([0, 0, 0, 0]);
  const [now, setNow] = useState(() => Date.now());
  const itemEls = useRef<Map<string, HTMLElement>>(new Map());
  const lastDebug = useRef("");
  const { config, runtime } = snapshot;
  const scale = window.devicePixelRatio || 1;
  const logicalOrigin = toLogicalOverlayBounds(origin, scale);
  const visibleItems = config.items.filter(item => isItemVisible(config, item, runtime, now));

  useEffect(() => {
    const stopCapturing = captureWindowErrors(window, reportError);
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const subscribe = async <T,>(event: string, handler: (payload: T) => void) => {
      const unlisten = await listen<T>(event, e => handler(e.payload));
      if (disposed) unlisten(); else unlisteners.push(unlisten);
    };
    // Subscribe before requesting the initial snapshot, so a transition cannot be lost.
    const receive = (next: OverlaySnapshot) => setSnapshot(previous => acceptSnapshot(previous, next));
    void subscribe<OverlaySnapshot>("overlay-snapshot", receive).then(() => {
      if (!disposed) void invoke<OverlaySnapshot>("get_overlay_snapshot").then(value => { if (!disposed) receive(value); }).catch(reportError);
    }).catch(reportError);
    invoke<[number, number, number, number]>("get_overlay_origin")
      .then(setOrigin)
      .catch(reportError);

    const interval = window.setInterval(() => {
      invoke<[number, number, number, number]>("get_overlay_origin")
        .then(setOrigin)
        .catch(reportError);
    }, 250);
    const clock = window.setInterval(() => setNow(Date.now()), 100);

    void subscribe<[number, number]>("overlay-right-click", coordinates => {
      const [sx, sy] = coordinates;
      const scale = window.devicePixelRatio || 1;
      // Convert physical screen pixels → CSS viewport pixels
      const cx = sx / scale - window.screenX;
      const cy = sy / scale - window.screenY;
      console.log("[overlay] right-click screen=", sx, sy, "viewport=", cx, cy, "items=", itemEls.current.size);
      for (const [id, el] of itemEls.current) {
        const rect = el.getBoundingClientRect();
        console.log("[overlay] item", id, "rect=", rect.left, rect.top, rect.right, rect.bottom);
        if (cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom) {
          void invoke("dismiss_overlay_item", { id }).catch(reportError);
          break;
        }
      }
    }).catch(reportError);
    return () => {
      disposed = true;
      stopCapturing();
      window.clearInterval(interval);
      window.clearInterval(clock);
      for (const unlisten of unlisteners) unlisten();
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
    invoke("debug_overlay_log", { message }).catch(reportError);
  }, [config, logicalOrigin, origin, runtime, scale, visibleItems]);

  return (
    <div className="overlay-root">
      {visibleItems.filter(item => !config.groups?.some(group => group.id === item.group_id)).map(item => (
        <OverlayItemView key={item.id} item={item} origin={logicalOrigin}
          remainingMs={item.type === "timer" ? getTimerRemaining(config, item, runtime, now) : null} value={runtime.values?.[item.id]}
          onMount={el => { if (el) itemEls.current.set(item.id, el); else itemEls.current.delete(item.id); }} />
      ))}
      {(config.groups ?? []).map(group => {
        const members = visibleItems.filter(item => item.group_id === group.id);
        if (!members.length) return null;
        const flow = group.layout === "row" || group.layout === "column";
        return <div key={group.id} style={{ position: "absolute",
          ...getOverlayItemPosition({ x: group.x ?? 0, y: group.y ?? 0 }, logicalOrigin),
          ...(flow ? { display: "flex", flexDirection: group.layout as "row" | "column", alignItems: "center", gap: group.gap ?? 8 } : {}) }}>
          {members.map(item => <OverlayItemView key={item.id} item={item} flow={flow}
            origin={[0, 0, logicalOrigin[2], logicalOrigin[3]]}
            remainingMs={item.type === "timer" ? getTimerRemaining(config, item, runtime, now) : null} value={runtime.values?.[item.id]}
            onMount={el => { if (el) itemEls.current.set(item.id, el); else itemEls.current.delete(item.id); }} />)}
        </div>;
      })}
    </div>
  );
}
