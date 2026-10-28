import { parseSteps } from "../src/behaviors.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { availableOverlayItems, availableOverlayTargets, resolveOverlayGroups, saveOverlayGroup, removeOverlayGroup, moveOverlayPart, remapOverlayReferences, withReferencedOverlayParts, carryReferencedOverlayParts, mapOverlayActions, removeOverlayItem } from "../src/overlayItems.ts";

const timer = { type: "timer", id: "timer", name: "Timer", x: 0, y: 0, duration_ms: 10000, color: "#fff", font_size: 22, state_id: null, timer_state_id: null, start_with_overlay: true };
const profile = (id, overrides = {}) => ({ id, name: id, kind: "overlay", parent_id: null, states: [], hotkeys: [], events: [], overlay_items: [], overlay_groups: [], ...overrides });

test("behavior choices include same-folder overlay items and respect inherited overrides", () => {
  const overridden = { ...timer, duration_ms: 5000 };
  const profiles = [profile("base", { overlay_items: [timer] }), profile("hotkeys", { kind: "hotkeys", overlay_items: [{ ...timer, id: "unused" }] })];
  assert.deepEqual(availableOverlayItems(profiles, [overridden]), [overridden, profiles[1].overlay_items[0]]);
  assert.equal(profiles[0].overlay_items[0].duration_ms, 10000);
  assert.deepEqual(availableOverlayItems([], []), []);
});

const group = { id: "group", name: "Buff", x: 20, y: 30, layout: "row", gap: 8, visible_while_timer_id: "timer" };
const icon = { id: "icon", type: "icon", name: "Icon", group_id: "group", visible_while_timer_id: "timer" };

test("a group combines existing parts without changing their identities or timer links", () => {
  const source = profile("all", { overlay_items: [timer, { ...icon, group_id: null }] });
  const result = saveOverlayGroup(source, group, ["timer", "icon"]);
  assert.deepEqual(result.overlay_items.map(item => [item.id, item.group_id]), [["timer", "group"], ["icon", "group"]]);
  assert.equal(source.overlay_items[0].group_id, undefined);
  assert.throws(() => saveOverlayGroup(source, group, ["missing"]), /unavailable/);
  const removed = saveOverlayGroup(result, group, ["timer"]);
  assert.equal(removed.overlay_items[1].group_id, null);
});

test("deleting an overlay removes its parts and actions without leaving standalone items", () => {
  const owner = profile("all", { overlay_groups: [group], overlay_items: [{ ...timer, group_id: "group" }, icon], hotkeys: [{ behavior: "startoverlay(group);press(a)" }] });
  const consumer = profile("keys", { hotkeys: [{ behavior: "restartoverlay(timer);startoverlay(icon);press(b)" }] });
  const result = removeOverlayGroup({ profiles: [owner, consumer] }, "all", "group");
  assert.deepEqual(result.profiles[0].overlay_items, []);
  assert.deepEqual(result.profiles[0].overlay_groups, []);
  assert.deepEqual(parseSteps(result.profiles[0].hotkeys[0].behavior), parseSteps("press(a)"));
  assert.deepEqual(parseSteps(result.profiles[1].hotkeys[0].behavior), parseSteps("press(b)"));
  assert.equal(owner.overlay_items.length, 2);
});

test("deleting a local overlay preserves references to parts still defined elsewhere", () => {
  const base = profile("base", { overlay_groups: [group], overlay_items: [{ ...timer, group_id: "group" }] });
  const child = profile("child", { parent_id: "base", overlay_groups: [group], overlay_items: [{ ...timer, group_id: "group" }], hotkeys: [{ behavior: "restartoverlay(timer);startoverlay(group)" }] });
  const result = removeOverlayGroup({ profiles: [base, child] }, "child", "group");
  assert.equal(result.profiles[0], base);
  assert.equal(result.profiles[1].hotkeys[0].behavior, child.hotkeys[0].behavior);
});

test("deleting a timer clears its direct visibility relationships", () => {
  const owner = profile("all", { overlay_groups: [group], overlay_items: [timer, icon] });
  const result = removeOverlayItem({ profiles: [owner] }, "all", "timer").profiles[0];
  assert.equal(result.overlay_items[0].visible_while_timer_id, null);
  assert.equal(result.overlay_groups[0].visible_while_timer_id, null);
});

test("part ordering changes within its group while leaving other parts in place", () => {
  const unrelated = { ...timer, id: "other" };
  const owner = profile("all", { overlay_items: [{ ...timer, group_id: "group" }, unrelated, icon] });
  const result = moveOverlayPart(owner, "icon", -1);
  assert.deepEqual(result.overlay_items.map(item => item.id), ["icon", "other", "timer"]);
  assert.equal(moveOverlayPart(result, "icon", -1), result);
  assert.deepEqual(owner.overlay_items.map(item => item.id), ["timer", "other", "icon"]);
});

