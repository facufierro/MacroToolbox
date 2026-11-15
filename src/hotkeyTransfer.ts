import { carryReferencedOverlayParts } from "./overlayItems.ts";
import { carryReferencedStates } from "./profileStates.ts";
import { carryReferencedScripts } from "./scriptReferences.ts";
import { triggerIdentity } from "./triggers.ts";
import { transferVariables } from "./variables.ts";
import type { Database, Hotkey, Profile, Variable } from "./types";

export interface HotkeySource { gameId: string; profileId: string; index: number; hotkey: Hotkey }

export function canMoveHotkey(db: Database, source: HotkeySource, gameId: string, profileId: string): boolean {
  if (source.gameId === gameId && source.profileId === profileId) return false;
  const target = db.scopes.find(game => game.id === gameId)?.profiles.find(profile => profile.id === profileId);
  if (!target) return false;
  const assigned = typeof source.hotkey.trigger !== "string" || !!source.hotkey.trigger.trim();
  const sourceVariables = db.scopes.find(game => game.id === source.gameId)?.variables ?? [];
  const targetVariables = db.scopes.find(game => game.id === gameId)?.variables ?? [];
  return !assigned || !target.hotkeys.some(hotkey => triggerIdentity(hotkey.trigger) === triggerIdentity(source.hotkey.trigger)
    && (source.gameId === gameId || typeof source.hotkey.trigger === "string"
      || JSON.stringify(sourceVariables.find(variable => typeof source.hotkey.trigger !== "string" && variable.id === source.hotkey.trigger.variable)?.value)
        === JSON.stringify(targetVariables.find(variable => typeof hotkey.trigger !== "string" && variable.id === hotkey.trigger.variable)?.value)));
}

export function prepareHotkeyMove(db: Database, source: HotkeySource, gameId: string, profileId: string): Profile & { variables: Variable[] } {
  if (!canMoveHotkey(db, source, gameId, profileId)) throw new Error("Choose a profile without this hotkey trigger.");
  const origin = db.scopes.find(game => game.id === source.gameId);
  const target = db.scopes.find(game => game.id === gameId)!;
  const current = origin?.profiles.find(profile => profile.id === source.profileId)?.hotkeys[source.index];
  if (!current || current.name !== source.hotkey.name || current.behavior !== source.hotkey.behavior
      || triggerIdentity(current.trigger) !== triggerIdentity(source.hotkey.trigger)
      || JSON.stringify(current.cancel_triggers ?? []) !== JSON.stringify(source.hotkey.cancel_triggers ?? [])
      || (current.cancel_on_other_behavior ?? false) !== (source.hotkey.cancel_on_other_behavior ?? false)
      || (current.state_id ?? null) !== (source.hotkey.state_id ?? null)
      || (current.allow_extra_modifiers ?? null) !== (source.hotkey.allow_extra_modifiers ?? null)) {
    throw new Error("The dragged behavior changed. Drag it again.");
  }
  const profile = target.profiles.find(profile => profile.id === profileId)!;
  const selection = { ...profile, hotkeys: [current], events: [], states: [], scripts: [], overlay_items: [], overlay_groups: [] };
  const withOverlays = carryReferencedOverlayParts(selection, origin!.profiles, target.profiles, origin!.variables);
  const withStates = carryReferencedStates(withOverlays, origin!.states, target.states, origin!.variables);
  const portable = carryReferencedScripts(withStates,
    origin!.profiles.flatMap(profile => profile.scripts), target.profiles.flatMap(profile => profile.scripts), origin!.variables);
  const transferred = transferVariables(portable, origin!, target);
  return { ...profile, variables: transferred.variables, hotkeys: [...profile.hotkeys, ...transferred.profile.hotkeys],
    states: [...profile.states, ...transferred.profile.states], scripts: [...profile.scripts, ...transferred.profile.scripts],
    overlay_items: [...profile.overlay_items, ...transferred.profile.overlay_items],
    overlay_groups: [...profile.overlay_groups, ...transferred.profile.overlay_groups],
  };
}
