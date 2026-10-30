import type { NumberVariable } from "./types";

export type Step =
  | { type: "press" | "hold" | "waitfor"; key: string }
  | { type: "mousepress"; key: string; doubleClick?: boolean }
  | { type: "repeat"; key: string; interval: string; hold: string }
  | { type: "sequence" | "parallel"; steps: Step[] }
  | { type: "goto"; x: string; y: string }
  | { type: "resolution"; width: string; height: string }
  | { type: "state"; stateId: string; action?: "toggle" | "set" | "clear" }
  | { type: "startoverlay"; itemId: string; restart?: boolean }
  | { type: "stopoverlay"; itemId: string }
  | { type: "bar"; itemId: string; value: string }
  | { type: "script"; scriptId: string }
  | { type: "sleep"; ms: string }
  | { type: "send"; text: string }
  | { type: "unknown"; source: string }
  | { type: "borderless" | "fit" | "killprocess" | "lock" | "savecursor" | "restorecursor" | "stretch" };

// Behavior strings are the storage boundary. New edits use structured actions; the
// reader also preserves old commands, including commands this version cannot edit.
export function parseSteps(behavior: string): Step[] {
  if (!behavior.trim()) return [];
  if (behavior.trimStart().startsWith("[")) {
    try {
      const values: unknown = JSON.parse(behavior);
      return Array.isArray(values) ? values.map(structuredStep) : [{ type: "unknown", source: behavior }];
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
  return tokens.map(token => token.trim()).filter(Boolean).map(source => {
    const match = source.match(/^(\w+)\(([\s\S]*)\)$/);
    if (!match) return ["borderless", "fit", "killprocess", "lock", "savecursor", "restorecursor", "stretch"].includes(source)
      ? { type: source } as Step : { type: "unknown", source };
    const [, command, argument] = match;
    switch (command.toLowerCase()) {
      case "press": case "hold": case "mousepress": case "waitfor":
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
        return { type: "startoverlay", itemId: argument, restart: command === "restartoverlay" };
      case "sleep": return { type: "sleep", ms: argument };
      case "send": return { type: "send", text: argument };
      default: return { type: "unknown", source };
    }
  });
}

function structuredStep(value: unknown): Step {
  const unknown = (): Step => ({ type: "unknown", source: JSON.stringify(value) });
  if (!value || typeof value !== "object" || !("type" in value)) return unknown();
  const step = value as Record<string, unknown>;
  if (step.type === "sequence" || step.type === "parallel") {
    return Array.isArray(step.steps) ? { type: step.type, steps: step.steps.map(structuredStep) } : unknown();
  }
  const fields: Record<string, string[]> = {
    press: ["key"], hold: ["key"], mousepress: ["key"], waitfor: ["key"],
    repeat: ["key", "interval", "hold"], goto: ["x", "y"], resolution: ["width", "height"],
    state: ["stateId"], startoverlay: ["itemId"], stopoverlay: ["itemId"], bar: ["itemId", "value"],
    script: ["scriptId"], sleep: ["ms"], send: ["text"], unknown: ["source"],
    borderless: [], fit: [], killprocess: [], lock: [], savecursor: [], restorecursor: [], stretch: [],
  };
  const required = fields[String(step.type)];
  return required && required.every(field => typeof step[field] === "string") ? value as Step : unknown();
}

export function stepsToString(steps: Step[]): string {
  return steps.length ? JSON.stringify(steps) : "";
}

const input = /^(?:(?:[lr]?(?:ctrl|shift|alt|win))\s+)*(?:[^\s,]+)(?:[\s,]+[^\s,]+)*$/i;
const mouse = /^(?:(?:[lr]?(?:ctrl|shift|alt|win))\s+)*(?:[lrm]button|xbutton[12]|m[12])$/i;
const integer = (value: string, minimum: number) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= minimum && Number(value) <= 0xffffffff;

// Only numeric parameters resolve references; text and key names remain literal.
export function mapStepNumbers(step: Step, map: (value: string) => string): Step {
  switch (step.type) {
    case "sleep": return { ...step, ms: map(step.ms) };
    case "repeat": return { ...step, interval: map(step.interval), hold: map(step.hold) };
    case "goto": return { ...step, x: map(step.x), y: map(step.y) };
    case "resolution": return { ...step, width: map(step.width), height: map(step.height) };
    case "bar": return { ...step, value: map(step.value) };
    default: return step;
  }
}

export function resolveNumber(value: string, variables: NumberVariable[]): string {
  if (!value.startsWith("$")) return value;
  const variable = variables.find(variable => variable.id === value.slice(1));
  if (!variable || !Number.isFinite(variable.value)) throw new Error("Missing or invalid number variable");
  return String(variable.value);
}

export function areStepsValid(steps: Step[], variables: NumberVariable[] = []): boolean {
  return steps.every(step => {
    try { step = mapStepNumbers(step, value => resolveNumber(value, variables)); }
    catch { return false; }
    switch (step.type) {
      case "sequence": case "parallel": return step.steps.length > 0 && areStepsValid(step.steps, variables);
      case "press": case "hold": case "waitfor": return input.test(step.key.trim());
      case "mousepress": return mouse.test(step.key.trim()) && (step.doubleClick === undefined || typeof step.doubleClick === "boolean");
      case "repeat": return input.test(step.key.trim()) && integer(step.interval, 1) && integer(step.hold, 0);
      case "sleep": return integer(step.ms, 0);
      case "resolution": return integer(step.width, 1) && integer(step.height, 1);
      case "goto": return [step.x, step.y].every(value => value.trim() !== "" && Number.isFinite(Number(value)));
      case "state": return !!step.stateId;
      case "startoverlay": case "stopoverlay": return !!step.itemId;
      case "bar": return !!step.itemId && step.value.trim() !== "" && Number.isFinite(Number(step.value));
      case "script": return !!step.scriptId;
      case "unknown": return false;
      default: return true;
    }
  });
}

export function mapBehavior(behavior: string, map: (step: Step) => Step | null): string {
  const visit = (steps: Step[]): Step[] => steps.flatMap(step => {
    const mapped = map(step.type === "sequence" || step.type === "parallel" ? { ...step, steps: visit(step.steps) } : step);
    return mapped && !((mapped.type === "sequence" || mapped.type === "parallel") && !mapped.steps.length) ? [mapped] : [];
  });
  const original = parseSteps(behavior);
  const changed = visit(original);
  return JSON.stringify(original) === JSON.stringify(changed) ? behavior : stepsToString(changed);
}

export function describeBehavior(behavior: string, stateName: (id: string) => string, itemName: (id: string) => string, variableName: (id: string) => string = id => id): string {
  const describe = (steps: Step[]): string => steps.map(step => {
    step = mapStepNumbers(step, value => value.startsWith("$") ? variableName(value.slice(1)) : value);
    switch (step.type) {
      case "parallel": case "sequence": return `${step.type}(${describe(step.steps)})`;
      case "press": case "hold": case "repeat": case "waitfor": return `${step.type}(${step.key})`;
      case "mousepress": return `${step.type}(${step.key}${step.doubleClick ? ", double" : ""})`;
      case "state": return `${step.action === "set" ? "enter" : step.action === "clear" ? "leave" : "state"}(${stateName(step.stateId)})`;
      case "startoverlay": return `${step.restart ? "restartoverlay" : "startoverlay"}(${itemName(step.itemId)})`;
      case "stopoverlay": case "bar": return `${step.type}(${itemName(step.itemId)}${step.type === "bar" ? `, ${step.value}` : ""})`;
      case "script": return "script";
      case "sleep": return `sleep(${step.ms})`;
      case "send": return `send(${step.text})`;
      case "goto": return `goto(${step.x},${step.y})`;
      case "resolution": return `resolution(${step.width},${step.height})`;
      case "unknown": return step.source;
      default: return step.type;
    }
  }).join("; ");
  return describe(parseSteps(behavior)) || "No behavior";
}
