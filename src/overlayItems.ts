import type { OverlayItem, Profile, Scope } from "./types";

export function availableOverlayItems(profiles: Profile[], localItems: OverlayItem[]) {
  const items = new Map(localItems.map(item => [item.id, item]));
  for (const profile of profiles) {
    if (profile.kind !== "overlay") continue;
    for (const item of profile.overlay_items) {
      if (!items.has(item.id)) items.set(item.id, item);
    }
  }
  return [...items.values()];
}

export function mapOverlayActions(behavior: string, mapId: (id: string) => string | null) {
  return behavior.split(";").flatMap(action => {
    const match = action.trim().match(/^(startoverlay|restartoverlay)\((.+)\)$/);
    if (!match) return [action];
    const id = match[2].trim();
    const mapped = mapId(id);
    return mapped === null ? [] : [mapped === id ? action : `${match[1]}(${mapped})`];
  }).join(";");
}

export function removeOverlayItem(scope: Scope, profileId: string, itemId: string): Scope {
  const profiles = scope.profiles.map(profile => profile.id === profileId
    ? { ...profile, overlay_items: profile.overlay_items.filter(item => item.id !== itemId) }
    : profile);
  if (profiles.some(profile => profile.overlay_items.some(item => item.id === itemId))) return { ...scope, profiles };
  const removeAction = (behavior: string) => mapOverlayActions(behavior, id => id === itemId ? null : id);
  return {
    ...scope,
    profiles: profiles.map(profile => ({
      ...profile,
      hotkeys: profile.hotkeys.map(hotkey => ({ ...hotkey, behavior: removeAction(hotkey.behavior) })),
      events: profile.events.map(event => ({ ...event, behavior: removeAction(event.behavior) })),
    })),
  };
}
