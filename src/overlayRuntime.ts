import type { OverlayConfig, OverlayItem, ProfileState } from "./types";

export type OverlayRuntimeEvent = {
  event: string;
  profile_id?: string | null;
  hotkey_trigger?: string | null;
  state_id?: string | null;
  item_id?: string | null;
};

export type OverlayRuntimeState = {
  flags: Record<string, boolean>;
  timers: Record<string, number>;
  itemTimers: Record<string, number>;
  hiddenItems: Record<string, boolean>;
};

export const EMPTY_RUNTIME: OverlayRuntimeState = { flags: {}, timers: {}, itemTimers: {}, hiddenItems: {} };

type OverlayProfileRuntime = { config: OverlayConfig; runtime: OverlayRuntimeState };

export type OverlaySessionState = {
  activeProfileId: string | null;
  profiles: Record<string, OverlayProfileRuntime>;
};

export const EMPTY_OVERLAY_SESSIONS: OverlaySessionState = { activeProfileId: null, profiles: {} };

export function getActiveOverlaySession(state: OverlaySessionState) {
  return state.activeProfileId ? state.profiles[state.activeProfileId] : undefined;
}

// Focus selects what is drawn. Each profile keeps its deadlines and dismissals until disarmed.
export function applyOverlaySessionConfig(state: OverlaySessionState, config: OverlayConfig, now: number): OverlaySessionState {
  const profileId = config.profile_id;
  if (!profileId) return { ...state, activeProfileId: null };
  const previous = state.profiles[profileId];
  const runtime = previous
    ? applyOverlayConfig(previous.config, config, previous.runtime, now)
    : applyRuntimeEvent(config, EMPTY_RUNTIME, { event: "profile_activated" }, now);
  return { activeProfileId: profileId, profiles: { ...state.profiles, [profileId]: { config, runtime } } };
}

export function applyOverlaySessionEvent(state: OverlaySessionState, event: OverlayRuntimeEvent, now: number): OverlaySessionState {
  const profileId = event.profile_id ?? state.activeProfileId;
  if (!profileId || !state.profiles[profileId]) return state;
  if (event.event === "profile_deactivated") {
    const profiles = { ...state.profiles };
    delete profiles[profileId];
    return { activeProfileId: state.activeProfileId === profileId ? null : state.activeProfileId, profiles };
  }
  const profile = state.profiles[profileId];
  const runtime = applyRuntimeEvent(profile.config, profile.runtime, event, now);
  return { ...state, profiles: { ...state.profiles, [profileId]: { ...profile, runtime } } };
}

export function dismissOverlaySessionItem(state: OverlaySessionState, itemId: string): OverlaySessionState {
  const profile = getActiveOverlaySession(state);
  const item = profile?.config.items.find(item => item.id === itemId);
  if (!profile || !item) return state;
  const runtime = dismissOverlayItem(profile.config, profile.runtime, item);
  return { ...state, profiles: { ...state.profiles, [profile.config.profile_id!]: { ...profile, runtime } } };
}

function copyRuntime(state: OverlayRuntimeState): OverlayRuntimeState {
  // Keep expired deadlines so a visible timer stays at zero until it is started again.
  return { flags: { ...state.flags }, timers: { ...state.timers }, itemTimers: { ...state.itemTimers }, hiddenItems: { ...state.hiddenItems } };
}

function getState(config: OverlayConfig, stateId: string | null | undefined): ProfileState | null {
  return stateId ? config.states.find(state => state.id === stateId) ?? null : null;
}

function stateActive(state: OverlayRuntimeState, stateId: string, now: number) {
  return state.flags[stateId] === true || (state.timers[stateId] ?? 0) > now;
}

function activateState(state: OverlayRuntimeState, profileState: ProfileState, now: number) {
  if (stateActive(state, profileState.id, now)) return;
  const duration = profileState.duration_ms ?? 0;
  if (duration > 0) {
    state.timers[profileState.id] = now + duration;
    delete state.flags[profileState.id];
  } else {
    state.flags[profileState.id] = true;
  }
}

function startTimer(config: OverlayConfig, state: OverlayRuntimeState, item: OverlayItem, now: number, restart = false) {
  if (item.type !== "timer") return;
  const linkedState = getState(config, item.timer_state_id);
  if (linkedState && (linkedState.duration_ms ?? 0) > 0) {
    activateState(state, linkedState, now);
  } else if (restart || (state.itemTimers[item.id] ?? 0) <= now) {
    state.itemTimers[item.id] = now + item.duration_ms;
  }
}

