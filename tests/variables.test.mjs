import assert from "node:assert/strict";
import test from "node:test";
import { areStepsValid, describeBehavior, mapBehavior, mapStepValues, parseSteps, stepsToString } from "../src/behaviors.ts";
import { isReference, resolveValue } from "../src/behaviorValues.ts";
import { duplicateVariable, exportVariables, importVariables, profileVariableIds, readVariable, validateVariableBehaviors } from "../src/variables.ts";

const buff = { id: "buff", name: "buff timer", type: "number", value: 5000 };
const pause = { id: "pause", name: "sleep timer", type: "number", value: 50 };
const profile = (behavior, id = "profile") => ({ id, hotkeys: [{ behavior }], events: [] });

test("duplicating every variable type creates a separate identity and preserves its value and references", () => {
  const variables = [buff,
    { id: "text", name: "Text", type: "text", value: "$buff; hello\nworld" },
    { id: "keys", name: "Keys", type: "keys", value: "rctrl shift n" },
    { id: "triggers", name: "Shortcuts", type: "triggers", value: ["lctrl 1", "lctrl 2"] },
    { id: "behavior", name: "Cast", type: "behavior", value: stepsToString([
      { type: "sequence", steps: [{ type: "sleep", ms: { variable: "buff" } },
        { type: "press", key: { source: "trigger" }, onRelease: true },
        { type: "behavior", variableId: "nested" },
        { type: "securesend", credentialId: "b8483943-e86c-41aa-a593-7388833369cd" }] },
    ]) },
    { id: "nested", name: "Nested", type: "behavior", value: "send(hello)" },
  ];
  const before = structuredClone(variables);
  const copies = variables.map(variable => duplicateVariable(variable, variables));
  assert.equal(new Set([...variables, ...copies].map(variable => variable.id)).size, variables.length * 2);
  for (const [index, copy] of copies.entries()) {
    assert.deepEqual(readVariable(copy), copy);
    assert.equal(copy.type, variables[index].type);
    assert.deepEqual(copy.value, variables[index].value);
    assert.equal(copy.name, `${variables[index].name} (copy)`);
  }
  assert.equal(validateVariableBehaviors([...variables, ...copies]), true);
  copies[3].value[0] = "rctrl 3";
  assert.deepEqual(variables, before);
});

test("repeated duplicates and copies of copies get unique case-insensitive names", () => {
  const variables = [buff, { ...buff, id: "existing", name: " BUFF TIMER (COPY) " }];
  const first = duplicateVariable(buff, variables);
  variables.push(first);
  const second = duplicateVariable(buff, variables);
  variables.push(second);
  const nested = duplicateVariable(first, variables);
  assert.equal(first.name, "buff timer (copy) (2)");
  assert.equal(second.name, "buff timer (copy) (3)");
  assert.equal(nested.name, "buff timer (copy) (2) (copy)");
  assert.equal(new Set([...variables, nested].map(variable => variable.id)).size, 5);
  assert.equal(buff.name, "buff timer");
});

test("all numeric behavior parameters accept shared variables in nested groups", () => {
  const steps = [{ type: "parallel", steps: [
    { type: "sleep", ms: { variable: "buff" } },
    { type: "sequence", steps: [
      { type: "repeat", key: "x", interval: { variable: "buff" }, hold: { variable: "pause" } },
      { type: "goto", x: { variable: "pause" }, y: "12.5" },
      { type: "resolution", width: { variable: "buff" }, height: "1080" },
      { type: "bar", itemId: "bar", value: { variable: "pause" } },
      { type: "send", text: "$buff" },
    ] },
  ] }];
  assert.equal(areStepsValid(steps, [buff, pause]), true);
  const source = stepsToString(steps);
  const resolved = mapBehavior(source, step => mapStepValues(step, (value, type) => resolveValue(value, type, [buff, pause])));
  assert.equal(parseSteps(resolved)[0].steps[0].ms, "5000");
  assert.equal(parseSteps(resolved)[0].steps[1].steps[4].text, "$buff");
  assert.deepEqual([...profileVariableIds([profile(source)])].sort(), ["buff", "pause"]);
  assert.equal(source, stepsToString(steps));
});

test("variable values obey the numeric field's existing boundaries", () => {
  for (const [value, sleep, repeat] of [[0, true, false], [-0, true, false], [1, true, true],
    [0xffffffff, true, true], [0x100000000, false, false], [-1, false, false], [1.5, false, false], [Infinity, false, false]]) {
    const variables = [{ ...buff, value }];
    assert.equal(areStepsValid([{ type: "sleep", ms: { variable: "buff" } }], variables), sleep, String(value));
    assert.equal(areStepsValid([{ type: "repeat", key: "x", interval: { variable: "buff" }, hold: "6" }], variables), repeat, String(value));
  }
  assert.equal(areStepsValid([{ type: "sleep", ms: { variable: "missing" } }], [buff]), false);
  assert.equal(areStepsValid([{ type: "goto", x: { variable: "buff" }, y: "0" }], [{ ...buff, value: -12.5 }]), true);
});

test("renames preserve references and summaries show the current name", () => {
  const source = stepsToString([{ type: "sleep", ms: { variable: "buff" } }]);
  const renamed = { ...buff, name: "new timer", value: 6000 };
  assert.equal(resolveValue({ variable: "buff" }, "number", [renamed]), "6000");
  assert.equal(describeBehavior(source, id => id, id => id, id => [renamed].find(variable => variable.id === id).name), "sleep(new timer)");
  assert.deepEqual(parseSteps(source)[0].ms, { variable: "buff" });
});

