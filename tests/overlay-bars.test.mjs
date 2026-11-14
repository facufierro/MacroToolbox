import assert from "node:assert/strict";
import test from "node:test";
import { assignOverlayBar, saveOverlayBar, updateOverlayBars, getOverlayBarOffsets } from "../src/overlayBars.ts";
import { removeOverlayGroup } from "../src/overlayItems.ts";

const bar = (id, group_ids = []) => ({ id, name: id, x: 10, y: 20, layout: "row", gap: 8, group_ids });

test("assigning a bar keeps one membership and retains its existing order", () => {
  const source = [bar("a", ["one", "two"]), bar("b", ["three"])];
  const before = structuredClone(source);
  const moved = assignOverlayBar(source, "one", "b");
  assert.deepEqual(moved.map(bar => bar.group_ids), [["two"], ["three", "one"]]);
  assert.deepEqual(assignOverlayBar(moved, "one", "b"), moved);
  assert.deepEqual(assignOverlayBar(moved, "one", "").map(bar => bar.group_ids), [["two"], ["three"]]);
  assert.deepEqual(saveOverlayBar(source, bar("b", ["two", "three"])).map(bar => bar.group_ids), [["one"], ["two", "three"]]);
  assert.deepEqual(saveOverlayBar(source, bar("c", ["one"])).map(bar => bar.group_ids), [["two"], ["three"], ["one"]]);
  assert.deepEqual(source, before);
});

test("bar edits merge only their own changes and reject concurrent changes", () => {
  const original = [bar("a", ["one"]), bar("b", ["two"])];
  const latest = { overlay_bars: [{ ...original[0], name: "Other editor" }, original[1], bar("new")], profiles: [] };
  const updated = updateOverlayBars(latest, original, [original[0], { ...original[1], gap: 42 }]);
  assert.equal(updated.overlay_bars.find(bar => bar.id === "a").name, "Other editor");
  assert.equal(updated.overlay_bars.find(bar => bar.id === "b").gap, 42);
  assert.ok(updated.overlay_bars.some(bar => bar.id === "new"));
  assert.throws(() => updateOverlayBars(latest, original, [{ ...original[0], gap: 0 }, original[1]]), /another editor/);
  assert.deepEqual(updateOverlayBars({ overlay_bars: original }, original, [original[0]]).overlay_bars, [original[0]]);
});

test("bar gaps measure complete overlays including centered overflow and free-positioned parts", () => {
  const extents = [{ id: "icon-timer", left: -16, right: 48, top: 0, bottom: 60 },
    { id: "wide", left: -40, right: 100, top: -10, bottom: 70 },
    { id: "free", left: 20, right: 60, top: 15, bottom: 95 }];
  for (const layout of ["row", "column"]) for (const gap of [0, 8, 42]) {
    const offsets = getOverlayBarOffsets(extents, layout, gap);
    assert.equal(offsets[extents[0].id], 0);
    for (let i = 1; i < extents.length; i++) {
      const previous = extents[i - 1], current = extents[i];
      assert.equal(offsets[current.id] + current[layout === "row" ? "left" : "top"]
        - offsets[previous.id] - previous[layout === "row" ? "right" : "bottom"], gap);
    }
  }
  assert.deepEqual(getOverlayBarOffsets([], "row", 8), {});
  assert.equal(getOverlayBarOffsets([extents[2]], "row", 8).free, 0);
});

test("deleting the last definition of an overlay removes its bar membership", () => {
  const profile = { id: "p", hotkeys: [], events: [], overlay_items: [], overlay_groups: [{ id: "one" }] };
  const scope = { profiles: [profile], overlay_bars: [bar("a", ["one"])] };
  assert.deepEqual(removeOverlayGroup(scope, "p", "one").overlay_bars[0].group_ids, []);
  const inherited = { ...profile, id: "other" };
  assert.deepEqual(removeOverlayGroup({ ...scope, profiles: [profile, inherited] }, "p", "one").overlay_bars[0].group_ids, ["one"]);
});
