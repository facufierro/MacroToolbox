import { mapBehavior } from "./behaviors.ts";
import type { Profile, ProfileState, Scope } from "./types";

export function mapStateActions(behavior: string, mapId: (id: string) => string | null) {
  return mapBehavior(behavior, step => {
    if (step.type !== "state") return step;
    const stateId = mapId(step.stateId);
    return stateId === null ? null : { ...step, stateId };
  });
}

export function withReferencedStates(profile: Profile, states: ProfileState[]): Profile {
  const ids = new Set(profile.states.map(state => state.id));
  for (const hotkey of profile.hotkeys) {
    if (hotkey.state_id) ids.add(hotkey.state_id);
    mapStateActions(hotkey.behavior, id => { ids.add(id); return id; });
  }
  for (const event of profile.events ?? []) {
    mapStateActions(event.behavior, id => { ids.add(id); return id; });
  }
  for (const item of profile.overlay_items) {
    if (item.state_id) ids.add(item.state_id);
    if (item.type === "timer" && item.timer_state_id) ids.add(item.timer_state_id);
  }
  return { ...profile, states: states.filter(state => ids.has(state.id)) };
}

export function carryReferencedStates(profile: Profile, sourceStates: ProfileState[], targetStates: ProfileState[]): Profile {
  const existing = new Set([...targetStates, ...profile.states].map(state => state.id));
  const referenced = withReferencedStates(profile, sourceStates);
  return {
    ...profile,
    states: [...profile.states, ...referenced.states.filter(state => !existing.has(state.id))],
  };
}

export function removeProfileState(scope: Scope, _profileId: string, stateId: string): Scope {
  const removeAction = (behavior: string) => mapStateActions(behavior, id => id === stateId ? null : id);
  return { ...scope, states: scope.states.filter(state => state.id !== stateId), profiles: scope.profiles.map(profile => ({
    ...profile,
    states: profile.states.filter(state => state.id !== stateId),
    hotkeys: profile.hotkeys.map(hotkey => ({ ...hotkey, state_id: hotkey.state_id === stateId ? null : hotkey.state_id, behavior: removeAction(hotkey.behavior) })),
    events: profile.events.map(event => ({ ...event, behavior: removeAction(event.behavior) })),
    overlay_items: profile.overlay_items.map(item => ({ ...item, state_id: item.state_id === stateId ? null : item.state_id,
      ...(item.type === "timer" ? { timer_state_id: item.timer_state_id === stateId ? null : item.timer_state_id } : {}) })),
  })) };
}
