import assert from "node:assert/strict";
import test from "node:test";
import { acceptOverlayOrigin, acceptOverlaySnapshot, getOverlayItemPosition, toLogicalOverlayBounds } from "../src/overlayPosition.ts";

const runtime = { flags: {}, timers: {}, itemTimers: { timer: 5000 }, hiddenItems: {} };
const snapshot = (profile, revision) => ({ config: { profile_id: profile, items: [], states: [], hotkeys: [] }, runtime, revision });
const presentation = (profile = "game", revision = 1) => ({ snapshot: snapshot(profile, revision), origin: [100, 200, 1920, 1080], generation: 1 });

test("returning from Alt+Tab waits for the configured target's refreshed position", () => {
  const initial = presentation();
  const hidden = acceptOverlaySnapshot(initial, snapshot(null, 2));
  assert.equal(hidden.origin, null);
  const returned = acceptOverlaySnapshot(hidden, snapshot("game", 3));
  assert.equal(returned.origin, null);
  assert.equal(returned.snapshot.runtime.itemTimers.timer, 5000);
  const ready = acceptOverlayOrigin(returned, returned.generation, [100, 200, 1920, 1080]);
  assert.deepEqual(getOverlayItemPosition({ x: 25, y: 50 }, ready.origin), { left: 580, top: 740 });
});

test("a previous target's delayed position cannot move the current overlay", () => {
  const initial = presentation();
  const switched = acceptOverlaySnapshot(initial, snapshot("other-game", 2));
  assert.equal(switched.origin, null);
  assert.equal(acceptOverlayOrigin(switched, initial.generation, [900, 300, 800, 600]), switched);
});

test("a position from before Alt+Tab is rejected even when returning to the same target", () => {
  const initial = presentation();
  const hidden = acceptOverlaySnapshot(initial, snapshot(null, 2));
  const returned = acceptOverlaySnapshot(hidden, snapshot("game", 3));
  assert.equal(acceptOverlayOrigin(returned, initial.generation, [900, 300, 800, 600]), returned);
  assert.equal(returned.origin, null);
});

test("stale snapshots cannot reset an overlay's current position", () => {
  const current = presentation("game", 10);
  assert.equal(acceptOverlaySnapshot(current, snapshot("other-game", 9)), current);
});

test("timer and configuration updates for the same target preserve its position", () => {
  const current = presentation();
  const next = acceptOverlaySnapshot(current, snapshot("game", 2));
  assert.equal(next.generation, current.generation);
  assert.equal(next.origin, current.origin);
  assert.equal(next.snapshot.runtime.itemTimers.timer, 5000);
});

test("unavailable target bounds hide the overlay until valid positioning returns", () => {
  const current = presentation();
  const hidden = acceptOverlayOrigin(current, current.generation, null);
  assert.equal(hidden.origin, null);
  assert.equal(hidden.snapshot, current.snapshot);
  const restored = acceptOverlayOrigin(hidden, hidden.generation, [-100, 50, 1280, 720]);
  assert.deepEqual(restored.origin, [-100, 50, 1280, 720]);
  assert.equal(restored.snapshot.runtime.itemTimers.timer, 5000);
});

test("percentage positions land on the same physical point at every overlay DPI", () => {
  const physicalBounds = [320, 180, 1920, 1080];
  for (const scale of [1, 1.25, 1.5, 2]) {
    const origin = toLogicalOverlayBounds(physicalBounds, scale);
    for (const [x, y, expectedLeft, expectedTop] of [
      [0, 0, 320, 180],
      [25, 75, 800, 990],
      [50, 50, 1280, 720],
      [100, 100, 2240, 1260],
    ]) {
      const { left, top } = getOverlayItemPosition({ x, y }, origin);
      assert.equal(left * scale, expectedLeft);
      assert.equal(top * scale, expectedTop);
    }
  }
});

test("picked coordinates align with an app on a desktop extending left and above primary", () => {
  const overlayScreenPosition = [-2560, -1440];
  const appScreenBounds = [-2240, -1260, 1920, 1080];
  const physicalOrigin = [320, 180, 1920, 1080];
  const picked = { x: 37.5, y: 62.5 };
  for (const scale of [1, 1.25, 1.5, 2]) {
    const origin = toLogicalOverlayBounds(physicalOrigin, scale);
    const { left, top } = getOverlayItemPosition(picked, origin);
    assert.equal(overlayScreenPosition[0] + left * scale, appScreenBounds[0] + 720);
    assert.equal(overlayScreenPosition[1] + top * scale, appScreenBounds[1] + 675);
  }
});

test("global overlays use the full desktop relative to its own top-left", () => {
  for (const scale of [1, 1.25, 1.5, 2]) {
    const origin = toLogicalOverlayBounds([0, 0, 4480, 2520], scale);
    assert.deepEqual(getOverlayItemPosition({ x: 0, y: 0 }, origin), { left: 0, top: 0 });
    const { left, top } = getOverlayItemPosition({ x: 50, y: 50 }, origin);
    assert.equal(left * scale, 2240);
    assert.equal(top * scale, 1260);
  }
});

test("legacy coordinates above 100 retain their CSS pixel offsets", () => {
  const origin = toLogicalOverlayBounds([300, 150, 1920, 1080], 1.5);
  assert.deepEqual(getOverlayItemPosition({ x: 101, y: 240 }, origin), { left: 301, top: 340 });
  assert.deepEqual(getOverlayItemPosition({ x: -101, y: -240 }, origin), { left: 99, top: -140 });
});
