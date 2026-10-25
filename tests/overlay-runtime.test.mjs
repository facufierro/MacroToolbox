import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOverlayConfig, applyRuntimeEvent, clearRuntimeState, dismissOverlayItem, EMPTY_RUNTIME, getTimerRemaining, isItemVisible,
  applyOverlaySessionConfig, applyOverlaySessionEvent, dismissOverlaySessionItem, EMPTY_OVERLAY_SESSIONS, getActiveOverlaySession,
} from "../src/overlayRuntime.ts";

function item(id, stateId, type = "text") {
  const base = { id, name: id, x: 25, y: 75, state_id: stateId };
  if (type === "timer") return { ...base, type, duration_ms: 10000, timer_state_id: stateId, color: "#fff", font_size: 22 };
  if (type === "icon") return { ...base, type, src: "icon.png", w: 24, h: 24 };
  return { ...base, type, content: id, color: "#fff", font_size: 16 };
}

function config(duration = null) {
  return {
    items: [item("timer", "buff", "timer"), item("icon", "buff", "icon"), item("label", "buff"), item("other", "other"), item("always", null)],
    states: [{ id: "buff", name: "Buff active", duration_ms: duration }, { id: "other", name: "Other", duration_ms: null }],
    hotkeys: [],
  };
}

const trigger = (cfg, state, stateId, now) => applyRuntimeEvent(cfg, state, { event: "state_triggered", state_id: stateId }, now);
const visibleIds = (cfg, state, now) => cfg.items.filter(item => isItemVisible(item, state, now)).map(item => item.id);

test("one shared state shows and hides its timer, icon, and label together", () => {
  const cfg = config();
  assert.deepEqual(visibleIds(cfg, EMPTY_RUNTIME, 100), ["always"]);
  const active = trigger(cfg, EMPTY_RUNTIME, "buff", 100);
  assert.deepEqual(visibleIds(cfg, active, 100), ["timer", "icon", "label", "always"]);
  const off = trigger(cfg, active, "buff", 200);
  assert.deepEqual(visibleIds(cfg, off, 200), ["always"]);
  assert.deepEqual(EMPTY_RUNTIME, { flags: {}, timers: {}, itemTimers: {}, hiddenItems: {} });
});

test("dismissal clears the shared toggle state and its next trigger restores every linked item", () => {
  const cfg = config();
  const active = trigger(cfg, trigger(cfg, EMPTY_RUNTIME, "other", 90), "buff", 100);
  const dismissed = clearRuntimeState(active, cfg.items[1].state_id, 200);
  assert.deepEqual(visibleIds(cfg, dismissed, 200), ["other", "always"]);
  assert.deepEqual(visibleIds(cfg, trigger(cfg, dismissed, "buff", 300), 300), ["timer", "icon", "label", "other", "always"]);
  assert.equal(active.flags.buff, true);
});

test("dismissal stops a timed state and reactivation starts a fresh shared countdown", () => {
  const cfg = config(10000);
  const active = trigger(cfg, EMPTY_RUNTIME, "buff", 100);
  assert.equal(getTimerRemaining(cfg, cfg.items[0], active, 2100), 8000);
  const dismissed = clearRuntimeState(active, "buff", 2200);
  assert.equal(dismissed.timers.buff, undefined);
  assert.deepEqual(visibleIds(cfg, dismissed, 2200), ["always"]);
  const restarted = trigger(cfg, dismissed, "buff", 5000);
  assert.equal(getTimerRemaining(cfg, cfg.items[0], restarted, 5000), 10000);
  assert.equal(isItemVisible(cfg.items[0], restarted, 14999), true);
  assert.equal(isItemVisible(cfg.items[0], restarted, 15000), false);
});

test("timed triggers restart the deadline and expiry does not reactivate the state", () => {
  const cfg = config(1000);
  const state = trigger(cfg, trigger(cfg, EMPTY_RUNTIME, "buff", 0), "buff", 750);
  assert.equal(state.timers.buff, 1750);
  assert.equal(isItemVisible(cfg.items[0], state, 1749), true);
  assert.equal(isItemVisible(cfg.items[0], state, 1750), false);
  const expired = applyRuntimeEvent(cfg, state, { event: "unknown" }, 2000);
  assert.equal(getTimerRemaining(cfg, cfg.items[0], expired, 2000), 0);
  assert.equal(isItemVisible(cfg.items[0], expired, 2000), false);
});

