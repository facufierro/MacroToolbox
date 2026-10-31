import type { BehaviorValue, Variable, ValueType } from "./types";

export const isCredentialId = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
// Windows Credential Manager accepts at most 2560 bytes per generic credential.
export const isPasswordValid = (value: string): boolean => value.length > 0 && value.length * 2 <= 2560 && !value.includes("\0");

export function isReference(value: BehaviorValue): value is { variable: string } {
  return typeof value === "object" && value !== null && Object.keys(value).length === 1 && "variable" in value && typeof value.variable === "string";
}

export function isMatchedTrigger(value: BehaviorValue): value is { source: "trigger" } {
  return typeof value === "object" && value !== null && Object.keys(value).length === 1 && "source" in value && value.source === "trigger";
}

export function resolveValue(value: BehaviorValue, type: ValueType, variables: Variable[], matchedTrigger?: string): string {
  if (typeof value === "string") return value;
  if (isMatchedTrigger(value)) {
    if (type === "keys" && matchedTrigger) return matchedTrigger;
    throw new Error("Matched trigger requires a hotkey trigger");
  }
  const variable = variables.find(variable => variable.id === value.variable);
  if (!variable) throw new Error("Select a variable");
  if (variable.type !== type) throw new Error(`${variable.name} must be a ${type} variable`);
  if (variable.type === "number" && !Number.isFinite(variable.value)) throw new Error(`Invalid number: ${variable.name}`);
  return String(variable.value);
}
