import assert from "node:assert/strict";
import test from "node:test";
import { areStepsValid, expandBehavior, parseSteps, stepsToString } from "../src/behaviors.ts";
import { exportVariables, importVariables, profileVariableIds, readVariable, usedVariableIds, validateVariableBehaviors } from "../src/variables.ts";
import { withReferencedStates } from "../src/profileStates.ts";
import { withReferencedScripts } from "../src/scriptReferences.ts";
import { withReferencedOverlayParts } from "../src/overlayItems.ts";

const number = { id: "timer", name: "Cast delay", type: "number", value: 150 };
const keys = { id: "keys", name: "Cast keys", type: "keys", value: "rctrl shift n" };
const behavior = (id, steps) => ({ id, name: id, type: "behavior", value: stepsToString(steps) });
const call = variableId => ({ type: "behavior", variableId });
const cast = behavior("cast", [{ type: "press", key: { variable: "keys" }, onRelease: true },
  { type: "sleep", ms: { variable: "timer" } }, { type: "mousepress", key: "LButton", doubleClick: true }]);
const chain = behavior("chain", [call("cast"), { type: "press", key: "e" }]);
const variables = [chain, cast, number, keys];
const profile = source => ({ id: "profile", hotkeys: [{ trigger: "f1", behavior: source }], events: [], states: [], scripts: [], overlay_items: [], overlay_groups: [] });

test("shared behaviors retain sequence order inside a simultaneous caller and update every use", () => {
  const source = stepsToString([{ type: "parallel", steps: [call("chain"), { type: "hold", key: "x" }] }]);
  const expanded = parseSteps(expandBehavior(source, variables));
  assert.equal(expanded[0].steps[0].type, "sequence");
  assert.equal(expanded[0].steps[0].steps[0].type, "sequence");
  assert.deepEqual(expanded[0].steps[0].steps[0].steps, parseSteps(cast.value));
  assert.deepEqual(expanded[0].steps[0].steps[1], { type: "press", key: "e" });
  assert.equal(areStepsValid(parseSteps(source), variables, true), true);
  assert.equal(areStepsValid(parseSteps(source), variables, false), false);
  const changed = variables.map(value => value.id === "cast" ? behavior("cast", [{ type: "press", key: "rctrl 2" }]) : value);
  for (const outer of [source, stepsToString([call("cast"), call("chain")])]) {
    assert.match(expandBehavior(outer, changed), /rctrl 2/);
    assert.doesNotMatch(expandBehavior(outer, changed), /onRelease/);
  }
  assert.deepEqual(parseSteps(cast.value)[0].key, { variable: "keys" });
  assert.deepEqual(readVariable(cast), cast);
});

test("shared behavior validation rejects circular, missing, incompatible, empty and malformed definitions", () => {
  for (const values of [
    [behavior("self", [call("self")])],
    [behavior("a", [call("b")]), behavior("b", [call("a")])],
    [behavior("a", [call("missing")])],
    [behavior("a", [call("keys")]), keys],
    [behavior("a", [{ type: "sleep", ms: { variable: "timer" } }]), { ...number, value: -1 }],
    [behavior("a", [{ type: "unknown", source: "unsupported" }])],
    [behavior("a", [])],
  ]) assert.equal(validateVariableBehaviors(values), false, JSON.stringify(values));
  assert.throws(() => expandBehavior(stepsToString([call("a")]), [behavior("a", [call("a")])]), /Circular/);
  assert.throws(() => readVariable(behavior("empty", [])), /Invalid/);
  assert.equal(areStepsValid([call("missing")], variables), false);
  assert.equal(areStepsValid([call("keys")], variables), false);
});

