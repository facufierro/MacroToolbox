import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseSteps, stepsToString, areStepsValid, mapBehavior, describeBehavior } from "../src/behaviors.ts";

test("editor and backend share the same behavior compatibility fixtures", () => {
  const fixtures = JSON.parse(readFileSync(new URL("./fixtures/behaviors.json", import.meta.url), "utf8"));
  for (const fixture of fixtures) {
    assert.deepEqual(parseSteps(fixture.source), fixture.steps);
    assert.equal(areStepsValid(parseSteps(fixture.source), fixture.variables ?? []), fixture.valid);
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

test("invalid nested actions and timing parameters prevent saving", () => {
  for (const steps of [
    [{ type: "parallel", steps: [] }], [{ type: "hold", key: "" }],
    [{ type: "mousepress", key: "a LButton" }], [{ type: "mousepress", key: "ctrl a" }],
    [{ type: "repeat", key: "a", interval: "0", hold: "6" }],
    [{ type: "sequence", steps: [{ type: "sleep", ms: "-1" }] }],
  ]) assert.equal(areStepsValid(steps), false);
  assert.equal(areStepsValid([{ type: "mousepress", key: "rctrl shift XButton2" }]), true);
});

test("reference remapping reaches nested groups without modifying text", () => {
  const source = stepsToString([{ type: "parallel", steps: [{ type: "state", stateId: "buff" }, { type: "send", text: "state(buff)" }] }]);
  const result = mapBehavior(source, step => step.type === "state" ? { ...step, stateId: "new" } : step);
  assert.equal(parseSteps(result)[0].steps[0].stateId, "new");
  assert.equal(parseSteps(result)[0].steps[1].text, "state(buff)");
});
