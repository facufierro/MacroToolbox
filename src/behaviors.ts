import type { BehaviorValue, Variable, ValueType, SecureTextDraft } from "./types";
import { isReference, isMatchedTrigger, resolveValue, isCredentialId, isPasswordValid } from "./behaviorValues.ts";

export type Step =
  | { type: "hold" | "toggle"; key: BehaviorValue }
  | { type: "waitfor" }
  | { type: "press"; key: BehaviorValue; onRelease?: boolean }
  | { type: "mousepress"; key: BehaviorValue; doubleClick?: boolean; onRelease?: boolean }
  | { type: "repeat"; key: BehaviorValue; interval: BehaviorValue; hold: BehaviorValue }
  | { type: "sequence" | "parallel"; steps: Step[] }
  | { type: "goto"; x: BehaviorValue; y: BehaviorValue }
  | { type: "resolution"; width: BehaviorValue; height: BehaviorValue }
  | { type: "state"; stateId: string; action?: "toggle" | "set" | "clear" }
  | { type: "startoverlay"; itemIds: string[]; restart?: boolean }
  | { type: "stopoverlay"; itemIds: string[] }
  | { type: "bar"; itemId: string; value: BehaviorValue }
  | { type: "script"; scriptId: string }
  | { type: "sleep"; ms: BehaviorValue }
  | { type: "send"; text: BehaviorValue }
  | { type: "securesend"; credentialId: string }
  | { type: "behavior"; variableId: string }
  | { type: "unknown"; source: string }
  | { type: "borderless" | "fit" | "killprocess" | "lock" | "savecursor" | "restorecursor" | "stretch" };

// Behavior strings are the storage boundary. New edits use structured actions; the
// reader also preserves old commands, including commands this version cannot edit.
export function parseSteps(behavior: string): Step[] {
  if (!behavior.trim()) return [];
  if (behavior.trimStart().startsWith("[")) {
    try {
      const values: unknown = JSON.parse(behavior);
      return Array.isArray(values) ? values.flatMap(readStructuredSteps) : [{ type: "unknown", source: behavior }];
    } catch { return [{ type: "unknown", source: behavior }]; }
  }
  const tokens: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < behavior.length; i++) {
    if (behavior[i] === "(") depth++;
    else if (behavior[i] === ")") depth--;
    else if (behavior[i] === ";" && depth === 0) {
      tokens.push(behavior.slice(start, i));
      start = i + 1;
    }
  }
  tokens.push(behavior.slice(start));
  return tokens.map(token => token.trim()).filter(Boolean).flatMap((source): Step | Step[] => {
    const match = source.match(/^(\w+)\(([\s\S]*)\)$/);
    if (!match) return ["borderless", "fit", "killprocess", "lock", "savecursor", "restorecursor", "stretch"].includes(source)
      ? { type: source } as Step : { type: "unknown", source };
    const [, command, argument] = match;
    switch (command.toLowerCase()) {
      case "waitfor": return legacyInputWait(argument);
      case "press": case "hold": case "toggle": case "mousepress":
        return { type: command.toLowerCase(), key: argument } as Step;
      case "pressalt": return { type: "mousepress", key: argument };
      case "repeat": {
        const [key, interval = "", hold = "6"] = argument.split(",").map(value => value.trim());
        return { type: "repeat", key, interval, hold };
      }
      case "goto": {
        const [x = "", y = ""] = argument.split(",").map(value => value.trim());
        return { type: "goto", x, y };
      }
      case "resolution": {
        const [width = "", height = ""] = argument.split(",").map(value => value.trim());
        return { type: "resolution", width, height };
      }
      case "state": return { type: "state", stateId: argument, action: "toggle" };
      case "startoverlay": case "restartoverlay":
        return { type: "startoverlay", itemIds: [argument], restart: command === "restartoverlay" };
      case "stopoverlay": return { type: "stopoverlay", itemIds: [argument] };
      case "sleep": return { type: "sleep", ms: argument };
      case "send": return { type: "send", text: argument };
      default: return { type: "unknown", source };
    }
  }).map(normalizeLegacyValues);
}

function legacyInputWait(key: BehaviorValue): Step[] {
  const type = typeof key === "string" && mouse.test(key.trim()) ? "mousepress" : "press";
  return [{ type: "waitfor" }, { type, key }];
}

function readStructuredSteps(value: unknown): Step[] {
  if (value && typeof value === "object" && "type" in value && value.type === "waitfor" && "key" in value
      && Object.keys(value).length === 2 && (typeof value.key === "string" || isReference(value.key as BehaviorValue))) {
    return legacyInputWait(value.key as BehaviorValue);
  }
  return [structuredStep(value)];
}

