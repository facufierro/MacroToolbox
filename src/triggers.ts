import { isReference } from "./behaviorValues.ts";
import type { Hotkey, Variable } from "./types";

export function readTriggerList(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.some(trigger => typeof trigger !== "string" || !trigger.trim())) {
    throw new Error("Enter at least one trigger; each trigger must have keys");
  }
  const triggers = value.map(trigger => trigger.trim().replace(/\s+/g, " "));
  if (new Set(triggers.map(trigger => trigger.toLowerCase())).size !== triggers.length) throw new Error("Each trigger must be unique");
  return triggers;
}

export function resolveTriggers(trigger: Hotkey["trigger"], variables: Variable[]): string[] {
  if (typeof trigger === "string") return trigger.trim() ? [trigger] : [];
  if (!isReference(trigger)) throw new Error("Invalid trigger source");
  const variable = variables.find(variable => variable.id === trigger.variable);
  if (!variable || variable.type !== "triggers") throw new Error("Select a Trigger list variable");
  return readTriggerList(variable.value);
}

export const triggerIdentity = (trigger: Hotkey["trigger"]): string => JSON.stringify(trigger);
export const triggerLabel = (trigger: Hotkey["trigger"], variables: Variable[]): string =>
  typeof trigger === "string" ? trigger : variables.find(variable => variable.id === trigger.variable)?.name ?? "Missing variable";

export function isTriggerValid(trigger: Hotkey["trigger"], variables: Variable[]): boolean {
  try { return resolveTriggers(trigger, variables).length > 0; }
  catch { return false; }
}
