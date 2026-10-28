import type { OverlayConfig, OverlayItem, ProfileState } from "./types";

export type OverlayRuntimeState = {
  values?: Record<string, number>;
  flags: Record<string, boolean>;
  timers: Record<string, number>;
  itemTimers: Record<string, number>;
  hiddenItems: Record<string, boolean>;
};

export const EMPTY_RUNTIME: OverlayRuntimeState = { flags: {}, timers: {}, itemTimers: {}, hiddenItems: {} };

export type OverlaySnapshot = { config: OverlayConfig; runtime: OverlayRuntimeState; revision: number };
export function acceptSnapshot(previous: OverlaySnapshot, next: OverlaySnapshot) {
  return next.revision >= previous.revision ? next : previous;
}

function getState(config: OverlayConfig, stateId: string | null | undefined): ProfileState | null {
  return stateId ? config.states.find(state => state.id === stateId) ?? null : null;
}

function stateActive(state: OverlayRuntimeState, stateId: string, now: number) {
  return state.flags[stateId] === true || (state.timers[stateId] ?? 0) > now;
}

export function isItemVisible(config: OverlayConfig, item: OverlayItem, state: OverlayRuntimeState, now: number) {
  if (config.disabled_items?.includes(item.id) || state.hiddenItems[item.id] || (item.state_id && (config.states_disabled || !stateActive(state, item.state_id, now)))) return false;
  const group = config.groups?.find(group => group.id === item.group_id);
  if (group && (config.disabled_items?.includes(group.id) || state.hiddenItems[group.id] || (group.visible_while_timer_id && !isTimerRunning(config, group.visible_while_timer_id, state, now)))) return false;
  if (item.visible_while_timer_id && !isTimerRunning(config, item.visible_while_timer_id, state, now)) return false;
  return item.type !== "timer" || !item.show_only_running || (getTimerDeadline(config, item, state) ?? 0) > now;
}

export function isTimerRunning(config: OverlayConfig, id: string, state: OverlayRuntimeState, now: number) {
  const timer = config.items.find(item => item.id === id);
  return timer?.type === "timer" && !config.disabled_items?.includes(id) && !state.hiddenItems[id] && !(timer.group_id && (config.disabled_items?.includes(timer.group_id) || state.hiddenItems[timer.group_id]))
    && (!timer.state_id || (!config.states_disabled && stateActive(state, timer.state_id, now))) && (getTimerDeadline(config, timer, state) ?? 0) > now;
}

function getTimerDeadline(config: OverlayConfig, item: OverlayItem & { type: "timer" }, state: OverlayRuntimeState) {
  const linkedState = getState(config, item.timer_state_id);
  if (linkedState && config.states_disabled) return undefined;
  return linkedState && (linkedState.duration_ms ?? 0) > 0 ? state.timers[linkedState.id] : state.itemTimers[item.id];
}

export function getTimerRemaining(config: OverlayConfig, item: OverlayItem & { type: "timer" }, state: OverlayRuntimeState, now: number) {
  const expiresAt = getTimerDeadline(config, item, state);
  const linkedDuration = getState(config, item.timer_state_id)?.duration_ms ?? 0;
  return expiresAt === undefined ? linkedDuration || item.duration_ms : Math.max(0, expiresAt - now);
}
