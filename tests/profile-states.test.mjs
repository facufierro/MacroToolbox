import { parseSteps } from "../src/behaviors.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { carryReferencedStates, mapStateActions, removeProfileState, withReferencedStates } from "../src/profileStates.ts";

const buff = { id: "buff", name: "Buff active", duration_ms: 10000 };
const other = { id: "other", name: "Other", duration_ms: null };
function profile(id, overrides = {}) {
  return { id, name: id, kind: "overlay", armed: true, parent_id: null, states: [], hotkeys: [], events: [], overlay_items: [], overlay_groups: [], overlay_triggers: [], scripts: [], toggle_hotkeys_key: null, toggle_overlay_key: null, ...overrides };
}
const timer = { type: "timer", id: "timer", name: "timer", x: 0, y: 0, state_id: "buff", timer_state_id: "buff", duration_ms: 1000, color: "#fff", font_size: 22 };
const scope = profiles => ({ id: "game", name: "Game", exe: "game.exe", image: null, states: [...new Map(profiles.flatMap(profile => profile.states).map(state => [state.id, state])).values()], profiles });

test("portable profiles include only owned or referenced state definitions", () => {
  const consumer = profile("hotkeys", {
    states: [other],
    hotkeys: [{ trigger: "f1", behavior: "state(buff);press(1)", state_id: null }],
    events: [{ event: "focus_gained", behavior: "state(event-state)" }],
    overlay_items: [timer],
  });
  const eventState = { id: "event-state", name: "Event", duration_ms: null };
  const unused = { id: "unused", name: "Unused", duration_ms: null };
  const exported = withReferencedStates(consumer, [other, buff, eventState, unused]);
  assert.deepEqual(exported.states, [other, buff, eventState]);
  assert.deepEqual(consumer.states, [other]);
});

test("copies carry missing state definitions across folders and reuse definitions already available", () => {
  const copied = profile("overlay", { overlay_items: [timer] });
  assert.deepEqual(carryReferencedStates(copied, [buff, other], []).states, [buff]);
  assert.deepEqual(carryReferencedStates(copied, [buff, other], [buff]).states, []);
  assert.deepEqual(carryReferencedStates({ ...copied, states: [buff] }, [buff], []).states, [buff]);
});

test("state actions are remapped on import without rewriting other commands", () => {
  const behavior = "press(1);state(buff);send(hello); state(other) ;state(buff)";
  assert.deepEqual(parseSteps(mapStateActions(behavior, id => `new-${id}`)), parseSteps("press(1);state(new-buff);send(hello);state(new-other);state(new-buff)"));
  assert.equal(mapStateActions(behavior, id => id), behavior);
});

test("deleting the owning state clears references in hotkeys, events, and all overlay types", () => {
  const owner = profile("overlay", { states: [buff, other], overlay_items: [timer, { ...timer, id: "other-timer", state_id: "other", timer_state_id: "other" }] });
  const consumer = profile("hotkeys", {
    hotkeys: [{ trigger: "f1", behavior: "press(1);state(buff);state(other)", state_id: "buff" }],
    events: [{ event: "focus_gained", behavior: "state(buff);send(hello)" }],
    overlay_items: [{ type: "text", id: "label", state_id: "buff", content: "Buff" }],
  });
  const updated = removeProfileState(scope([owner, consumer]), owner.id, buff.id);
  assert.deepEqual(updated.profiles[0].states, [other]);
  assert.equal(updated.profiles[0].overlay_items[0].state_id, null);
  assert.equal(updated.profiles[0].overlay_items[0].timer_state_id, null);
  assert.deepEqual(updated.profiles[0].overlay_items[1], owner.overlay_items[1]);
  assert.deepEqual(parseSteps(updated.profiles[1].hotkeys[0].behavior), parseSteps("press(1);state(other)"));
  assert.equal(updated.profiles[1].hotkeys[0].state_id, null);
  assert.deepEqual(parseSteps(updated.profiles[1].events[0].behavior), parseSteps("send(hello)"));
  assert.equal(updated.profiles[1].overlay_items[0].state_id, null);
  assert.deepEqual(owner.states, [buff, other]);
});

test("deleting a shared state removes legacy copies and every reference", () => {
  const base = profile("base", { states: [buff], overlay_items: [timer] });
  const child = profile("child", { states: [{ ...buff, duration_ms: 5000 }] });
  const updated = removeProfileState(scope([base, child]), child.id, buff.id);
  assert.deepEqual(updated.profiles[1].states, []);
  assert.equal(updated.profiles[0].overlay_items[0].state_id, null);
  assert.deepEqual(updated.states, []);
});
