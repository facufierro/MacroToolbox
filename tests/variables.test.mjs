import assert from "node:assert/strict";
import test from "node:test";
import { areStepsValid, describeBehavior, mapBehavior, mapStepNumbers, parseSteps, resolveNumber, stepsToString } from "../src/behaviors.ts";
import { exportVariables, importVariables, profileVariableIds } from "../src/variables.ts";

const buff = { id: "buff", name: "buff timer", value: 5000 };
const pause = { id: "pause", name: "sleep timer", value: 50 };
const profile = (behavior, id = "profile") => ({ id, hotkeys: [{ behavior }], events: [] });

test("all numeric behavior parameters accept shared variables in nested groups", () => {
  const steps = [{ type: "parallel", steps: [
    { type: "sleep", ms: "$buff" },
    { type: "sequence", steps: [
      { type: "repeat", key: "x", interval: "$buff", hold: "$pause" },
      { type: "goto", x: "$pause", y: "12.5" },
      { type: "resolution", width: "$buff", height: "1080" },
      { type: "bar", itemId: "bar", value: "$pause" },
      { type: "send", text: "$buff" },
    ] },
  ] }];
  assert.equal(areStepsValid(steps, [buff, pause]), true);
  const source = stepsToString(steps);
  const resolved = mapBehavior(source, step => mapStepNumbers(step, value => resolveNumber(value, [buff, pause])));
  assert.equal(parseSteps(resolved)[0].steps[0].ms, "5000");
  assert.equal(parseSteps(resolved)[0].steps[1].steps[4].text, "$buff");
  assert.deepEqual([...profileVariableIds([profile(source)])].sort(), ["buff", "pause"]);
  assert.equal(source, stepsToString(steps));
});

test("variable values obey the numeric field's existing boundaries", () => {
  for (const [value, sleep, repeat] of [[0, true, false], [-0, true, false], [1, true, true],
    [0xffffffff, true, true], [0x100000000, false, false], [-1, false, false], [1.5, false, false], [Infinity, false, false]]) {
    const variables = [{ ...buff, value }];
    assert.equal(areStepsValid([{ type: "sleep", ms: "$buff" }], variables), sleep, String(value));
    assert.equal(areStepsValid([{ type: "repeat", key: "x", interval: "$buff", hold: "6" }], variables), repeat, String(value));
  }
  assert.equal(areStepsValid([{ type: "sleep", ms: "$missing" }], [buff]), false);
  assert.equal(areStepsValid([{ type: "goto", x: "$buff", y: "0" }], [{ ...buff, value: -12.5 }]), true);
});

test("renames preserve references and summaries show the current name", () => {
  const source = stepsToString([{ type: "sleep", ms: "$buff" }]);
  const renamed = { ...buff, name: "new timer", value: 6000 };
  assert.equal(resolveNumber("$buff", [renamed]), "6000");
  assert.equal(describeBehavior(source, id => id, id => id, id => [renamed].find(variable => variable.id === id).name), "sleep(new timer)");
  assert.equal(parseSteps(source)[0].ms, "$buff");
});

test("profile and folder exports preserve variables shared by hotkeys and events", () => {
  const profiles = [profile("sleep($buff)"), { ...profile("sleep($buff)", "other"), events: [{ behavior: "sleep($pause)" }] }];
  const portable = JSON.parse(JSON.stringify({ profiles, variables: exportVariables(profiles, [buff, pause, { id: "unused", name: "unused", value: 1 }]) }));
  assert.deepEqual(portable.variables, [buff, pause]);
  const imported = importVariables(portable.profiles, portable.variables, []);
  assert.equal(imported.variables.length, 2);
  assert.equal(parseSteps(imported.profiles[0].hotkeys[0].behavior)[0].ms, `$${imported.variables[0].id}`);
  assert.equal(imported.profiles[0].hotkeys[0].behavior, imported.profiles[1].hotkeys[0].behavior);
  for (const current of imported.profiles) {
    for (const entry of [...current.hotkeys, ...current.events]) assert.equal(areStepsValid(parseSteps(entry.behavior), imported.variables), true);
  }
});

test("imports reuse matching values and isolate conflicts without overwriting local variables", () => {
  const profiles = [profile("sleep($buff)")];
  const reused = importVariables(profiles, [buff], [{ ...buff, id: "local" }]);
  assert.deepEqual(reused.variables, []);
  assert.equal(parseSteps(reused.profiles[0].hotkeys[0].behavior)[0].ms, "$local");
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
  assert.throws(() => exportVariables([profile("sleep($missing)")], []), /Missing number/);
  for (const incoming of [[{ ...buff, value: "50" }], [buff, buff], [{ ...buff, name: " " }]]) {
    assert.throws(() => importVariables([profile("sleep($buff)")], incoming, []), /Invalid imported/);
  }
});
