import { parseSteps } from "../src/behaviors.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { nameOverlayParts, availableOverlayItems, availableOverlayTargets, resolveOverlayGroups, saveOverlayGroup, duplicateOverlayGroup, removeOverlayGroup, moveOverlayPart, remapOverlayReferences, withReferencedOverlayParts, carryReferencedOverlayParts, mapOverlayActions, removeOverlayItem } from "../src/overlayItems.ts";

const timer = { type: "timer", id: "timer", name: "Timer", x: 0, y: 0, duration_ms: 10000, color: "#fff", font_size: 22, state_id: null, timer_state_id: null, start_with_overlay: true };
const profile = (id, overrides = {}) => ({ id, name: id, kind: "overlay", parent_id: null, states: [], hotkeys: [], events: [], overlay_items: [], overlay_groups: [], ...overrides });

test("behavior choices include same-folder overlay items and respect inherited overrides", () => {
  const overridden = { ...timer, duration_ms: 5000 };
  const profiles = [profile("base", { overlay_items: [timer] }), profile("hotkeys", { kind: "hotkeys", overlay_items: [{ ...timer, id: "unused" }] })];
  assert.deepEqual(availableOverlayItems(profiles, [overridden]), [{ ...overridden, name: "Overlay Timer 0" }, { ...profiles[1].overlay_items[0], name: "Overlay Timer 1" }]);
  assert.equal(profiles[0].overlay_items[0].duration_ms, 10000);
  assert.deepEqual(availableOverlayItems([], []), []);
});

const group = { id: "group", name: "Buff", x: 20, y: 30, layout: "row", gap: 8, visible_while_timer_id: "timer" };
const icon = { id: "icon", type: "icon", name: "Icon", group_id: "group", visible_while_timer_id: "timer" };

test("part names use the overlay label and a zero-based counter for each type", () => {
  const groups = [{ ...group, name: "Magic Protection" }, { ...group, id: "rep", name: "Reputation" }];
  const parts = [
    { ...timer, group_id: group.id, name: "An old custom name" }, icon,
    { ...timer, id: "timer-2", group_id: group.id }, { ...icon, id: "icon-2" },
    { type: "bar", id: "bar", group_id: group.id }, { type: "text", id: "text", group_id: group.id },
    { ...timer, id: "rep-timer", group_id: "rep" },
  ];
  const before = structuredClone(parts);
  const named = nameOverlayParts(parts, groups);
  assert.deepEqual(named.map(item => item.name), ["Magic Protection Timer 0", "Magic Protection Icon 0",
    "Magic Protection Timer 1", "Magic Protection Icon 1", "Magic Protection Bar 0", "Magic Protection Text 0", "Reputation Timer 0"]);
  assert.deepEqual(named.map(item => item.id), parts.map(item => item.id));
  assert.deepEqual(parts, before);
});

test("part labels follow overlay renames, moves, and order without changing timer identities", () => {
  const second = { ...timer, id: "second", group_id: group.id };
  const source = profile("all", { overlay_groups: [group], overlay_items: [{ ...timer, group_id: group.id }, icon, second] });
  const renamed = { ...group, name: "Renamed" };
  const reordered = moveOverlayPart(source, second.id, -1);
  const named = nameOverlayParts(reordered.overlay_items, [renamed]);
  assert.deepEqual(named.map(item => [item.id, item.name]), [["timer", "Renamed Timer 0"], ["second", "Renamed Timer 1"], ["icon", "Renamed Icon 0"]]);
  const swapped = moveOverlayPart(reordered, second.id, -1);
  assert.deepEqual(nameOverlayParts(swapped.overlay_items, [renamed]).slice(0, 2).map(item => [item.id, item.name]),
    [["second", "Renamed Timer 0"], ["timer", "Renamed Timer 1"]]);
  const moved = saveOverlayGroup(source, { ...group, id: "other", name: "Other" }, [second.id]);
  assert.equal(nameOverlayParts(moved.overlay_items, moved.overlay_groups)[2].name, "Other Timer 0");
  assert.equal(nameOverlayParts([{ ...timer, group_id: "missing" }], [group])[0].name, "Overlay Timer 0");
  assert.equal(nameOverlayParts([{ ...timer, group_id: group.id }], [{ ...group, name: "  " }])[0].name, "Overlay Timer 0");
});

test("folder timer choices distinguish unnamed parts and respect the current profile's inherited overlay labels", () => {
  const base = profile("base", { overlay_groups: [group], overlay_items: [{ ...timer, name: "", group_id: group.id }] });
  const reputation = profile("rep", { overlay_groups: [{ ...group, id: "rep-group", name: "Reputation" }],
    overlay_items: [{ ...timer, id: "rep-timer", name: "", group_id: "rep-group" }] });
  const child = profile("child", { parent_id: base.id, overlay_groups: [{ ...group, name: "Magic Protection" }] });
  const groups = resolveOverlayGroups([base, reputation, child], child);
  const targets = availableOverlayTargets([base, reputation, child], base.overlay_items, groups);
  assert.deepEqual(targets.filter(item => item.type === "timer").map(item => [item.id, item.name]),
    [["timer", "Magic Protection Timer 0"], ["rep-timer", "Reputation Timer 0"]]);
  assert.equal(base.overlay_items[0].name, "");
});

