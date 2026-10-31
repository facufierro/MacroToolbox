import assert from "node:assert/strict";
import test from "node:test";
import { readTriggerList, resolveTriggers, isTriggerValid, triggerIdentity, triggerLabel } from "../src/triggers.ts";
import { isMatchedTrigger, isReference, resolveValue } from "../src/behaviorValues.ts";
import { areStepsValid, describeBehavior, mapBehavior, mapStepValues, parseSteps, stepsToString } from "../src/behaviors.ts";
import { exportVariables, importVariables, profileVariableIds, readVariable } from "../src/variables.ts";
import { allowsExtraModifiers } from "../src/hotkeyModifiers.ts";

const shortcuts = { id: "casts", name: "Cast shortcuts", type: "triggers", value: ["lctrl 1", "lctrl 2", "lctrl 3"] };
const matched = { source: "trigger" };
const source = stepsToString([{ type: "sequence", steps: [{ type: "press", key: matched, onRelease: true }, { type: "press", key: "e" }] }]);
const profile = { hotkeys: [{ trigger: { variable: "casts" }, behavior: source }], events: [] };

test("trigger lists preserve alternative shortcuts as ordered entries", () => {
  assert.deepEqual(readTriggerList(["  lctrl   1 ", "lctrl 2"]), ["lctrl 1", "lctrl 2"]);
  assert.deepEqual(readVariable(shortcuts), shortcuts);
  assert.deepEqual(resolveTriggers({ variable: "casts" }, [shortcuts]), shortcuts.value);
  assert.deepEqual(resolveTriggers("rctrl o", []), ["rctrl o"]);
  assert.deepEqual(resolveTriggers(" ", []), []);
  assert.equal(isTriggerValid("", []), false);
  for (const value of [[], "ctrl 1, ctrl 2", [""], [1], ["a", " "], ["lctrl 1", " LCTRL   1 "]]) {
    assert.throws(() => readTriggerList(value));
    assert.throws(() => readVariable({ ...shortcuts, value }));
  }
});

test("trigger sources require the right variable type and retain identity across renames", () => {
  const reference = { variable: "casts" };
  for (const variables of [[], [{ ...shortcuts, type: "keys", value: "lctrl 1" }]]) {
    assert.throws(() => resolveTriggers(reference, variables));
    assert.equal(isTriggerValid(reference, variables), false);
  }
  assert.equal(triggerLabel(reference, [{ ...shortcuts, name: "Renamed" }]), "Renamed");
  assert.equal(triggerIdentity(reference), triggerIdentity(JSON.parse(JSON.stringify(reference))));
  assert.notEqual(triggerIdentity(reference), triggerIdentity("casts"));
  assert.equal(triggerLabel(reference, []), "Missing variable");
  assert.equal(allowsExtraModifiers({ trigger: reference }), false);
  assert.equal(allowsExtraModifiers({ trigger: reference, allow_extra_modifiers: true }), true);
  assert.equal(allowsExtraModifiers({ trigger: "1" }), true);
  assert.equal(allowsExtraModifiers({ trigger: "lctrl 1" }), false);
});

test("each matched shortcut resolves independently while shared steps and saved source stay intact", () => {
  for (const trigger of resolveTriggers(profile.hotkeys[0].trigger, [shortcuts])) {
    const resolved = mapBehavior(source, step => mapStepValues(step, (value, type) => resolveValue(value, type, [], trigger)));
    assert.deepEqual(parseSteps(resolved), [{ type: "sequence", steps: [
      { type: "press", key: trigger, onRelease: true }, { type: "press", key: "e" },
    ] }]);
  }
  assert.deepEqual(parseSteps(source)[0].steps[0].key, matched);
  assert.equal(describeBehavior(source, id => id, id => id), "sequence(press(Matched trigger, on release); press(e))");
  assert.equal(areStepsValid(parseSteps(source), [], true), true);
  assert.equal(areStepsValid(parseSteps(source), [], false), false);
  assert.equal(isReference(matched), false);
  assert.equal(isMatchedTrigger({ ...matched, variable: "casts" }), false);
  assert.throws(() => resolveValue(matched, "keys", []));
  assert.throws(() => resolveValue(matched, "text", [], "lctrl 1"));
  assert.throws(() => resolveValue({ variable: "casts" }, "keys", [shortcuts]));
});

test("matched input is only accepted by Press in a hotkey", () => {
  for (const step of [{ type: "hold", key: matched }, { type: "waitfor", key: matched },
    { type: "mousepress", key: matched }, { type: "repeat", key: matched, interval: "100", hold: "6" },
    { type: "send", text: matched }, { type: "sleep", ms: matched }]) {
    assert.equal(areStepsValid([step], [], true), false);
    assert.equal(areStepsValid(parseSteps(stepsToString([step])), [], true), false);
  }
  for (const key of [{ source: "future" }, { source: "trigger", extra: true }]) {
    assert.equal(areStepsValid(parseSteps(stepsToString([{ type: "press", key }]))), false);
  }
});

test("export and import carry trigger references, reuse equal lists, and isolate conflicts", () => {
  assert.deepEqual([...profileVariableIds([profile])], ["casts"]);
  assert.deepEqual(exportVariables([profile], [shortcuts]), [shortcuts]);
  const existing = { ...shortcuts, id: "local" };
  const reused = importVariables([profile], [shortcuts], [existing]);
  assert.deepEqual(reused.variables, []);
  assert.deepEqual(reused.profiles[0].hotkeys[0].trigger, { variable: "local" });
  assert.equal(reused.profiles[0].hotkeys[0].behavior, source);
  const conflict = importVariables([profile], [shortcuts], [{ ...shortcuts, value: ["f1"] }]);
  assert.equal(conflict.variables.length, 1);
  assert.deepEqual(conflict.variables[0].value, shortcuts.value);
  assert.equal(conflict.variables[0].name, "Cast shortcuts (2)");
  assert.deepEqual(conflict.profiles[0].hotkeys[0].trigger, { variable: conflict.variables[0].id });
  assert.throws(() => importVariables([profile], [], []), /Missing imported variable/);
});
