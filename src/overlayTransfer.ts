import { carryReferencedOverlayParts, resolveOverlayGroups } from "./overlayItems.ts";
import { carryReferencedStates } from "./profileStates.ts";
import type { Database, OverlayGroup, OverlayItem, Profile } from "./types";

export type OverlaySelection = { kind: "overlay"; group: OverlayGroup; items: OverlayItem[] }
  | { kind: "overlayPart"; item: OverlayItem };
export type OverlaySource = OverlaySelection & { gameId: string; profileId: string };

export function canMoveOverlay(db: Database, source: OverlaySource, gameId: string, profileId: string, groupId?: string): boolean {
  const sameProfile = source.gameId === gameId && source.profileId === profileId;
  if (sameProfile && (source.kind === "overlay" || !groupId || source.item.group_id === groupId)) return false;
  if (source.kind === "overlay" && groupId) return false;
  const folder = db.scopes.find(folder => folder.id === gameId);
  const profile = folder?.profiles.find(profile => profile.id === profileId);
  if (!folder || !profile) return false;
  const groups = resolveOverlayGroups(folder.profiles, profile);
  if (groupId && !groups.some(group => group.id === groupId)) return false;
  const items = source.kind === "overlay" ? source.items : [source.item];
  if (!sameProfile && profile.overlay_items.some(item => items.some(moved => moved.id === item.id))) return false;
  return source.kind !== "overlay" || !profile.overlay_groups.some(group => group.id === source.group.id);
}

export function prepareOverlayMove(db: Database, source: OverlaySource, gameId: string, profileId: string, groupId?: string): Profile {
  if (!canMoveOverlay(db, source, gameId, profileId, groupId)) throw new Error("Choose a different overlay destination.");
  const origin = db.scopes.find(folder => folder.id === source.gameId);
  const owner = origin?.profiles.find(profile => profile.id === source.profileId);
  const target = db.scopes.find(folder => folder.id === gameId)!;
  const profile = target.profiles.find(profile => profile.id === profileId)!;
  const current = source.kind === "overlay" ? owner?.overlay_groups.find(group => group.id === source.group.id)
    : owner?.overlay_items.find(item => item.id === source.item.id);
  if (!current || JSON.stringify(current) !== JSON.stringify(source.kind === "overlay" ? source.group : source.item)) {
    throw new Error("The dragged overlay changed. Drag it again.");
  }
  const items = source.kind === "overlay" ? source.items : [{ ...source.item, group_id: groupId ?? source.item.group_id }];
  const originalGroup = source.kind === "overlay" ? source.group
    : resolveOverlayGroups(origin!.profiles, owner!).find(group => group.id === source.item.group_id);
  if (!originalGroup) throw new Error("Overlay not found.");
  const destinationGroups = resolveOverlayGroups(target.profiles, profile);
  const keepGroup = groupId ? undefined : originalGroup;
  const selection = { ...profile, hotkeys: [], events: [], scripts: [], states: [],
    overlay_groups: source.kind === "overlay" ? [source.group] : [], overlay_items: items,
  };
  const portable = carryReferencedOverlayParts(selection, [...target.profiles, ...origin!.profiles], target.profiles, db.variables);
  const groups = keepGroup && !destinationGroups.some(group => group.id === keepGroup.id)
    ? [...profile.overlay_groups, keepGroup] : profile.overlay_groups;
  const withOverlays = { ...profile,
    overlay_groups: [...groups, ...portable.overlay_groups.filter(group => !groups.some(existing => existing.id === group.id))],
    overlay_items: [...profile.overlay_items.filter(item => !items.some(moved => moved.id === item.id)),
      ...portable.overlay_items.filter(item => items.some(moved => moved.id === item.id) || !profile.overlay_items.some(existing => existing.id === item.id))],
  };
  return carryReferencedStates(withOverlays, origin!.states, target.states, db.variables);
}