test("legacy hotkey state bindings use the same transitions and can reactivate dismissed items", () => {
  const cfg = { ...config(), hotkeys: [{ trigger: "F1", state_id: "buff" }] };
  const event = { event: "hotkey_triggered", hotkey_trigger: " f1 " };
  const active = applyRuntimeEvent(cfg, EMPTY_RUNTIME, event, 100);
  const dismissed = clearRuntimeState(active, "buff", 200);
  const restored = applyRuntimeEvent(cfg, dismissed, event, 300);
  assert.equal(isItemVisible(cfg.items[0], restored, 300), true);
});

test("unknown state IDs do nothing and profile changes reset state", () => {
  const cfg = config();
  const active = trigger(cfg, EMPTY_RUNTIME, "buff", 100);
  assert.deepEqual(trigger(cfg, active, "missing", 200), active);
  for (const event of ["profile_activated", "profile_deactivated"]) {
    assert.deepEqual(applyRuntimeEvent(cfg, active, { event }, 200), EMPTY_RUNTIME);
  }
});

test("retired group membership does not control state visibility", () => {
  const cfg = config();
  cfg.items[0].group_id = "old-group";
  cfg.items[3].group_id = "old-group";
  const active = trigger(cfg, trigger(cfg, EMPTY_RUNTIME, "other", 100), "buff", 100);
  const dismissed = clearRuntimeState(active, "buff", 200);
  assert.equal(isItemVisible(cfg.items[3], dismissed, 200), true);
});

const start = (cfg, state, itemId, now) => applyRuntimeEvent(cfg, state, { event: "overlay_started", item_id: itemId }, now);
function standalone(startWithOverlay = false) {
  const timer = { ...item("fixed", null, "timer"), start_with_overlay: startWithOverlay };
  return { items: [timer], states: [], hotkeys: [] };
}

test("fixed-duration timers start with the overlay only when their checkbox is checked", () => {
  for (const checked of [false, true]) {
    const cfg = standalone(checked);
    const active = applyRuntimeEvent(cfg, EMPTY_RUNTIME, { event: "profile_activated" }, 100);
    assert.equal(getTimerRemaining(cfg, cfg.items[0], active, 2100), checked ? 8000 : 10000);
    assert.equal(active.itemTimers.fixed, checked ? 10100 : undefined);
  }
});

test("checking start with overlay on an active overlay starts it immediately without later resets", () => {
  const before = standalone();
  const after = standalone(true);
  const active = applyOverlayConfig(before, after, EMPTY_RUNTIME, 100);
  assert.equal(getTimerRemaining(after, after.items[0], active, 2100), 8000);
  const repeated = applyOverlayConfig(after, after, active, 3000);
  assert.equal(repeated.itemTimers.fixed, 10100);
  const expired = applyOverlayConfig(after, after, repeated, 12000);
  assert.equal(getTimerRemaining(after, after.items[0], expired, 12000), 0);
});

test("manual start counts down an unchecked timer and leaves an already-running countdown intact", () => {
  const cfg = standalone();
  const active = start(cfg, EMPTY_RUNTIME, "fixed", 100);
  const repeated = start(cfg, active, "fixed", 3000);
  assert.equal(repeated.itemTimers.fixed, 10100);
  assert.equal(getTimerRemaining(cfg, cfg.items[0], repeated, 3100), 7000);
  assert.equal(active.itemTimers.fixed, 10100);
});

test("expired standalone timers stay at zero and can be started again", () => {
  const cfg = standalone();
  const active = start(cfg, EMPTY_RUNTIME, "fixed", 100);
  assert.equal(getTimerRemaining(cfg, cfg.items[0], active, 10100), 0);
  assert.equal(getTimerRemaining(cfg, cfg.items[0], active, 12000), 0);
  const restarted = start(cfg, active, "fixed", 13000);
  assert.equal(getTimerRemaining(cfg, cfg.items[0], restarted, 13000), 10000);
});

test("manual start restores a dismissed standalone timer with a fresh countdown", () => {
  const cfg = standalone();
  const active = start(cfg, EMPTY_RUNTIME, "fixed", 100);
  const hidden = dismissOverlayItem(cfg, active, cfg.items[0]);
  assert.equal(isItemVisible(cfg.items[0], hidden, 200), false);
  assert.equal(hidden.itemTimers.fixed, undefined);
  const restored = start(cfg, hidden, "fixed", 300);
  assert.equal(isItemVisible(cfg.items[0], restored, 300), true);
  assert.equal(getTimerRemaining(cfg, cfg.items[0], restored, 300), 10000);
});

