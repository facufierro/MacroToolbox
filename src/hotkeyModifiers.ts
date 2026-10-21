import type { Hotkey } from "./types";

/** Older unmodified bindings accepted held modifiers; explicit chords matched exactly. */
export function allowsExtraModifiers(hotkey: Hotkey): boolean {
  return hotkey.allow_extra_modifiers ?? !hotkey.trigger.trim().toLowerCase().split(/\s+/)
    .some(part => /^(?:l|r)?(?:ctrl|shift|alt|win)$/.test(part));
}