test("group inheritance and action choices retain local overrides in every profile category", () => {
  const base = profile("base", { overlay_groups: [group], overlay_items: [timer] });
  const override = { ...group, name: "Local", layout: "column" };
  const child = profile("child", { kind: "hotkeys", parent_id: "base", overlay_groups: [override] });
  assert.deepEqual(resolveOverlayGroups([base, child], child), [override]);
  assert.equal(availableOverlayTargets([base, child], [], [override])[0].name, "Local");
  base.parent_id = "child";
  assert.deepEqual(resolveOverlayGroups([base, child], child), [override]);
});

test("export and copying carry group and timer dependencies without unrelated parts", () => {
  const source = profile("source", { overlay_groups: [group], overlay_items: [{ ...timer, group_id: "group" }, icon, { ...timer, id: "unrelated" }] });
  const consumer = profile("consumer", { hotkeys: [{ behavior: "restartoverlay(group)" }] });
  const portable = withReferencedOverlayParts(consumer, [source]);
  assert.deepEqual(new Set(portable.overlay_items.map(item => item.id)), new Set(["timer", "icon"]));
  assert.equal(portable.overlay_groups[0], group);
  const copied = carryReferencedOverlayParts(consumer, [source], [source]);
  assert.deepEqual(copied.overlay_items, []);
  assert.deepEqual(copied.overlay_groups, []);
  const single = withReferencedOverlayParts(profile("single", { overlay_items: [{ ...icon, id: "copy" }] }), [source]);
  assert.deepEqual(new Set(single.overlay_items.map(item => item.id)), new Set(["copy", "timer"]));
});

test("import remaps group actions, membership, and timer visibility together", () => {
  const source = profile("source", { overlay_groups: [group], overlay_items: [timer, icon], hotkeys: [{ behavior: "restartoverlay(group)" }] });
  const result = remapOverlayReferences(source, id => `new-${id}`);
  assert.equal(result.overlay_groups[0].id, "new-group");
  assert.equal(result.overlay_groups[0].visible_while_timer_id, "new-timer");
  assert.equal(result.overlay_items[1].group_id, "new-group");
  assert.equal(result.overlay_items[1].visible_while_timer_id, "new-timer");
  assert.equal(parseSteps(result.hotkeys[0].behavior)[0].itemId, "new-group");
});

test("folder import remaps overlay start targets while preserving other actions", () => {
  const source = "state(buff);startoverlay(timer);restartoverlay(timer);sleep(100); startoverlay(icon) ";
  assert.deepEqual(parseSteps(mapOverlayActions(source, id => `imported-${id}`)), parseSteps("state(buff);startoverlay(imported-timer);restartoverlay(imported-timer);sleep(100);startoverlay(imported-icon)"));
  assert.equal(mapOverlayActions(source, id => id), source);
});

test("deleting an overlay item clears its hotkey and event start actions across the folder", () => {
  const owner = profile("overlay", { overlay_items: [timer] });
  const consumer = profile("hotkeys", {
    kind: "hotkeys",
    hotkeys: [{ trigger: "f1", behavior: "press(1);restartoverlay(timer);state(buff)" }],
    events: [{ event: "focus_gained", behavior: "startoverlay(timer);restartoverlay(timer);startoverlay(other)" }],
  });
  const updated = removeOverlayItem({ id: "folder", profiles: [owner, consumer] }, owner.id, timer.id);
  assert.deepEqual(updated.profiles[0].overlay_items, []);
  assert.deepEqual(parseSteps(updated.profiles[1].hotkeys[0].behavior), parseSteps("press(1);state(buff)"));
  assert.deepEqual(parseSteps(updated.profiles[1].events[0].behavior), parseSteps("startoverlay(other)"));
  assert.equal(owner.overlay_items[0], timer);
});

test("deleting a local override retains start actions for the inherited item", () => {
  const owner = profile("base", { overlay_items: [timer] });
  const child = profile("child", { parent_id: owner.id, overlay_items: [{ ...timer, duration_ms: 5000 }], hotkeys: [{ behavior: "startoverlay(timer)" }] });
  const updated = removeOverlayItem({ id: "folder", profiles: [owner, child] }, child.id, timer.id);
  assert.deepEqual(parseSteps(updated.profiles[1].hotkeys[0].behavior), parseSteps("startoverlay(timer)"));
});
