import { mapBehavior, mapStepNumbers } from "./behaviors.ts";
import type { NumberVariable, Profile } from "./types";

export function profileVariableIds(profiles: Profile[]): Set<string> {
  const ids = new Set<string>();
  for (const profile of profiles) {
    for (const entry of [...(profile.hotkeys ?? []), ...(profile.events ?? [])]) {
      mapBehavior(entry.behavior, step => mapStepNumbers(step, value => {
        if (value.startsWith("$")) ids.add(value.slice(1));
        return value;
      }));
    }
  }
  return ids;
}

export function exportVariables(profiles: Profile[], variables: NumberVariable[]): NumberVariable[] {
  return [...profileVariableIds(profiles)].map(id => {
    const variable = variables.find(variable => variable.id === id);
    if (!variable) throw new Error("Missing number variable");
    return variable;
  });
}

// Imports keep their values without overwriting a different variable on this machine.
export function importVariables<T extends Profile>(profiles: T[], incoming: NumberVariable[], existing: NumberVariable[]): { profiles: T[]; variables: NumberVariable[] } {
  const ids = new Map<string, string>();
  const variables: NumberVariable[] = [];
  const names = new Set(existing.map(variable => variable.name.trim().toLowerCase()));
  for (const variable of incoming) {
    if (!variable || typeof variable.id !== "string" || !variable.id || ids.has(variable.id)
      || typeof variable.name !== "string" || !variable.name.trim() || !Number.isFinite(variable.value)) {
      throw new Error("Invalid imported number variable");
    }
    const match = existing.find(current => (current.id === variable.id || current.name.trim().toLowerCase() === variable.name.trim().toLowerCase())
      && current.value === variable.value);
    if (match) { ids.set(variable.id, match.id); continue; }
    let name = variable.name.trim();
    for (let suffix = 2; names.has(name.toLowerCase()); suffix++) name = `${variable.name.trim()} (${suffix})`;
    const copy = { ...variable, id: crypto.randomUUID(), name };
    ids.set(variable.id, copy.id);
    names.add(name.toLowerCase());
    variables.push(copy);
  }
  const remap = (behavior: string) => mapBehavior(behavior, step => mapStepNumbers(step, value => {
    if (!value.startsWith("$")) return value;
    const id = ids.get(value.slice(1));
    if (!id) throw new Error("Missing imported number variable");
    return `$${id}`;
  }));
  return { variables, profiles: profiles.map(profile => ({ ...profile,
    hotkeys: (profile.hotkeys ?? []).map(entry => ({ ...entry, behavior: remap(entry.behavior) })),
    events: (profile.events ?? []).map(entry => ({ ...entry, behavior: remap(entry.behavior) })),
  })) };
}
