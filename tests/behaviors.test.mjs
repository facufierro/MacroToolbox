import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { readVariable } from "../src/variables.ts";
import { parseSteps, stepsToString, areStepsValid, mapBehavior, describeBehavior } from "../src/behaviors.ts";

test("editor and backend share the same behavior compatibility fixtures", () => {
  const fixtures = JSON.parse(readFileSync(new URL("./fixtures/behaviors.json", import.meta.url), "utf8"));
  for (const fixture of fixtures) {
    assert.deepEqual(parseSteps(fixture.source), fixture.steps);
    assert.equal(areStepsValid(parseSteps(fixture.source), (fixture.variables ?? []).map(readVariable), fixture.hasTrigger ?? true), fixture.valid);
  }
});

test("structured behavior groups and text round-trip without interpreting separators", () => {
  const steps = [{ type: "parallel", steps: [
    { type: "hold", key: "rctrl LButton" },
    { type: "sequence", steps: [{ type: "send", text: "hello; (world)\nø" }, { type: "repeat", key: "a b", interval: "100", hold: "6" }] },
  ] }];
  assert.deepEqual(parseSteps(stepsToString(steps)), steps);
  assert.equal(areStepsValid(steps), true);
});

test("legacy mousepress aliases and text are preserved when opening behaviors", () => {
  assert.deepEqual(parseSteps("pressalt(rctrl LButton);send(a;b);press(x)"), [
    { type: "mousepress", key: "rctrl LButton" }, { type: "send", text: "a;b" }, { type: "press", key: "x" },
  ]);
});

test("mousepress retains its click type and distinguishes double clicks in summaries", () => {
  for (const doubleClick of [undefined, false, true]) {
    const step = { type: "mousepress", key: "rctrl shift LButton", ...(doubleClick === undefined ? {} : { doubleClick }) };
    const source = stepsToString([step]);
    assert.deepEqual(parseSteps(source), [step]);
    assert.equal(areStepsValid(parseSteps(source)), true);
    assert.equal(describeBehavior(source, id => id, id => id), `mousepress(rctrl shift LButton${doubleClick ? ", double" : ""})`);
  }
  for (const doubleClick of ["true", 2, null]) {
    assert.equal(areStepsValid(parseSteps(JSON.stringify([{ type: "mousepress", key: "LButton", doubleClick }]))), false);
  }
});

test("unknown commands remain visible and cannot silently disappear on save", () => {
  const steps = parseSteps("press(x);future(1)");
  assert.deepEqual(steps[1], { type: "unknown", source: "future(1)" });
  assert.equal(areStepsValid(steps), false);
});

test("Press and Mouse press preserve activation choices and require a hotkey for On release", () => {
  for (const type of ["press", "mousepress"]) {
    for (const onRelease of [undefined, false, true]) {
      const step = { type, key: type === "press" ? "rctrl x" : "rctrl LButton", ...(onRelease === undefined ? {} : { onRelease }) };
      const source = stepsToString([step]);
      assert.deepEqual(parseSteps(source), [step]);
      assert.equal(areStepsValid([step]), true);
      assert.equal(areStepsValid([step], [], false), onRelease !== true);
      assert.equal(describeBehavior(source, id => id, id => id).includes("on release"), onRelease === true);
    }
    for (const onRelease of ["true", 1, null]) {
      assert.equal(areStepsValid(parseSteps(JSON.stringify([{ type, key: type === "press" ? "x" : "LButton", onRelease }]))), false);
    }
  }
});

test("invalid nested actions and timing parameters prevent saving", () => {
  for (const steps of [
    [{ type: "parallel", steps: [] }], [{ type: "hold", key: "" }],
    [{ type: "mousepress", key: "a LButton" }], [{ type: "mousepress", key: "ctrl a" }],
    [{ type: "repeat", key: "a", interval: "0", hold: "6" }],
    [{ type: "sequence", steps: [{ type: "sleep", ms: "-1" }] }],
  ]) assert.equal(areStepsValid(steps), false);
  assert.equal(areStepsValid([{ type: "mousepress", key: "rctrl shift XButton2" }]), true);
});

test("Toggle keys round-trips through shared definitions and retains the caller's trigger requirement", async () => {
  const { expandBehavior } = await import("../src/behaviors.ts");
  const { exportVariables, importVariables, validateVariableBehaviors } = await import("../src/variables.ts");
  const values = [{ id: "movement", name: "Movement", type: "keys", value: "rctrl w LButton" },
    { id: "walk", name: "Walk", type: "behavior", value: stepsToString([{ type: "toggle", key: { variable: "movement" } }]) }];
  const source = stepsToString([{ type: "behavior", variableId: "walk" }]);
  const profile = { hotkeys: [{ trigger: "f1", behavior: source }], events: [] };
  const imported = importVariables([profile], exportVariables([profile], values), []);
  assert.equal(validateVariableBehaviors(imported.variables), true);
  const steps = parseSteps(expandBehavior(imported.profiles[0].hotkeys[0].behavior, imported.variables));
  assert.equal(areStepsValid(steps, imported.variables), true);
  assert.equal(areStepsValid(steps, imported.variables, false), false);
  assert.match(describeBehavior(values[1].value, id => id, id => id, id => values.find(value => value.id === id).name), /toggle\(Movement\)/);
});

test("reference remapping reaches nested groups without modifying text", () => {
  const source = stepsToString([{ type: "parallel", steps: [{ type: "state", stateId: "buff" }, { type: "send", text: "state(buff)" }] }]);
  const result = mapBehavior(source, step => step.type === "state" ? { ...step, stateId: "new" } : step);
  assert.equal(parseSteps(result)[0].steps[0].stateId, "new");
  assert.equal(parseSteps(result)[0].steps[1].text, "state(buff)");
});
