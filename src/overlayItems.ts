import { mapBehavior } from "./behaviors.ts";
import type { OverlayGroup, OverlayItem, OverlayTarget, Profile, Scope } from "./types";

export function availableOverlayItems(profiles: Profile[], localItems: OverlayItem[]) {
  const items = new Map(localItems.map(item => [item.id, item]));
  for (const profile of profiles) {
    for (const item of profile.overlay_items) {
      if (!items.has(item.id)) items.set(item.id, item);
    }
  }
  return [...items.values()];
}

export function resolveOverlayGroups(profiles: Profile[], profile: Profile, visited = new Set<string>()): OverlayGroup[] {
  if (visited.has(profile.id)) return [];
  visited.add(profile.id);
  const parent = profiles.find(candidate => candidate.id === profile.parent_id);
  const groups = new Map((parent ? resolveOverlayGroups(profiles, parent, visited) : []).map(group => [group.id, group]));
  for (const group of profile.overlay_groups ?? []) groups.set(group.id, group);
  return [...groups.values()];
}

export function availableOverlayTargets(profiles: Profile[], items: OverlayItem[], localGroups: OverlayGroup[] = []): OverlayTarget[] {
  const groups = new Map(localGroups.map(group => [group.id, group]));
  for (const profile of profiles)
    for (const group of profile.overlay_groups ?? []) if (!groups.has(group.id)) groups.set(group.id, group);
  return [...[...groups.values()].map(group => ({ ...group, type: "group" as const })), ...availableOverlayItems(profiles, items)];
}

export function saveOverlayGroup(profile: Profile, group: OverlayGroup, members: string[]): Profile {
  const ids = new Set(members);
  if (members.some(id => !profile.overlay_items.some(item => item.id === id))) throw new Error("Group part is unavailable.");
  const groups = profile.overlay_groups ?? [];
  return { ...profile,
    overlay_groups: groups.some(candidate => candidate.id === group.id) ? groups.map(candidate => candidate.id === group.id ? group : candidate) : [...groups, group],
    overlay_items: profile.overlay_items.map(item => ids.has(item.id) ? { ...item, group_id: group.id }
      : item.group_id === group.id ? { ...item, group_id: null } : item),
  };
}

export function moveOverlayPart(profile: Profile, itemId: string, direction: -1 | 1): Profile {
  const source = profile.overlay_items.find(item => item.id === itemId);
  if (!source) return profile;
  const siblings = profile.overlay_items.filter(item => (item.group_id ?? null) === (source.group_id ?? null));
  const index = siblings.findIndex(item => item.id === itemId);
  const other = siblings[index + direction];
  if (!other) return profile;
  const items = [...profile.overlay_items];
  const from = items.indexOf(source), to = items.indexOf(other);
  [items[from], items[to]] = [items[to], items[from]];
  return { ...profile, overlay_items: items };
}

export function removeOverlayGroup(scope: Scope, profileId: string, groupId: string): Scope {
  const removed = scope.profiles.find(profile => profile.id === profileId)?.overlay_items.filter(item => item.group_id === groupId).map(item => item.id) ?? [];
  const profiles = scope.profiles.map(profile => profile.id === profileId ? { ...profile,
    overlay_groups: (profile.overlay_groups ?? []).filter(group => group.id !== groupId),
    overlay_items: profile.overlay_items.filter(item => item.group_id !== groupId),
  } : profile);
  return [groupId, ...removed].reduce(removeUnavailableTarget, { ...scope, profiles });
}

export function remapOverlayReferences(profile: Profile, mapId: (id: string) => string): Profile {
  return { ...profile,
    hotkeys: profile.hotkeys.map(hotkey => ({ ...hotkey, behavior: mapOverlayActions(hotkey.behavior, mapId) })),
    events: profile.events.map(event => ({ ...event, behavior: mapOverlayActions(event.behavior, mapId) })),
    overlay_groups: (profile.overlay_groups ?? []).map(group => ({ ...group, id: mapId(group.id),
      visible_while_timer_id: group.visible_while_timer_id ? mapId(group.visible_while_timer_id) : null })),
    overlay_items: profile.overlay_items.map(item => ({ ...item, id: mapId(item.id),
      group_id: item.group_id ? mapId(item.group_id) : null,
      visible_while_timer_id: item.visible_while_timer_id ? mapId(item.visible_while_timer_id) : null })),
  };
}