function startItem(config: OverlayConfig, state: OverlayRuntimeState, item: OverlayItem, now: number) {
  delete state.hiddenItems[item.id];
  const visibilityState = getState(config, item.state_id);
  if (visibilityState) {
    activateState(state, visibilityState, now);
    for (const related of config.items) {
      if (related.state_id === visibilityState.id) startTimer(config, state, related, now);
    }
  }
  startTimer(config, state, item, now);
}

function toggleState(config: OverlayConfig, state: OverlayRuntimeState, profileState: ProfileState, now: number) {
  const duration = profileState.duration_ms ?? 0;
  if (duration > 0) {
    state.timers[profileState.id] = now + duration;
    delete state.flags[profileState.id];
  } else {
    state.flags[profileState.id] = !state.flags[profileState.id];
  }
  if (stateActive(state, profileState.id, now)) {
    for (const item of config.items) {
      if (item.state_id === profileState.id) startTimer(config, state, item, now, true);
    }
  }
}

export function applyRuntimeEvent(config: OverlayConfig, state: OverlayRuntimeState, event: OverlayRuntimeEvent, now: number) {
  const next = copyRuntime(event.event === "profile_activated" || event.event === "profile_deactivated" ? EMPTY_RUNTIME : state);
  if (event.event === "profile_activated") {
    for (const item of config.items) {
      if (item.type === "timer" && item.start_with_overlay) startItem(config, next, item, now);
    }
  }
  if (event.event === "overlay_started") {
    const item = config.items.find(item => item.id === event.item_id);
    if (item) startItem(config, next, item, now);
  }
  if (event.event === "state_triggered" && event.state_id) {
    const profileState = getState(config, event.state_id);
    if (profileState) toggleState(config, next, profileState, now);
  }
  if (event.event === "hotkey_triggered") {
    const trigger = (event.hotkey_trigger ?? "").trim().toLowerCase();
    for (const binding of config.hotkeys) {
      if (binding.trigger.trim().toLowerCase() !== trigger) continue;
      const profileState = getState(config, binding.state_id);
      if (profileState) toggleState(config, next, profileState, now);
    }
  }
  return next;
}

export function applyOverlayConfig(previous: OverlayConfig, config: OverlayConfig, state: OverlayRuntimeState, now: number) {
  const next = copyRuntime(state);
  for (const item of config.items) {
    if (item.type !== "timer" || !item.start_with_overlay) continue;
    const oldItem = previous.items.find(previousItem => previousItem.id === item.id);
    if (oldItem?.type !== "timer" || !oldItem.start_with_overlay) startItem(config, next, item, now);
  }
  return next;
}

export function clearRuntimeState(state: OverlayRuntimeState, stateId: string) {
  const next = copyRuntime(state);
  delete next.flags[stateId];
  delete next.timers[stateId];
  return next;
}

export function dismissOverlayItem(config: OverlayConfig, state: OverlayRuntimeState, item: OverlayItem) {
  const next = item.state_id ? clearRuntimeState(state, item.state_id) : copyRuntime(state);
  if (!item.state_id) next.hiddenItems[item.id] = true;
  for (const related of config.items) {
    if (related.id === item.id || (item.state_id && related.state_id === item.state_id)) {
      delete next.itemTimers[related.id];
    }
  }
  return next;
}

export function isItemVisible(item: OverlayItem, state: OverlayRuntimeState, now: number) {
  return item.state_id ? stateActive(state, item.state_id, now) : !state.hiddenItems[item.id];
}

export function getTimerRemaining(config: OverlayConfig, item: OverlayItem & { type: "timer" }, state: OverlayRuntimeState, now: number) {
  const linkedState = getState(config, item.timer_state_id);
  const duration = linkedState?.duration_ms ?? 0;
  if (linkedState && duration > 0) {
    const expiresAt = state.timers[linkedState.id];
    return expiresAt === undefined ? duration : Math.max(0, expiresAt - now);
  }
  const expiresAt = state.itemTimers[item.id];
  return expiresAt === undefined ? item.duration_ms : Math.max(0, expiresAt - now);
}