test("a group combines existing parts without changing their identities or timer links", () => {
  const source = profile("all", { overlay_items: [timer, { ...icon, group_id: null }] });
  const result = saveOverlayGroup(source, group, ["timer", "icon"]);
  assert.deepEqual(result.overlay_items.map(item => [item.id, item.group_id]), [["timer", "group"], ["icon", "group"]]);
  assert.equal(source.overlay_items[0].group_id, undefined);
  assert.throws(() => saveOverlayGroup(source, group, ["missing"]), /unavailable/);
  const removed = saveOverlayGroup(result, group, ["timer"]);
  assert.equal(removed.overlay_items[1].group_id, null);
});

test("duplicating an overlay copies every part and remaps internal timer links without changing the original", () => {
  const originalGroup = { ...group, disabled: true };
  const parts = [
    { ...timer, group_id: group.id, show_background: false, timer_state_id: "buff" },
    { ...icon, src: "data:image/png;base64,image", w: 32, h: 32 },
    { type: "bar", id: "bar", group_id: group.id, visible_while_timer_id: timer.id, state_id: "buff", w: 80, h: 8, color: "#fff", max_value: 100 },
    { type: "text", id: "text", group_id: group.id, visible_while_timer_id: "external", content: "Buff", font_size: 18, color: "#fff" },
  ];
  const unrelated = { ...timer, id: "unrelated" };
  const source = profile("all", { overlay_groups: [originalGroup], overlay_items: [...parts, unrelated],
    hotkeys: [{ trigger: "e", behavior: "restartoverlay(group)" }], events: [{ event: "focus_gained", behavior: "startoverlay(timer)" }] });
  const before = structuredClone(source);
  let next = 0;
  const result = duplicateOverlayGroup(source, originalGroup, source.overlay_items, () => `copy-${++next}`);
  assert.deepEqual(result.overlay_groups[1], { ...originalGroup, id: "copy-1", name: "Buff (copy)", visible_while_timer_id: "copy-2" });
  const copies = result.overlay_items.slice(source.overlay_items.length);
  assert.deepEqual(copies.map(part => [part.type, part.id, part.group_id]), [
    ["timer", "copy-2", "copy-1"], ["icon", "copy-3", "copy-1"], ["bar", "copy-4", "copy-1"], ["text", "copy-5", "copy-1"],
  ]);
  assert.deepEqual(copies.map(part => part.name), ["Buff (copy) Timer 0", "Buff (copy) Icon 0", "Buff (copy) Bar 0", "Buff (copy) Text 0"]);
  assert.equal(copies[0].show_background, false);
  assert.equal(copies[0].timer_state_id, "buff");
  assert.equal(copies[1].visible_while_timer_id, "copy-2");
  assert.equal(copies[1].src, parts[1].src);
  assert.equal(copies[2].visible_while_timer_id, "copy-2");
  assert.equal(copies[2].state_id, "buff");
  assert.equal(copies[3].visible_while_timer_id, "external");
  assert.equal(result.hotkeys, source.hotkeys);
  assert.equal(result.events, source.events);
  assert.equal(result.overlay_items[4], unrelated);
  assert.deepEqual(source, before);
  copies[0].duration_ms = 3000;
  assert.equal(parts[0].duration_ms, 10000);
});

test("duplicating an inherited overlay materializes its effective parts in the current profile", () => {
  const base = profile("base", { overlay_groups: [group], overlay_items: [{ ...timer, group_id: group.id }, icon] });
  const overriddenTimer = { ...base.overlay_items[0], duration_ms: 5000 };
  const child = profile("child", { parent_id: base.id, overlay_items: [overriddenTimer] });
  const inheritedGroup = resolveOverlayGroups([base, child], child)[0];
  const effectiveParts = [overriddenTimer, icon];
  let next = 0;
  const result = duplicateOverlayGroup(child, inheritedGroup, effectiveParts, () => `copy-${++next}`);
  assert.equal(result.parent_id, base.id);
  assert.deepEqual(result.overlay_groups.map(group => group.id), ["copy-1"]);
  assert.deepEqual(result.overlay_items.map(part => part.id), ["timer", "copy-2", "copy-3"]);
  assert.equal(result.overlay_items[1].duration_ms, 5000);
  assert.equal(result.overlay_items[2].visible_while_timer_id, "copy-2");
  assert.equal(base.overlay_items[0].duration_ms, 10000);
  assert.deepEqual(child.overlay_items, [overriddenTimer]);
});

test("empty and repeated overlay duplicates have distinct IDs and preserve external visibility", () => {
  const unnamed = { ...group, name: "", visible_while_timer_id: "external" };
  const source = profile("all", { overlay_groups: [unnamed] });
  let next = 0;
  const createId = () => `copy-${++next}`;
  const once = duplicateOverlayGroup(source, unnamed, [], createId);
  const twice = duplicateOverlayGroup(once, unnamed, [], createId);
  assert.deepEqual(twice.overlay_groups.map(group => group.id), ["group", "copy-1", "copy-2"]);
  assert.equal(twice.overlay_groups[1].name, "Overlay (copy)");
  assert.equal(twice.overlay_groups[1].visible_while_timer_id, "external");
  assert.deepEqual(twice.overlay_items, []);
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