test("automatic starts use the linked state as the only countdown authority", () => {
  const cfg = config(20000);
  cfg.items[0].start_with_overlay = true;
  const active = applyRuntimeEvent(cfg, EMPTY_RUNTIME, { event: "profile_activated" }, 100);
  assert.deepEqual(visibleIds(cfg, active, 100), ["timer", "icon", "label", "always"]);
  assert.equal(active.timers.buff, 20100);
  assert.deepEqual(active.itemTimers, {});
  const repeated = start(cfg, active, "timer", 5000);
  assert.equal(repeated.timers.buff, 20100);
  assert.equal(getTimerRemaining(cfg, cfg.items[0], repeated, 5100), 15000);
});

test("multiple automatic timers sharing a state start it once", () => {
  const cfg = config(20000);
  cfg.items[0].start_with_overlay = true;
  cfg.items.push({ ...cfg.items[0], id: "second" });
  const active = applyRuntimeEvent(cfg, EMPTY_RUNTIME, { event: "profile_activated" }, 100);
  assert.deepEqual(active.timers, { buff: 20100 });
  assert.deepEqual(active.itemTimers, {});
});

test("starting an overlay activates its toggle state without toggling it off on a repeated start", () => {
  const cfg = config();
  const active = start(cfg, EMPTY_RUNTIME, "icon", 100);
  assert.equal(active.flags.buff, true);
  assert.deepEqual(visibleIds(cfg, start(cfg, active, "icon", 300), 300), ["timer", "icon", "label", "always"]);
  assert.equal(getTimerRemaining(cfg, cfg.items[0], active, 1100), 9000);
});

test("fixed timers linked to visibility states start and recover through the existing state action", () => {
  const cfg = config();
  const active = trigger(cfg, EMPTY_RUNTIME, "buff", 100);
  assert.equal(getTimerRemaining(cfg, cfg.items[0], active, 2100), 8000);
  const hidden = dismissOverlayItem(cfg, active, cfg.items[0]);
  assert.deepEqual(visibleIds(cfg, hidden, 2200), ["always"]);
  const restored = trigger(cfg, hidden, "buff", 3000);
  assert.equal(getTimerRemaining(cfg, cfg.items[0], restored, 3000), 10000);
});

test("unknown overlay targets do nothing and deactivation never auto-starts a timer", () => {
  const cfg = standalone(true);
  assert.deepEqual(start(cfg, EMPTY_RUNTIME, "missing", 100), EMPTY_RUNTIME);
  const active = start(cfg, EMPTY_RUNTIME, "fixed", 100);
  assert.deepEqual(applyRuntimeEvent(cfg, active, { event: "profile_deactivated" }, 200), EMPTY_RUNTIME);
});

test("assigning a shared state replaces an item's previous standalone dismissal", () => {
  const before = standalone();
  const hidden = dismissOverlayItem(before, EMPTY_RUNTIME, before.items[0]);
  const after = { ...before, items: [{ ...before.items[0], state_id: "buff" }], states: [{ id: "buff", name: "Buff", duration_ms: null }] };
  const active = trigger(after, hidden, "buff", 100);
  assert.equal(isItemVisible(after.items[0], active, 100), true);
});

const unfocused = { profile_id: null, items: [], states: [], hotkeys: [] };
const focus = (sessions, cfg, now) => applyOverlaySessionConfig(sessions, cfg, now);
const profileConfig = (id, cfg) => ({ ...cfg, profile_id: id });

test("automatic and manually started timers keep their deadlines across repeated focus changes", () => {
  for (const automatic of [false, true]) {
    const cfg = profileConfig("game", standalone(automatic));
    let sessions = focus(EMPTY_OVERLAY_SESSIONS, cfg, 100);
    if (!automatic) sessions = applyOverlaySessionEvent(sessions, { event: "overlay_started", item_id: "fixed" }, 100);
    for (const now of [1100, 3100, 5100]) {
      sessions = focus(sessions, unfocused, now - 500);
      assert.equal(getActiveOverlaySession(sessions), undefined);
      sessions = focus(sessions, cfg, now);
      const active = getActiveOverlaySession(sessions);
      assert.equal(active.runtime.itemTimers.fixed, 10100);
      assert.equal(getTimerRemaining(cfg, cfg.items[0], active.runtime, now), 10100 - now);
    }
  }
  assert.deepEqual(EMPTY_OVERLAY_SESSIONS, { activeProfileId: null, profiles: {} });
});