test("nested shared definitions inherit the caller's trigger requirements", () => {
  const credentialId = "b8483943-e86c-41aa-a593-7388833369cd";
  for (const step of [{ type: "securesend", credentialId }, { type: "press", key: { source: "trigger" } },
    { type: "mousepress", key: "LButton", onRelease: true }]) {
    const values = [behavior("outer", [call("inner")]), behavior("inner", [step])];
    assert.equal(validateVariableBehaviors(values), true);
    assert.equal(areStepsValid([call("outer")], values, true), true);
    assert.equal(areStepsValid([call("outer")], values, false), false);
  }
  const ordinary = [behavior("ordinary", [{ type: "sleep", ms: "25" }, { type: "send", text: "hello" }])];
  assert.equal(areStepsValid([call("ordinary")], ordinary, false), true);
});

test("exports and deletion protection include transitive dependencies and unused definitions", () => {
  const owner = profile(stepsToString([call("chain")]));
  assert.deepEqual([...profileVariableIds([owner], variables)].sort(), ["cast", "chain", "keys", "timer"]);
  assert.deepEqual(exportVariables([owner], [...variables, { id: "unused", name: "Unused", type: "text", value: "ignore" }]).map(value => value.id).sort(), ["cast", "chain", "keys", "timer"]);
  assert.deepEqual([...usedVariableIds([], variables)].sort(), ["cast", "keys", "timer"]);
  const imported = importVariables([owner], JSON.parse(JSON.stringify(variables)), []);
  assert.equal(validateVariableBehaviors(imported.variables), true);
  assert.equal(areStepsValid(parseSteps(imported.profiles[0].hotkeys[0].behavior), imported.variables), true);
  assert.equal(imported.variables.length, 4);
  assert.ok(imported.variables.every(value => !variables.some(original => original.id === value.id)));
});

test("imports reuse definitions after mapping their dependencies and preserve local conflicts", () => {
  const original = profile(stepsToString([call("cast")]));
  const localKeys = { ...keys, id: "local-keys" }, localNumber = { ...number, id: "local-timer" };
  const localCast = behavior("local-cast", parseSteps(cast.value).map(step => step.type === "press" ? { ...step, key: { variable: localKeys.id } }
    : step.type === "sleep" ? { ...step, ms: { variable: localNumber.id } } : step));
  localCast.name = cast.name;
  const reused = importVariables([original], [cast, keys, number], [localKeys, localNumber, localCast]);
  assert.deepEqual(reused.variables, []);
  assert.deepEqual(parseSteps(reused.profiles[0].hotkeys[0].behavior), [call("local-cast")]);
  const conflict = importVariables([original], [cast, keys, number], [{ ...cast, value: 'press(x)' }]);
  assert.equal(conflict.variables.find(value => value.type === "behavior").name, "cast (2)");
  assert.equal(areStepsValid(parseSteps(conflict.profiles[0].hotkeys[0].behavior), conflict.variables), true);
  assert.throws(() => importVariables([original], [cast], []), /Missing imported/);
  assert.throws(() => importVariables([original], [behavior("cast", [call("cast")])], []), /Circular/);
});

test("portable profiles carry states, scripts and complete overlays referenced inside shared behaviors", () => {
  const state = { id: "state", name: "Magic protection", duration_ms: null };
  const script = { id: "script", name: "Cast script", language: "python" };
  const group = { id: "overlay", name: "Cast timer" };
  const item = { id: "timer-item", type: "timer", group_id: group.id, timer_state_id: state.id };
  const shared = behavior("shared", [{ type: "state", stateId: state.id }, { type: "script", scriptId: script.id }, { type: "startoverlay", itemId: group.id }]);
  const source = { ...profile(""), id: "source", states: [state], scripts: [script], overlay_groups: [group], overlay_items: [item] };
  const caller = profile(stepsToString([call("shared")]));
  const portable = withReferencedScripts(withReferencedStates(withReferencedOverlayParts(caller, [source], [shared]), [state], [shared]), [script], [shared]);
  assert.deepEqual(portable.states, [state]);
  assert.deepEqual(portable.scripts, [script]);
  assert.equal(portable.overlay_groups[0].id, group.id);
  assert.equal(portable.overlay_items[0].id, item.id);
  assert.deepEqual(parseSteps(portable.hotkeys[0].behavior), [call("shared")]);
});
