import assert from "node:assert/strict";
import test from "node:test";
import { availableOverlayItems, mapOverlayActions, removeOverlayItem } from "../src/overlayItems.ts";

const timer = { type: "timer", id: "timer", name: "Timer", x: 0, y: 0, duration_ms: 10000, color: "#fff", font_size: 22, state_id: null, timer_state_id: null, start_with_overlay: true };
const profile = (id, overrides = {}) => ({ id, name: id, kind: "overlay", parent_id: null, states: [], hotkeys: [], events: [], overlay_items: [], ...overrides });

test("behavior choices include same-folder overlay items and respect inherited overrides", () => {
  const overridden = { ...timer, duration_ms: 5000 };
  const profiles = [profile("base", { overlay_items: [timer] }), profile("hotkeys", { kind: "hotkeys", overlay_items: [{ ...timer, id: "unused" }] })];
  assert.deepEqual(availableOverlayItems(profiles, [overridden]), [overridden]);
  assert.equal(profiles[0].overlay_items[0].duration_ms, 10000);
  assert.deepEqual(availableOverlayItems([], []), []);
});

test("folder import remaps overlay start targets while preserving other actions", () => {
  const source = "state(buff);startoverlay(timer);sleep(100); startoverlay(icon) ";
  assert.equal(mapOverlayActions(source, id => `imported-${id}`), "state(buff);startoverlay(imported-timer);sleep(100);startoverlay(imported-icon)");
  assert.equal(mapOverlayActions(source, id => id), source);
});

test("deleting an overlay item clears its hotkey and event start actions across the folder", () => {
  const owner = profile("overlay", { overlay_items: [timer] });
  const consumer = profile("hotkeys", {
    kind: "hotkeys",
    hotkeys: [{ trigger: "f1", behavior: "press(1);startoverlay(timer);state(buff)" }],
    events: [{ event: "focus_gained", behavior: "startoverlay(timer);startoverlay(other)" }],
  });
  const updated = removeOverlayItem({ id: "folder", profiles: [owner, consumer] }, owner.id, timer.id);
  assert.deepEqual(updated.profiles[0].overlay_items, []);
  assert.equal(updated.profiles[1].hotkeys[0].behavior, "press(1);state(buff)");
  assert.equal(updated.profiles[1].events[0].behavior, "startoverlay(other)");
  assert.equal(owner.overlay_items[0], timer);
});

test("deleting a local override retains start actions for the inherited item", () => {
  const owner = profile("base", { overlay_items: [timer] });
  const child = profile("child", { parent_id: owner.id, overlay_items: [{ ...timer, duration_ms: 5000 }], hotkeys: [{ behavior: "startoverlay(timer)" }] });
  const updated = removeOverlayItem({ id: "folder", profiles: [owner, child] }, child.id, timer.id);
  assert.equal(updated.profiles[1].hotkeys[0].behavior, "startoverlay(timer)");
});
