import { carryReferencedOverlayParts } from "./overlayItems.ts";
import { carryReferencedStates } from "./profileStates.ts";
import { carryReferencedScripts } from "./scriptReferences.ts";
import { triggerIdentity } from "./triggers.ts";
import type { Database, Hotkey, Profile } from "./types";

export interface HotkeySource { gameId: string; profileId: string; index: number; hotkey: Hotkey }

export function canMoveHotkey(db: Database, source: HotkeySource, gameId: string, profileId: string): boolean {
  if (source.gameId === gameId && source.profileId === profileId) return false;
  const target = db.scopes.find(game => game.id === gameId)?.profiles.find(profile => profile.id === profileId);
  if (!target) return false;
  const assigned = typeof source.hotkey.trigger !== "string" || !!source.hotkey.trigger.trim();
  return !assigned || !target.hotkeys.some(hotkey => triggerIdentity(hotkey.trigger) === triggerIdentity(source.hotkey.trigger));
}

export function prepareHotkeyMove(db: Database, source: HotkeySource, gameId: string, profileId: string): Profile {
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
  const withHotkey = { ...profile, hotkeys: [...profile.hotkeys, current] };
  const withOverlays = carryReferencedOverlayParts(withHotkey, origin!.profiles, target.profiles, db.variables);
  const withStates = carryReferencedStates(withOverlays, origin!.states, target.states, db.variables);
  return carryReferencedScripts(withStates,
    origin!.profiles.flatMap(profile => profile.scripts), target.profiles.flatMap(profile => profile.scripts), db.variables);
}
