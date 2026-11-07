import assert from "node:assert/strict";
import test from "node:test";
import { areStepsValid, describeBehavior, parseSteps, stepsToString } from "../src/behaviors.ts";
import { mapOverlayActions, removeOverlayGroup, withReferencedOverlayParts, updateBehaviorOverlay, resolveOverlayItems, findOverlayOwner } from "../src/overlayItems.ts";

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

test("editing a behavior's group preserves the latest profile, unrelated parts, identities, and inherited slots", () => {
  const group = { id: "group", name: "Buff", layout: "row", disabled: true };
  const timer = { id: "timer", type: "timer", group_id: group.id, duration_ms: 60000, timer_state_id: "state", show_background: false };
  const icon = { id: "icon", type: "icon", group_id: group.id, src: "data:image/png;base64,picture", visible_while_timer_id: timer.id };
  const unrelated = { id: "other", type: "text", group_id: "other-group", content: "HP" };
  const profile = { id: "p", name: "Latest name", parent_id: null, hotkeys: [{ behavior: "startoverlay(group)" }], events: [],
    overlay_groups: [group, { id: "other-group", name: "Resources" }], overlay_items: [timer, unrelated, icon] };
  const scope = { profiles: [profile] }, before = structuredClone(scope);
  const changed = updateBehaviorOverlay(scope, "p", { ...group, name: "Protection" }, [icon, { ...timer, duration_ms: 45000 }]);
  assert.deepEqual(changed.profiles[0].overlay_items.map(item => item.id), ["icon", "other", "timer"]);
  assert.equal(changed.profiles[0].name, "Latest name");
  assert.deepEqual(changed.profiles[0].hotkeys, profile.hotkeys);
  assert.deepEqual(changed.profiles[0].overlay_items[0], icon);
  assert.deepEqual(changed.profiles[0].overlay_items[1], unrelated);
  assert.deepEqual(changed.profiles[0].overlay_items[2], { ...timer, duration_ms: 45000 });
  assert.equal(changed.profiles[0].overlay_groups[0].disabled, true);
  assert.deepEqual(scope, before);
  const child = { ...profile, id: "child", parent_id: "p", overlay_items: [{ ...timer, duration_ms: 10000 }] };
  assert.deepEqual(resolveOverlayItems([profile, child], child).map(({ item, own }) => [item.id, own]), [["timer", true], ["other", false], ["icon", false]]);
  assert.throws(() => updateBehaviorOverlay(scope, "missing", group, []), /Profile not found/);
  assert.throws(() => updateBehaviorOverlay(scope, "p", group, [unrelated]), /another group/);
});

test("removing a part inside a behavior clears dependent visibility and actions while keeping the group", () => {
  const group = { id: "group", name: "Buff", visible_while_timer_id: "timer" };
  const timer = { id: "timer", type: "timer", group_id: group.id };
  const icon = { id: "icon", type: "icon", group_id: group.id, visible_while_timer_id: timer.id };
  const profile = { id: "p", hotkeys: [{ behavior: "startoverlay(timer);startoverlay(group)" }], events: [], overlay_groups: [group], overlay_items: [timer, icon] };
  const changed = updateBehaviorOverlay({ profiles: [profile] }, "p", group, [icon]);
  assert.equal(changed.profiles[0].overlay_groups[0].visible_while_timer_id, null);
  assert.equal(changed.profiles[0].overlay_items[0].visible_while_timer_id, null);
  assert.deepEqual(parseSteps(changed.profiles[0].hotkeys[0].behavior), [{ type: "startoverlay", itemIds: ["group"], restart: false }]);
});

test("inline group editing finds the selected profile's actual owner before sibling overrides", () => {
  const parent = { id: "parent", overlay_groups: [{ id: "group", name: "Parent" }] };
  const sibling = { id: "sibling", parent_id: "parent", overlay_groups: [{ id: "group", name: "Sibling override" }] };
  const child = { id: "child", parent_id: "parent", overlay_groups: [] };
  const profiles = [sibling, child, parent];
  assert.equal(findOverlayOwner(profiles, "group", "child"), parent);
  assert.equal(findOverlayOwner(profiles, "group", "sibling"), sibling);
  assert.equal(findOverlayOwner(profiles, "group"), sibling);
  assert.equal(findOverlayOwner(profiles, "missing", "child"), undefined);
});
