import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_RUNTIME, getTimerRemaining, isItemVisible, acceptSnapshot } from "../src/overlayRuntime.ts";

const timer = { type: "timer", id: "timer", name: "Timer", x: 0, y: 0, state_id: null, timer_state_id: null, duration_ms: 1000, show_only_running: true };
const config = items => ({ profile_id: "folder", items, states: [{ id: "buff", name: "Buff", duration_ms: 5000 }], hotkeys: [] });

test("a delayed initial response cannot overwrite a newer runtime event", () => {
  const current = { config: config([timer]), runtime: EMPTY_RUNTIME, revision: 10 };
  assert.equal(acceptSnapshot(current, { ...current, revision: 9 }), current);
});

test("the overlay renders backend deadlines without restarting them", () => {
  const cfg = config([timer]);
  const snapshot = { ...EMPTY_RUNTIME, itemTimers: { timer: 1200 } };
  assert.equal(getTimerRemaining(cfg, timer, snapshot, 200), 1000);
  assert.equal(getTimerRemaining(cfg, timer, snapshot, 700), 500);
  assert.equal(getTimerRemaining(cfg, timer, snapshot, 1400), 0);
  assert.equal(isItemVisible(cfg, timer, snapshot, 700), true);
  assert.equal(isItemVisible(cfg, timer, snapshot, 1400), false);
  assert.equal(snapshot.itemTimers.timer, 1200);
});

test("linked timers use the one shared state deadline", () => {
  const linked = { ...timer, timer_state_id: "buff" };
  const cfg = config([linked]);
  const snapshot = { ...EMPTY_RUNTIME, timers: { buff: 5200 }, itemTimers: { timer: 999 } };
  assert.equal(getTimerRemaining(cfg, linked, snapshot, 200), 5000);
  assert.equal(getTimerRemaining(cfg, linked, snapshot, 4000), 1200);
});

test("visibility respects both shared state and explicit item stopping", () => {
  const icon = { type: "icon", id: "icon", state_id: "buff" };
  const cfg = config([icon]);
  assert.equal(isItemVisible(cfg, icon, EMPTY_RUNTIME, 100), false);
  const running = { ...EMPTY_RUNTIME, timers: { buff: 200 } };
  assert.equal(isItemVisible(cfg, icon, running, 100), true);
  assert.equal(isItemVisible(cfg, icon, running, 201), false);
  assert.equal(isItemVisible(cfg, icon, { ...running, hiddenItems: { icon: true } }, 100), false);
});

test("idle and expired always-visible timers retain their display behavior", () => {
  const always = { ...timer, show_only_running: false };
  const cfg = config([always]);
  assert.equal(isItemVisible(cfg, always, EMPTY_RUNTIME, 100), true);
  assert.equal(getTimerRemaining(cfg, always, EMPTY_RUNTIME, 100), 1000);
  assert.equal(getTimerRemaining(cfg, always, { ...EMPTY_RUNTIME, itemTimers: { timer: 50 } }, 100), 0);
});

test("an icon can follow a timer directly without a shared state", () => {
  const icon = { type: "icon", id: "icon", visible_while_timer_id: "timer" };
  const cfg = config([timer, icon]);
  assert.equal(isItemVisible(cfg, icon, EMPTY_RUNTIME, 100), false);
  const running = { ...EMPTY_RUNTIME, itemTimers: { timer: 1200 } };
  assert.equal(isItemVisible(cfg, icon, running, 700), true);
  assert.equal(isItemVisible(cfg, icon, running, 1200), false);
  assert.equal(isItemVisible(cfg, icon, { ...running, hiddenItems: { timer: true } }, 700), false);
  assert.equal(isItemVisible(config([icon]), icon, running, 700), false);
});

test("group visibility follows its timer for every part and respects dismissal", () => {
  const icon = { type: "icon", id: "icon", group_id: "group" };
  const groupedTimer = { ...timer, group_id: "group" };
  const cfg = { ...config([groupedTimer, icon]), groups: [{ id: "group", visible_while_timer_id: "timer" }] };
  const running = { ...EMPTY_RUNTIME, itemTimers: { timer: 1200 } };
  for (const item of cfg.items) {
    assert.equal(isItemVisible(cfg, item, EMPTY_RUNTIME, 100), false);
    assert.equal(isItemVisible(cfg, item, running, 700), true);
    assert.equal(isItemVisible(cfg, item, running, 1200), false);
    assert.equal(isItemVisible(cfg, item, { ...running, hiddenItems: { group: true } }, 700), false);
  }
});

test("direct timer visibility uses a linked state's deadline and preserves legacy conditions", () => {
  const linked = { ...timer, timer_state_id: "buff" };
  const icon = { type: "icon", id: "icon", visible_while_timer_id: "timer", state_id: "other" };
  const cfg = config([linked, icon]);
  const running = { ...EMPTY_RUNTIME, timers: { buff: 5000 }, flags: { other: true } };
  assert.equal(isItemVisible(cfg, icon, running, 4000), true);
  assert.equal(isItemVisible(cfg, icon, { ...running, flags: {} }, 4000), false);
  assert.equal(isItemVisible(cfg, icon, running, 5000), false);
});

test("disabled groups and parts stay hidden without mutating other timers", () => {
  const icon = { type: "icon", id: "icon", group_id: "group" };
  const grouped = { ...timer, group_id: "group" };
  const cfg = { ...config([grouped, icon]), groups: [{ id: "group" }], disabled_items: ["group", "timer", "icon"] };
  const running = { ...EMPTY_RUNTIME, itemTimers: { timer: 1200 } };
  assert.equal(isItemVisible(cfg, icon, running, 100), false);
  assert.equal(isItemVisible(cfg, grouped, running, 100), false);
  assert.equal(running.itemTimers.timer, 1200);
  assert.equal(isItemVisible({ ...cfg, disabled_items: [] }, icon, running, 100), true);
});

test("disabling shared states suppresses linked displays and leaves independent timers running", () => {
  const linked = { ...timer, id: "linked", timer_state_id: "buff" };
  const icon = { type: "icon", id: "icon", state_id: "buff" };
  const cfg = { ...config([timer, linked, icon]), states_disabled: true };
  const running = { ...EMPTY_RUNTIME, timers: { buff: 5000 }, flags: { buff: true }, itemTimers: { timer: 1200 } };
  assert.equal(isItemVisible(cfg, icon, running, 100), false);
  assert.equal(isItemVisible(cfg, linked, running, 100), false);
  assert.equal(isItemVisible(cfg, timer, running, 100), true);
});