export function withReferencedOverlayParts(profile: Profile, profiles: Profile[]): Profile {
  const pool = availableOverlayItems(profiles, profile.overlay_items);
  const items = new Map(profile.overlay_items.map(item => [item.id, item]));
  const groups = new Map((profile.overlay_groups ?? []).map(group => [group.id, group]));
  const allGroups = new Map(groups);
  for (const candidate of profiles) for (const group of candidate.overlay_groups ?? []) if (!allGroups.has(group.id)) allGroups.set(group.id, group);
  const pending = [...items.keys(), ...groups.keys()];
  const expandGroups = new Set(groups.keys());
  for (const action of [...profile.hotkeys, ...profile.events]) mapOverlayActions(action.behavior, id => { pending.push(id); expandGroups.add(id); return id; });
  const visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const item = pool.find(item => item.id === id);
    if (item) {
      items.set(id, item);
      if (item.group_id) pending.push(item.group_id);
      if (item.visible_while_timer_id) pending.push(item.visible_while_timer_id);
    }
    const group = allGroups.get(id);
    if (group) {
      groups.set(id, group);
      if (group.visible_while_timer_id) pending.push(group.visible_while_timer_id);
      if (expandGroups.has(id)) for (const member of pool) if (member.group_id === id) pending.push(member.id);
    }
  }
  return { ...profile, overlay_items: [...items.values()], overlay_groups: [...groups.values()] };
}

export function carryReferencedOverlayParts(profile: Profile, source: Profile[], target: Profile[]): Profile {
  const portable = withReferencedOverlayParts(profile, source);
  const existing = new Set(target.flatMap(profile => [...profile.overlay_items.map(item => item.id), ...(profile.overlay_groups ?? []).map(group => group.id)]));
  const owned = new Set([...profile.overlay_items.map(item => item.id), ...(profile.overlay_groups ?? []).map(group => group.id)]);
  return { ...profile,
    overlay_items: portable.overlay_items.filter(item => owned.has(item.id) || !existing.has(item.id)),
    overlay_groups: portable.overlay_groups.filter(group => owned.has(group.id) || !existing.has(group.id)),
  };
}

export function mapOverlayActions(behavior: string, mapId: (id: string) => string | null) {
  return mapBehavior(behavior, step => {
    if (step.type !== "startoverlay" && step.type !== "stopoverlay" && step.type !== "bar") return step;
    const itemId = mapId(step.itemId);
    return itemId === null ? null : { ...step, itemId };
  });
}

export function removeOverlayItem(scope: Scope, profileId: string, itemId: string): Scope {
  const profiles = scope.profiles.map(profile => profile.id === profileId
    ? { ...profile, overlay_items: profile.overlay_items.filter(item => item.id !== itemId) }
    : profile);
  return removeUnavailableTarget({ ...scope, profiles }, itemId);
}

function removeUnavailableTarget(scope: Scope, itemId: string): Scope {
  const profiles = scope.profiles;
  if (profiles.some(profile => profile.overlay_items.some(item => item.id === itemId) || profile.overlay_groups?.some(group => group.id === itemId))) return scope;
  const removeAction = (behavior: string) => mapOverlayActions(behavior, id => id === itemId ? null : id);
  return {
    ...scope,
    profiles: profiles.map(profile => ({
      ...profile,
      overlay_items: profile.overlay_items.map(item => item.visible_while_timer_id === itemId ? { ...item, visible_while_timer_id: null } : item),
      overlay_groups: (profile.overlay_groups ?? []).map(group => group.visible_while_timer_id === itemId ? { ...group, visible_while_timer_id: null } : group),
      hotkeys: profile.hotkeys.map(hotkey => ({ ...hotkey, behavior: removeAction(hotkey.behavior) })),
      events: profile.events.map(event => ({ ...event, behavior: removeAction(event.behavior) })),
    })),
  };
}