test("an automatic timer that expires while unfocused stays at zero when focus returns", () => {
  const cfg = profileConfig("game", standalone(true));
  const active = focus(EMPTY_OVERLAY_SESSIONS, cfg, 100);
  const away = focus(active, unfocused, 2100);
  const returned = getActiveOverlaySession(focus(away, cfg, 15000));
  assert.equal(returned.runtime.itemTimers.fixed, 10100);
  assert.equal(getTimerRemaining(cfg, cfg.items[0], returned.runtime, 15000), 0);
});

test("shared state countdowns continue to expire while their overlay is unfocused", () => {
  const cfg = profileConfig("game", config(10000));
  cfg.items[0].start_with_overlay = true;
  const active = focus(EMPTY_OVERLAY_SESSIONS, cfg, 100);
  const away = focus(active, unfocused, 2100);
  const returned = getActiveOverlaySession(focus(away, cfg, 5100));
  assert.equal(returned.runtime.timers.buff, 10100);
  assert.deepEqual(returned.runtime.itemTimers, {});
  assert.equal(getTimerRemaining(cfg, cfg.items[0], returned.runtime, 5100), 5000);
  const expired = getActiveOverlaySession(focus(focus(away, unfocused, 12000), cfg, 15000));
  assert.equal(getTimerRemaining(cfg, cfg.items[0], expired.runtime, 15000), 0);
  assert.equal(isItemVisible(cfg.items[0], expired.runtime, 15000), false);
});

test("dismissed standalone and shared-state items stay dismissed after focus returns", () => {
  for (const source of [standalone(true), config()]) {
    const cfg = profileConfig("game", source);
    cfg.items[0].start_with_overlay = true;
    const active = focus(EMPTY_OVERLAY_SESSIONS, cfg, 100);
    const dismissed = dismissOverlaySessionItem(active, cfg.items[0].id);
    const away = focus(dismissed, unfocused, 200);
    const returned = getActiveOverlaySession(focus(away, cfg, 300));
    assert.equal(isItemVisible(cfg.items[0], returned.runtime, 300), false);
    assert.deepEqual(returned.runtime, getActiveOverlaySession(dismissed).runtime);
    assert.equal(isItemVisible(cfg.items[0], getActiveOverlaySession(active).runtime, 100), true);
  }
});

test("switching between overlay profiles preserves independent countdowns even for inherited item IDs", () => {
  const first = profileConfig("first", standalone(true));
  const second = profileConfig("second", standalone(true));
  let sessions = focus(EMPTY_OVERLAY_SESSIONS, first, 100);
  sessions = focus(sessions, second, 2100);
  assert.equal(getActiveOverlaySession(sessions).runtime.itemTimers.fixed, 12100);
  sessions = focus(sessions, first, 4100);
  assert.equal(getActiveOverlaySession(sessions).runtime.itemTimers.fixed, 10100);
  sessions = focus(sessions, second, 6100);
  assert.equal(getActiveOverlaySession(sessions).runtime.itemTimers.fixed, 12100);
});

test("returning to a profile applies checkbox edits without restarting its existing timers", () => {
  const before = profileConfig("game", standalone());
  const after = profileConfig("game", standalone(true));
  const active = focus(EMPTY_OVERLAY_SESSIONS, before, 100);
  const away = focus(active, unfocused, 200);
  const enabled = focus(away, after, 300);
  assert.equal(getActiveOverlaySession(enabled).runtime.itemTimers.fixed, 10300);
  const returned = focus(focus(enabled, unfocused, 1000), after, 2000);
  assert.equal(getActiveOverlaySession(returned).runtime.itemTimers.fixed, 10300);
});

test("disarming an unfocused profile clears only its session and rearming starts a fresh timer", () => {
  const first = profileConfig("first", standalone(true));
  const second = profileConfig("second", standalone(true));
  const both = focus(focus(EMPTY_OVERLAY_SESSIONS, first, 100), second, 200);
  const disarmed = applyOverlaySessionEvent(both, { event: "profile_deactivated", profile_id: "first" }, 300);
  assert.equal(disarmed.activeProfileId, "second");
  assert.equal(disarmed.profiles.first, undefined);
  assert.equal(disarmed.profiles.second.runtime.itemTimers.fixed, 10200);
  assert.equal(both.profiles.first.runtime.itemTimers.fixed, 10100);
  const rearmed = focus(disarmed, first, 400);
  assert.equal(getActiveOverlaySession(rearmed).runtime.itemTimers.fixed, 10400);
  const stopped = applyOverlaySessionEvent(rearmed, { event: "profile_deactivated", profile_id: "first" }, 500);
  assert.equal(getActiveOverlaySession(stopped), undefined);
  assert.equal(stopped.profiles.first, undefined);
});
