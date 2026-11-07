import { expandBehavior, mapBehavior } from "./behaviors.ts";
import { resolveProfileEntries } from "./profileEntries.ts";
import { orderOwnedSlots } from "./listOrder.ts";
import type { OverlayGroup, OverlayItem, OverlayTarget, Profile, Scope, Variable } from "./types";

export function newOverlayItem(type: OverlayItem["type"], groupId: string): OverlayItem {
  const base = { id: crypto.randomUUID(), name: "", x: 0, y: 0, state_id: null, group_id: groupId };
  switch (type) {
    case "timer": return { ...base, type, duration_ms: 60000, color: "#ffffff", font_size: 22, timer_state_id: null, show_only_running: true };
    case "icon": return { ...base, type, w: 64, h: 64, src: null };
    case "bar": return { ...base, type, w: 200, h: 20, color: "#4ade80", max_value: 100 };
    case "text": return { ...base, type, font_size: 16, color: "#ffffff", content: "" };
  }
}

// Merge only the edited group into the latest folder, preserving unrelated edits.
export function updateBehaviorOverlay(scope: Scope, profileId: string, group: OverlayGroup, items: OverlayItem[]): Scope {
  const profile = scope.profiles.find(profile => profile.id === profileId);
  if (!profile) throw new Error("Profile not found.");
  if (items.some(item => item.group_id !== group.id)) throw new Error("Overlay part belongs to another group.");
  const removedItems = profile.overlay_items.filter(item => item.group_id === group.id && !items.some(current => current.id === item.id));
  const next = { ...scope, profiles: scope.profiles.map(profile => profile.id !== profileId ? profile : { ...profile,
    overlay_groups: profile.overlay_groups.some(current => current.id === group.id)
      ? profile.overlay_groups.map(current => current.id === group.id ? group : current) : [...profile.overlay_groups, group],
    overlay_items: orderOwnedSlots([
      ...profile.overlay_items.filter(item => !removedItems.some(removed => removed.id === item.id)).map(item => items.find(current => current.id === item.id) ?? item),
      ...items.filter(item => !profile.overlay_items.some(current => current.id === item.id)),
    ], items, item => item.id),
  }) };
  return removedItems.reduce((scope, item) => removeUnavailableTarget(scope, item.id), next);
}

// Part names are a view of their overlay and order; legacy saved names are not editable.
export function nameOverlayParts(items: OverlayItem[], groups: OverlayGroup[]): OverlayItem[] {
  const labels = new Map(groups.map(group => [group.id, group.name.trim() || "Overlay"]));
  const counts = new Map<string, number>();
  return items.map(item => {
    const key = `${item.group_id ?? ""}/${item.type}`;
    const index = counts.get(key) ?? 0;
    counts.set(key, index + 1);
    const type = item.type.charAt(0).toUpperCase() + item.type.slice(1);
    return { ...item, name: `${labels.get(item.group_id ?? "") ?? "Overlay"} ${type} ${index}` };
  });
}

export function availableOverlayItems(profiles: Profile[], localItems: OverlayItem[], localGroups: OverlayGroup[] = []) {
  const items = new Map(localItems.map(item => [item.id, item]));
  const groups = new Map(localGroups.map(group => [group.id, group]));
  for (const profile of profiles) {
    for (const group of profile.overlay_groups ?? [])
      if (!groups.has(group.id)) groups.set(group.id, group);
    for (const item of profile.overlay_items) {
      if (!items.has(item.id)) items.set(item.id, item);
    }
  }
  return nameOverlayParts([...items.values()], [...groups.values()]);
}

export function resolveOverlayGroups(profiles: Profile[], profile: Profile, visited = new Set<string>()): OverlayGroup[] {
  if (visited.has(profile.id)) return [];
  visited.add(profile.id);
  const parent = profiles.find(candidate => candidate.id === profile.parent_id);
  const groups = new Map((parent ? resolveOverlayGroups(profiles, parent, visited) : []).map(group => [group.id, group]));
  for (const group of profile.overlay_groups ?? []) groups.set(group.id, group);
  return orderOwnedSlots([...groups.values()], profile.overlay_groups ?? [], group => group.id);
}

