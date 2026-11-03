import assert from "node:assert/strict";
import test from "node:test";
import { areStepsValid, describeBehavior, parseSteps, stepsToString } from "../src/behaviors.ts";
import { mapOverlayActions, removeOverlayGroup, withReferencedOverlayParts } from "../src/overlayItems.ts";

test("Start and Stop retain every selected target through save and summaries", () => {
  const steps = [{ type: "startoverlay", itemIds: ["a", "b"], restart: true }, { type: "stopoverlay", itemIds: ["b", "a"] }];
  const source = stepsToString(steps);
  assert.deepEqual(parseSteps(source), steps);
  assert.equal(areStepsValid(steps, [], false), true);
  assert.equal(describeBehavior(source, id => id, id => `Overlay ${id}`), "restartoverlay(Overlay a, Overlay b); stopoverlay(Overlay b, Overlay a)");
  assert.deepEqual(parseSteps('[{"type":"sequence","steps":[{"type":"startoverlay","itemId":"a","restart":true},{"type":"stopoverlay","itemId":"b"}]}]'),
    [{ type: "sequence", steps: [{ type: "startoverlay", itemIds: ["a"], restart: true }, { type: "stopoverlay", itemIds: ["b"] }] }]);
});

test("invalid or ambiguous overlay selections cannot silently lose targets", () => {
  for (const itemIds of [[], [""], ["a", "a"], ["a", " "]]) {
    assert.equal(areStepsValid([{ type: "stopoverlay", itemIds }]), false);
  }
  for (const extra of [{ itemIds: ["a", 2] }, { itemIds: ["a"], itemId: "b" }, { itemIds: ["a"], future: true }]) {
    const steps = parseSteps(JSON.stringify([{ type: "startoverlay", ...extra }]));
    assert.equal(steps[0].type, "unknown");
    assert.equal(areStepsValid(steps), false);
  }
});

test("remapping and deleting one overlay preserve the remaining selected overlays", () => {
  const source = stepsToString([{ type: "sequence", steps: [{ type: "startoverlay", itemIds: ["a", "b"], restart: true },
    { type: "stopoverlay", itemIds: ["b", "a"] }] }]);
  assert.deepEqual(parseSteps(mapOverlayActions(source, id => `copy-${id}`))[0].steps.map(step => step.itemIds), [["copy-a", "copy-b"], ["copy-b", "copy-a"]]);
  const profile = { id: "p", overlay_groups: [{ id: "a" }, { id: "b" }], overlay_items: [], hotkeys: [{ behavior: source }], events: [] };
  const scope = removeOverlayGroup({ profiles: [profile] }, "p", "a");
  const remaining = parseSteps(scope.profiles[0].hotkeys[0].behavior)[0].steps;
  assert.deepEqual(remaining, [{ type: "startoverlay", itemIds: ["b"], restart: true }, { type: "stopoverlay", itemIds: ["b"] }]);
  assert.equal(removeOverlayGroup(scope, "p", "b").profiles[0].hotkeys[0].behavior, "");
});

test("portable behaviors carry all selected overlays including shared nested actions", () => {
  const groups = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "unrelated", name: "Unrelated" }];
  const items = groups.map(group => ({ id: `${group.id}-timer`, name: "Timer", group_id: group.id, type: "timer" }));
  const variable = { id: "shared", type: "behavior", name: "Shared", value: stepsToString([{ type: "parallel", steps: [
    { type: "startoverlay", itemIds: ["a", "b"], restart: false }, { type: "stopoverlay", itemIds: ["a"] }] }]) };
  const profile = { id: "p", overlay_groups: [], overlay_items: [], hotkeys: [{ behavior: stepsToString([{ type: "behavior", variableId: "shared" }]) }], events: [] };
  const portable = withReferencedOverlayParts(profile, [{ ...profile, id: "source", overlay_groups: groups, overlay_items: items }], [variable]);
  assert.deepEqual(new Set(portable.overlay_groups.map(group => group.id)), new Set(["a", "b"]));
  assert.deepEqual(new Set(portable.overlay_items.map(item => item.id)), new Set(["a-timer", "b-timer"]));
});
