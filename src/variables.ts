import { areStepsValid, describeBehavior, keyInputPattern, mapBehavior, mapStepValues, parseSteps } from "./behaviors.ts";
import type { Variable, Profile } from "./types";
import { isReference } from "./behaviorValues.ts";
import { readTriggerList } from "./triggers.ts";

export function mapVariableReferences(behavior: string, mapId: (id: string) => string): string {
  return mapBehavior(behavior, step => step.type === "behavior" ? { ...step, variableId: mapId(step.variableId) }
    : mapStepValues(step, value => isReference(value) ? { variable: mapId(value.variable) } : value));
}

function behaviorVariableIds(behavior: string): Set<string> {
  const ids = new Set<string>();
  mapVariableReferences(behavior, id => { ids.add(id); return id; });
  return ids;
}

export function profileVariableIds(profiles: Profile[], variables: Variable[] = []): Set<string> {
  const ids = new Set<string>();
  for (const profile of profiles) {
    for (const hotkey of profile.hotkeys ?? []) if (isReference(hotkey.trigger)) ids.add(hotkey.trigger.variable);
    for (const entry of [...(profile.hotkeys ?? []), ...(profile.events ?? [])]) {
      for (const id of behaviorVariableIds(entry.behavior)) ids.add(id);
    }
  }
  for (const id of ids) {
    const variable = variables.find(variable => variable.id === id);
    if (variable?.type === "behavior") for (const dependency of behaviorVariableIds(variable.value)) ids.add(dependency);
  }
  return ids;
}

export function usedVariableIds(profiles: Profile[], variables: Variable[]): Set<string> {
  const ids = profileVariableIds(profiles, variables);
  for (const variable of variables) if (variable.type === "behavior")
    for (const id of behaviorVariableIds(variable.value)) ids.add(id);
  return ids;
}

export function mapVariableBehaviors(variables: Variable[], map: (behavior: string) => string): Variable[] {
  return variables.map(variable => variable.type === "behavior" ? { ...variable, value: map(variable.value) } : variable);
}

export function exportVariables(profiles: Profile[], variables: Variable[]): Variable[] {
  return [...profileVariableIds(profiles, variables)].map(id => {
    const variable = variables.find(variable => variable.id === id);
    if (!variable) throw new Error("Missing variable");
    return variable;
  });
}

// Imports keep their values without overwriting a different variable on this machine.
export function importVariables<T extends Profile>(profiles: T[], incoming: unknown[], existing: Variable[]): { profiles: T[]; variables: Variable[] } {
  const ids = new Map<string, string>();
  const copies = new Map<string, Variable>();
  const source = incoming.map(readVariable);
  if (new Set(source.map(variable => variable.id)).size !== source.length) throw new Error("Duplicate imported variable");
  const names = new Set(existing.map(variable => variable.name.trim().toLowerCase()));
  const importVariable = (id: string, visiting: string[] = []): string => {
    if (visiting.includes(id)) throw new Error("Circular behavior variable");
    if (ids.has(id)) return ids.get(id)!;
    const original = source.find(variable => variable.id === id);
    if (!original) throw new Error("Missing imported variable");
    const variable = original.type === "behavior" ? { ...original, value: mapVariableReferences(original.value, dependency => importVariable(dependency, [...visiting, id])) } : original;
    const match = existing.find(current => (current.id === variable.id || current.name.trim().toLowerCase() === variable.name.trim().toLowerCase())
      && current.type === variable.type && JSON.stringify(current.value) === JSON.stringify(variable.value));
    if (match) { ids.set(variable.id, match.id); return match.id; }
    let name = variable.name.trim();
    for (let suffix = 2; names.has(name.toLowerCase()); suffix++) name = `${variable.name.trim()} (${suffix})`;
    const copy = { ...variable, id: crypto.randomUUID(), name };
    ids.set(variable.id, copy.id);
    names.add(name.toLowerCase());
    copies.set(variable.id, copy);
    return copy.id;
  };
  for (const variable of source) importVariable(variable.id);
  const remap = (behavior: string) => mapVariableReferences(behavior, reference => {
    const id = ids.get(reference);
    if (!id) throw new Error("Missing imported variable");
    return id;
  });
  const variables = source.flatMap(variable => copies.has(variable.id) ? [copies.get(variable.id)!] : []);
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
  if (type === "behavior" && typeof variable.value === "string" && parseSteps(variable.value).length) return { ...base, type, value: variable.value };
  if (type === "number" && typeof variable.value === "number" && Number.isFinite(variable.value)) {
    return { ...base, type, value: variable.value };
  }
  if ((type === "text" || type === "keys") && typeof variable.value === "string") {
    if (type === "keys" && !keyInputPattern.test(variable.value.trim())) throw new Error("Enter keys");
    return { ...base, type, value: variable.value };
  }
  throw new Error("Invalid variable value");
}

export function validateVariableBehaviors(variables: Variable[]): boolean {
  return variables.every(variable => variable.type !== "behavior"
    || (parseSteps(variable.value).length > 0 && areStepsValid(parseSteps(variable.value), variables, true, [], [variable.id])));
}

export const variableValueText = (variable: Variable, variables: Variable[] = [], stateName: (id: string) => string = id => id, itemName: (id: string) => string = id => id): string => variable.type === "behavior"
  ? describeBehavior(variable.value, stateName, itemName, id => variables.find(variable => variable.id === id)?.name ?? id)
  : Array.isArray(variable.value) ? variable.value.join(", ") : String(variable.value);