function structuredStep(value: unknown): Step {
  const unknown = (): Step => ({ type: "unknown", source: JSON.stringify(value) });
  if (!value || typeof value !== "object" || !("type" in value)) return unknown();
  const step = value as Record<string, unknown>;
  if (step.type === "sequence" || step.type === "parallel") {
    return Array.isArray(step.steps) ? { type: step.type, steps: step.steps.flatMap(readStructuredSteps) } : unknown();
  }
  if (step.type === "waitfor" && step.key === undefined) return Object.keys(step).length === 1 ? { type: "waitfor" } : unknown();
  if (step.type === "startoverlay" || step.type === "stopoverlay") {
    if (step.itemIds === undefined && typeof step.itemId === "string") {
      const { itemId, ...rest } = step;
      return structuredStep({ ...rest, itemIds: [itemId] });
    }
    const allowed = step.type === "startoverlay" ? ["type", "itemIds", "restart"] : ["type", "itemIds"];
    return Array.isArray(step.itemIds) && step.itemIds.every(id => typeof id === "string") && Object.keys(step).every(field => allowed.includes(field))
      ? step as Step : unknown();
  }
  const fields: Record<string, string[]> = {
    press: ["key"], hold: ["key"], toggle: ["key"], mousepress: ["key"],
    repeat: ["key", "interval", "hold"], goto: ["x", "y"], resolution: ["width", "height"],
    state: ["stateId"], bar: ["itemId", "value"],
    script: ["scriptId"], sleep: ["ms"], send: ["text"], securesend: ["credentialId"], behavior: ["variableId"], unknown: ["source"],
    borderless: [], fit: [], killprocess: [], lock: [], savecursor: [], restorecursor: [], stretch: [],
  };
  const required = fields[String(step.type)];
  if (!required) return unknown();
  const parameters = new Set<string>();
  mapStepValues(value as Step, (_value, _type, field) => { parameters.add(field); return _value; });
  return required.every(field => typeof step[field] === "string" || (parameters.has(field) && (isReference(step[field] as BehaviorValue)
    || (step.type === "press" && field === "key" && isMatchedTrigger(step[field] as BehaviorValue)))))
    ? normalizeLegacyValues(value as Step) : unknown();
}

export function stepsToString(steps: Step[]): string {
  return steps.length ? JSON.stringify(steps) : "";
}

export function expandBehavior(behavior: string, variables: Variable[], visiting: string[] = []): string {
  const expand = (steps: Step[]): Step[] => steps.map(step => {
    if (step.type === "behavior") {
      const variable = variables.find(variable => variable.id === step.variableId);
      if (!variable || variable.type !== "behavior") throw new Error("Select a Behavior variable");
      if (visiting.includes(variable.id)) throw new Error("Circular behavior variable");
      return { type: "sequence", steps: parseSteps(expandBehavior(variable.value, variables, [...visiting, variable.id])) };
    }
    return step.type === "sequence" || step.type === "parallel" ? { ...step, steps: expand(step.steps) } : step;
  });
  return stepsToString(expand(parseSteps(behavior)));
}

export const keyInputPattern = /^(?:(?:[lr]?(?:ctrl|shift|alt|win))\s+)*(?:[^\s,]+)(?:[\s,]+[^\s,]+)*$/i;
const mouse = /^(?:(?:[lr]?(?:ctrl|shift|alt|win))\s+)*(?:[lrm]button|xbutton[12]|m[12])$/i;
const integer = (value: string, minimum: number) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= minimum && Number(value) <= 0xffffffff;

export function mapStepValues(step: Step, map: (value: BehaviorValue, type: ValueType, field: string) => BehaviorValue): Step {
  switch (step.type) {
    case "sleep": return { ...step, ms: map(step.ms, "number", "ms") };
    case "press": case "hold": case "toggle": case "mousepress": return { ...step, key: map(step.key, "keys", "key") };
    case "send": return { ...step, text: map(step.text, "text", "text") };
    case "repeat": return { ...step, key: map(step.key, "keys", "key"), interval: map(step.interval, "number", "interval"), hold: map(step.hold, "number", "hold") };
    case "goto": return { ...step, x: map(step.x, "number", "x"), y: map(step.y, "number", "y") };
    case "resolution": return { ...step, width: map(step.width, "number", "width"), height: map(step.height, "number", "height") };
    case "bar": return { ...step, value: map(step.value, "number", "value") };
    default: return step;
  }
}

// Old number references used a string prefix. Convert it only at the read boundary;
// literal text such as "$buff" is never interpreted as a reference.
function normalizeLegacyValues(step: Step): Step {
  return mapStepValues(step, (value, type) => type === "number" && typeof value === "string" && value.startsWith("$")
    ? { variable: value.slice(1) } : value);
}