export function availableOverlayTargets(profiles: Profile[], items: OverlayItem[], localGroups: OverlayGroup[] = []): OverlayTarget[] {
  const groups = new Map(localGroups.map(group => [group.id, group]));
  for (const profile of profiles)
    for (const group of profile.overlay_groups ?? []) if (!groups.has(group.id)) groups.set(group.id, group);
  return [...[...groups.values()].map(group => ({ ...group, type: "group" as const })), ...availableOverlayItems(profiles, items, [...groups.values()])];
}

export function findOverlayOwner(profiles: Profile[], groupId: string, profileId?: string): Profile | undefined {
  const preferred = profiles.find(profile => profile.id === profileId);
  const inherited = preferred && resolveProfileEntries(profiles, preferred,
    owner => owner.overlay_groups.map(group => ({ owner, group })), entry => entry.group.id)
    .find(({ value }) => value.group.id === groupId)?.value.owner;
  return inherited || profiles.find(profile => profile.overlay_groups.some(group => group.id === groupId));
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

export function duplicateOverlayGroup(profile: Profile, group: OverlayGroup, items: OverlayItem[], createId: () => string): Profile {
  const members = items.filter(item => item.group_id === group.id);
  const ids = new Map([group.id, ...members.map(item => item.id)].map(id => [id, createId()]));
  const copy = remapOverlayReferences({ ...profile, hotkeys: [], events: [],
    overlay_groups: [{ ...group, name: `${group.name.trim() || "Overlay"} (copy)` }], overlay_items: members,
  }, id => ids.get(id) ?? id);
  return { ...profile,
    overlay_groups: [...(profile.overlay_groups ?? []), ...copy.overlay_groups],
    overlay_items: [...profile.overlay_items, ...nameOverlayParts(copy.overlay_items, copy.overlay_groups)],
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

export function withReferencedOverlayParts(profile: Profile, profiles: Profile[], variables: Variable[] = []): Profile {
  const pool = availableOverlayItems(profiles, profile.overlay_items);
  const items = new Map(profile.overlay_items.map(item => [item.id, item]));
  const groups = new Map((profile.overlay_groups ?? []).map(group => [group.id, group]));
  const allGroups = new Map(groups);
  for (const candidate of profiles) for (const group of candidate.overlay_groups ?? []) if (!allGroups.has(group.id)) allGroups.set(group.id, group);
  const pending = [...items.keys(), ...groups.keys()];
  const expandGroups = new Set(groups.keys());
  for (const action of [...profile.hotkeys, ...profile.events]) mapOverlayActions(expandBehavior(action.behavior, variables), id => { pending.push(id); expandGroups.add(id); return id; });
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

export function carryReferencedOverlayParts(profile: Profile, source: Profile[], target: Profile[], variables: Variable[] = []): Profile {
  const portable = withReferencedOverlayParts(profile, source, variables);
  const existing = new Set(target.flatMap(profile => [...profile.overlay_items.map(item => item.id), ...(profile.overlay_groups ?? []).map(group => group.id)]));
  const owned = new Set([...profile.overlay_items.map(item => item.id), ...(profile.overlay_groups ?? []).map(group => group.id)]);
  return { ...profile,
    overlay_items: portable.overlay_items.filter(item => owned.has(item.id) || !existing.has(item.id)),
    overlay_groups: portable.overlay_groups.filter(group => owned.has(group.id) || !existing.has(group.id)),
  };
}

export function mapOverlayActions(behavior: string, mapId: (id: string) => string | null) {
  return mapBehavior(behavior, step => {
    if (step.type === "startoverlay" || step.type === "stopoverlay") {
      const itemIds = [...new Set(step.itemIds.map(mapId).filter((id): id is string => id !== null))];
      return itemIds.length ? { ...step, itemIds } : null;
    }
    if (step.type !== "bar") return step;
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

export function resolveOverlayItems(profiles: Profile[], profile: Profile): Array<{ item: OverlayItem; source: OverlayItem; own: boolean }> {
  const entries = resolveProfileEntries(profiles, profile, current => current.overlay_items, item => item.id);
  const items = nameOverlayParts(entries.map(({ value }) => value), resolveOverlayGroups(profiles, profile));
  return entries.map(({ own, value }, index) => ({ item: items[index], source: value, own }));
}
