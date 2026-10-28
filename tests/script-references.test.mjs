import assert from "node:assert/strict";
import test from "node:test";
import { parseSteps, stepsToString } from "../src/behaviors.ts";
import { mapScriptActions, withReferencedScripts, carryReferencedScripts, removeScriptReferences } from "../src/scriptReferences.ts";

const script = { id: "script", name: "Script", language: "python" };
const behavior = stepsToString([{ type: "parallel", steps: [{ type: "script", scriptId: "script" }, { type: "press", key: "a" }] }]);
const profile = { id: "keys", scripts: [], hotkeys: [{ behavior }], events: [] };

test("portable profiles include referenced script definitions and remap nested calls", () => {
  assert.deepEqual(withReferencedScripts(profile, [script, { ...script, id: "other" }]).scripts, [script]);
  assert.equal(parseSteps(mapScriptActions(behavior, () => "imported"))[0].steps[0].scriptId, "imported");
});
test("copying a behavior carries scripts without duplicating existing definitions", () => {
  assert.deepEqual(carryReferencedScripts(profile, [script], []).scripts, [script]);
  assert.deepEqual(carryReferencedScripts(profile, [script], [script]).scripts, []);
});
test("deleting a script removes nested calls while retaining sibling actions", () => {
  const result = removeScriptReferences({ profiles: [profile] }, "script");
  assert.deepEqual(parseSteps(result.profiles[0].hotkeys[0].behavior)[0].steps, [{ type: "press", key: "a" }]);
});
