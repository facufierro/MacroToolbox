import type { Profile, ProfileState, Scope } from "./types";

// Keep local/inherited overrides first; other profiles retain ownership of their definitions.
export function availableStates(profiles: Profile[], localStates: ProfileState[]) {
  const states = new Map(localStates.map(state => [state.id, state]));
  for (const profile of profiles) {
    for (const state of profile.states) {
      if (!states.has(state.id)) states.set(state.id, state);
    }
  }
  return [...states.values()];
}

export function mapStateActions(behavior: string, mapId: (id: string) => string | null) {
  return behavior.split(";").flatMap(action => {
    const match = action.trim().match(/^state\((.+)\)$/);
    if (!match) return [action];
    const id = match[1].trim();
    const mapped = mapId(id);
    return mapped === null ? [] : [mapped === id ? action : `state(${mapped})`];
  }).join(";");
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

export function removeProfileState(scope: Scope, profileId: string, stateId: string): Scope {
  const profiles = scope.profiles.map(profile => profile.id === profileId
    ? { ...profile, states: profile.states.filter(state => state.id !== stateId) }
    : profile);
  // A legacy copy or an inherited override may still define this state.
  if (profiles.some(profile => profile.states.some(state => state.id === stateId))) {
    return { ...scope, profiles };
  }
  const removeAction = (behavior: string) => mapStateActions(behavior, id => id === stateId ? null : id);
  return {
    ...scope,
    profiles: profiles.map(profile => ({
      ...profile,
      hotkeys: profile.hotkeys.map(hotkey => ({
        ...hotkey,
        state_id: hotkey.state_id === stateId ? null : hotkey.state_id,
        behavior: removeAction(hotkey.behavior),
      })),
      events: profile.events.map(event => ({ ...event, behavior: removeAction(event.behavior) })),
      overlay_items: profile.overlay_items.map(item => item.type === "timer"
        ? { ...item, state_id: item.state_id === stateId ? null : item.state_id, timer_state_id: item.timer_state_id === stateId ? null : item.timer_state_id }
        : { ...item, state_id: item.state_id === stateId ? null : item.state_id }),
    })),
  };
}