export function areStepsValid(steps: Step[], variables: Variable[] = [], hasTrigger = true, secureTexts: SecureTextDraft[] = [], visiting: string[] = []): boolean {
  return steps.every((step, index) => {
    try { step = mapStepValues(step, (value, type, field) => step.type === "press" && field === "key" && isMatchedTrigger(value)
      ? value : resolveValue(value, type, variables)); }
    catch { return false; }
    switch (step.type) {
      case "sequence": case "parallel": return step.steps.length > 0 && areStepsValid(step.steps, variables, hasTrigger, secureTexts, visiting);
      case "behavior": {
        const variable = variables.find(variable => variable.id === step.variableId);
        return variable?.type === "behavior" && !visiting.includes(variable.id)
          && areStepsValid(parseSteps(variable.value), variables, hasTrigger, secureTexts, [...visiting, variable.id]);
      }
      case "securesend": return hasTrigger && isCredentialId(step.credentialId)
        && secureTexts.filter(draft => draft.credentialId === step.credentialId).every(draft => isPasswordValid(draft.password));
      case "waitfor": return index + 1 < steps.length;
      case "hold": return keyInputPattern.test(String(step.key).trim());
      case "toggle": return hasTrigger && keyInputPattern.test(String(step.key).trim());
      case "press": return (isMatchedTrigger(step.key) ? hasTrigger : keyInputPattern.test(String(step.key).trim())) && validActivation(step.onRelease, hasTrigger);
      case "mousepress": return mouse.test(String(step.key).trim()) && (step.doubleClick === undefined || typeof step.doubleClick === "boolean") && validActivation(step.onRelease, hasTrigger);
      case "repeat": return keyInputPattern.test(String(step.key).trim()) && integer(String(step.interval), 1) && integer(String(step.hold), 0);
      case "sleep": return integer(String(step.ms), 0);
      case "resolution": return integer(String(step.width), 1) && integer(String(step.height), 1);
      case "goto": return [step.x, step.y].every(value => String(value).trim() !== "" && Number.isFinite(Number(value)));
      case "state": return !!step.stateId;
      case "startoverlay": case "stopoverlay": return step.itemIds.length > 0 && step.itemIds.every(id => id.trim().length > 0)
        && new Set(step.itemIds).size === step.itemIds.length && (step.type !== "startoverlay" || step.restart === undefined || typeof step.restart === "boolean");
      case "bar": return !!step.itemId && String(step.value).trim() !== "" && Number.isFinite(Number(step.value));
      case "script": return !!step.scriptId;
      case "unknown": return false;
      default: return true;
    }
  });
}

function validActivation(onRelease: unknown, hasTrigger: boolean): boolean {
  return onRelease === undefined || onRelease === false || (onRelease === true && hasTrigger);
}

export function mapBehavior(behavior: string, map: (step: Step) => Step | null): string {
  const visit = (steps: Step[]): Step[] => {
    const changed = steps.flatMap(step => {
      const mapped = map(step.type === "sequence" || step.type === "parallel" ? { ...step, steps: visit(step.steps) } : step);
      return mapped && !((mapped.type === "sequence" || mapped.type === "parallel") && !mapped.steps.length) ? [mapped] : [];
    });
    if (changed.length < steps.length) {
      // Removing a referenced target must also remove waits left without that target.
      while (changed.length) {
        const last = changed[changed.length - 1];
        if (last.type !== "waitfor") break;
        changed.pop();
      }
    }
    return changed;
  };
  const original = parseSteps(behavior);
  const changed = visit(original);
  return JSON.stringify(original) === JSON.stringify(changed) ? behavior : stepsToString(changed);
}

export function describeBehavior(behavior: string, stateName: (id: string) => string, itemName: (id: string) => string, variableName: (id: string) => string = id => id): string {
  const describe = (steps: Step[]): string => steps.map(step => {
    step = mapStepValues(step, value => isReference(value) ? variableName(value.variable) : isMatchedTrigger(value) ? "Matched trigger" : value);
    switch (step.type) {
      case "parallel": case "sequence": return `${step.type}(${describe(step.steps)})`;
      case "waitfor": return "waitfor(next action)";
      case "hold": case "toggle": case "repeat": return `${step.type}(${step.key})`;
      case "press": return `press(${step.key}${step.onRelease ? ", on release" : ""})`;
      case "mousepress": return `${step.type}(${step.key}${step.doubleClick ? ", double" : ""}${step.onRelease ? ", on release" : ""})`;
      case "state": return `${step.action === "set" ? "enter" : step.action === "clear" ? "leave" : "state"}(${stateName(step.stateId)})`;
      case "startoverlay": return `${step.restart ? "restartoverlay" : "startoverlay"}(${step.itemIds.map(itemName).join(", ")})`;
      case "stopoverlay": return `stopoverlay(${step.itemIds.map(itemName).join(", ")})`;
      case "bar": return `bar(${itemName(step.itemId)}, ${step.value})`;
      case "script": return "script";
      case "sleep": return `sleep(${step.ms})`;
      case "send": return `send(${step.text})`;
      case "securesend": return "Secure send";
      case "behavior": return variableName(step.variableId);
      case "goto": return `goto(${step.x},${step.y})`;
      case "resolution": return `resolution(${step.width},${step.height})`;
      case "unknown": return step.source;
      default: return step.type;
    }
  }).join("; ");
  return describe(parseSteps(behavior)) || "No behavior";
}