test("profile and folder exports preserve variables shared by hotkeys and events", () => {
  const profiles = [profile("sleep($buff)"), { ...profile("sleep($buff)", "other"), events: [{ behavior: "sleep($pause)" }] }];
  const portable = JSON.parse(JSON.stringify({ profiles, variables: exportVariables(profiles, [buff, pause, { id: "unused", name: "unused", value: 1 }]) }));
  assert.deepEqual(portable.variables, [buff, pause]);
  const imported = importVariables(portable.profiles, portable.variables, []);
  assert.equal(imported.variables.length, 2);
  assert.deepEqual(parseSteps(imported.profiles[0].hotkeys[0].behavior)[0].ms, { variable: imported.variables[0].id });
  assert.equal(imported.profiles[0].hotkeys[0].behavior, imported.profiles[1].hotkeys[0].behavior);
  for (const current of imported.profiles) {
    for (const entry of [...current.hotkeys, ...current.events]) assert.equal(areStepsValid(parseSteps(entry.behavior), imported.variables), true);
  }
});

test("imports reuse matching values and isolate conflicts without overwriting local variables", () => {
  const profiles = [profile("sleep($buff)")];
  const reused = importVariables(profiles, [buff], [{ ...buff, id: "local" }]);
  assert.deepEqual(reused.variables, []);
  assert.deepEqual(parseSteps(reused.profiles[0].hotkeys[0].behavior)[0].ms, { variable: "local" });
  const existing = [{ ...buff, value: 1000 }];
  const imported = importVariables(profiles, [buff], existing);
  assert.equal(imported.variables[0].name, "buff timer (2)");
  assert.equal(imported.variables[0].value, 5000);
  assert.notEqual(imported.variables[0].id, "buff");
  assert.equal(existing[0].value, 1000);
});

test("legacy exports need no variables, while missing and malformed references fail clearly", () => {
  assert.deepEqual(importVariables([{ hotkeys: [{ behavior: "sleep(50)" }], exe: "Game.exe" }], [], []).profiles[0],
    { hotkeys: [{ behavior: "sleep(50)" }], events: [], exe: "Game.exe" });
  assert.throws(() => importVariables([profile("sleep($missing)")], [], []), /Missing imported/);
  assert.throws(() => exportVariables([profile("sleep($missing)")], []), /Missing variable/);
  for (const incoming of [[{ ...buff, value: "50" }], [buff, buff], [{ ...buff, name: " " }]]) {
    assert.throws(() => importVariables([profile("sleep($buff)")], incoming, []), /Invalid variable|Enter a variable name|Duplicate imported/);
  }
});

const message = { id: "message", name: "chat message", type: "text", value: "$buff; hello\nworld" };
const keys = { id: "keys", name: "cast keys", type: "keys", value: "rctrl shift n" };

test("text and key references are typed and literal dollar-prefixed text is preserved", () => {
  const steps = [{ type: "send", text: { variable: "message" } }, { type: "press", key: { variable: "keys" } },
    { type: "send", text: "$buff" }];
  const variables = [buff, message, keys];
  assert.equal(areStepsValid(steps, variables), true);
  assert.equal(resolveValue(steps[0].text, "text", variables), message.value);
  assert.equal(resolveValue(steps[1].key, "keys", variables), keys.value);
  assert.deepEqual(parseSteps(stepsToString(steps)), steps);
  assert.deepEqual([...profileVariableIds([profile(stepsToString(steps))])], ["message", "keys"]);
  for (const step of [{ type: "sleep", ms: { variable: "message" } }, { type: "send", text: { variable: "buff" } },
    { type: "press", key: { variable: "message" } }]) assert.equal(areStepsValid([step], variables), false);
  assert.equal(isReference({ variable: "keys", unexpected: true }), false);
});

test("legacy number references migrate at read time without interpreting literal strings", () => {
  assert.deepEqual(parseSteps('sleep($buff);send($buff);press($buff)'), [
    { type: "sleep", ms: { variable: "buff" } }, { type: "send", text: "$buff" }, { type: "press", key: "$buff" },
  ]);
  assert.deepEqual(readVariable({ id: "buff", name: "buff timer", value: 5000 }), buff);
  for (const variable of [message, keys, { ...buff, value: 0 }]) assert.deepEqual(readVariable(variable), variable);
  assert.throws(() => readVariable({ ...keys, value: "" }), /Enter keys/);
});

test("typed imports keep text and key references and do not merge different variable types", () => {
  const source = profile(stepsToString([{ type: "send", text: { variable: "message" } }, { type: "hold", key: { variable: "keys" } }]));
  const existing = [{ id: "number-message", name: message.name, type: "number", value: 10 }];
  const imported = importVariables([source], exportVariables([source], [buff, message, keys]), existing);
  assert.equal(imported.variables[0].type, "text");
  assert.equal(imported.variables[0].name, "chat message (2)");
  assert.equal(imported.variables[1].type, "keys");
  assert.equal(areStepsValid(parseSteps(imported.profiles[0].hotkeys[0].behavior), imported.variables), true);
  assert.equal(existing[0].value, 10);
});
