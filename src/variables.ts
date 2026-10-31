import { keyInputPattern, mapBehavior, mapStepValues } from "./behaviors.ts";
import type { Variable, Profile } from "./types";
import { isReference } from "./behaviorValues.ts";
import { readTriggerList } from "./triggers.ts";

export function profileVariableIds(profiles: Profile[]): Set<string> {
  const ids = new Set<string>();
  for (const profile of profiles) {
    for (const hotkey of profile.hotkeys ?? []) if (isReference(hotkey.trigger)) ids.add(hotkey.trigger.variable);
    for (const entry of [...(profile.hotkeys ?? []), ...(profile.events ?? [])]) {
      mapBehavior(entry.behavior, step => mapStepValues(step, value => {
        if (isReference(value)) ids.add(value.variable);
        return value;
      }));
    }
  }
  return ids;
}

export function exportVariables(profiles: Profile[], variables: Variable[]): Variable[] {
  return [...profileVariableIds(profiles)].map(id => {
    const variable = variables.find(variable => variable.id === id);
    if (!variable) throw new Error("Missing variable");
    return variable;
  });
}

// Imports keep their values without overwriting a different variable on this machine.
export function importVariables<T extends Profile>(profiles: T[], incoming: unknown[], existing: Variable[]): { profiles: T[]; variables: Variable[] } {
  const ids = new Map<string, string>();
  const variables: Variable[] = [];
  const names = new Set(existing.map(variable => variable.name.trim().toLowerCase()));
  for (const value of incoming) {
    const variable = readVariable(value);
    if (ids.has(variable.id)) throw new Error("Duplicate imported variable");
    const match = existing.find(current => (current.id === variable.id || current.name.trim().toLowerCase() === variable.name.trim().toLowerCase())
      && current.type === variable.type && JSON.stringify(current.value) === JSON.stringify(variable.value));
    if (match) { ids.set(variable.id, match.id); continue; }
    let name = variable.name.trim();
    for (let suffix = 2; names.has(name.toLowerCase()); suffix++) name = `${variable.name.trim()} (${suffix})`;
    const copy = { ...variable, id: crypto.randomUUID(), name };
    ids.set(variable.id, copy.id);
    names.add(name.toLowerCase());
    variables.push(copy);
  }
  const remap = (behavior: string) => mapBehavior(behavior, step => mapStepValues(step, value => {
    if (!isReference(value)) return value;
    const id = ids.get(value.variable);
    if (!id) throw new Error("Missing imported variable");
    return { variable: id };
  }));
  return { variables, profiles: profiles.map(profile => ({ ...profile,
    hotkeys: (profile.hotkeys ?? []).map(entry => {
      if (!isReference(entry.trigger)) return { ...entry, behavior: remap(entry.behavior) };
      const id = ids.get(entry.trigger.variable);
      if (!id) throw new Error("Missing imported variable");
      return { ...entry, trigger: { variable: id }, behavior: remap(entry.behavior) };
    }),
    events: (profile.events ?? []).map(entry => ({ ...entry, behavior: remap(entry.behavior) })),
  })) };
}

export function readVariable(value: unknown): Variable {
  if (!value || typeof value !== "object") throw new Error("Invalid variable");
  const variable = value as Record<string, unknown>;
  if (typeof variable.id !== "string" || !variable.id.trim() || typeof variable.name !== "string" || !variable.name.trim()) {
    throw new Error("Enter a variable name");
  }
  const base = { id: variable.id, name: variable.name.trim() };
  const type = variable.type ?? "number";
  if (type === "triggers") return { ...base, type, value: readTriggerList(variable.value) };
  if (type === "number" && typeof variable.value === "number" && Number.isFinite(variable.value)) {
    return { ...base, type, value: variable.value };
  }
  if ((type === "text" || type === "keys") && typeof variable.value === "string") {
    if (type === "keys" && !keyInputPattern.test(variable.value.trim())) throw new Error("Enter keys");
    return { ...base, type, value: variable.value };
  }
  throw new Error("Invalid variable value");
}

export const variableValueText = (variable: Variable): string => Array.isArray(variable.value) ? variable.value.join(", ") : String(variable.value);
