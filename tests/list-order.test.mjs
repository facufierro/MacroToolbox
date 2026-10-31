import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { moveItem, orderOwnedSlots } from "../src/listOrder.ts";
import { resolveOverlayGroups } from "../src/overlayItems.ts";

const key = item => item.id;
const items = ["a", "b", "c", "d"].map(id => ({ id, value: id }));

test("drops insert before or after a target in either direction without mutating source items", () => {
  for (const [from, to, after, expected] of [
    ["a", "c", false, "bacd"], ["a", "c", true, "bcad"],
    ["d", "b", false, "adbc"], ["d", "b", true, "abdc"],
    ["a", "d", true, "bcda"], ["d", "a", false, "dabc"],
  ]) {
    const moved = moveItem(items, key, from, to, after);
    assert.equal(moved.map(key).join(""), expected);
    assert.ok(moved.every(item => items.includes(item)));
    assert.equal(items.map(key).join(""), "abcd");
  }
});

test("no-op and stale drops retain the original order", () => {
  for (const [from, to, after] of [["a", "a", true], ["a", "b", false], ["b", "a", true], ["missing", "a", false], ["a", "missing", true]]) {
    assert.equal(moveItem(items, key, from, to, after), items);
  }
});

test("reordering a filtered list preserves hidden items and group memberships", () => {
  const original = items.map((item, index) => ({ ...item, group_id: index % 2 ? "hidden" : "visible" }));
  const moved = moveItem(original, key, "c", "a", false);
  assert.equal(moved.filter(item => item.group_id === "visible").map(key).join(""), "ca");
  assert.equal(moved.filter(item => item.group_id === "hidden").map(key).join(""), "bd");
  assert.deepEqual(moved.find(item => item.id === "c"), original[2]);
});

test("identical behavior steps move by their list positions without losing any steps", () => {
  const steps = [{ type: "sleep", ms: "100" }, { type: "send", text: "middle" }, { type: "sleep", ms: "100" }];
  const moved = moveItem(steps, (_step, index) => String(index), "2", "0", false);
  assert.deepEqual(moved, [steps[2], steps[0], steps[1]]);
});

test("owned entries follow saved order while inherited slots and resolved overrides remain intact", () => {
  const resolved = [items[0], { ...items[1], value: "override" }, items[2], items[3]];
  assert.deepEqual(orderOwnedSlots(resolved, [items[3], items[1]], key),
    [items[0], items[3], items[2], resolved[1]]);
  assert.deepEqual(orderOwnedSlots(resolved, [], key), resolved);
});

// Exercise the app's resolver with the same ownership invariant used by the backend.
const app = ts.createSourceFile("App.tsx", readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const resolver = app.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "resolveProfileEntries");
const code = ts.transpileModule(resolver.getText(app), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const resolveEntries = runInNewContext(`${code};resolveProfileEntries`, { orderOwnedSlots });

test("profile overrides can be reordered without modifying the parent or inherited entries", () => {
  const parent = { id: "parent", parent_id: null, entries: items.slice(0, 3), overlay_groups: items.slice(0, 3) };
  const override = { ...items[1], value: "override" };
  const child = { id: "child", parent_id: "parent", entries: [items[3], override], overlay_groups: [items[3], override] };
  const profiles = [parent, child];
  const resolved = resolveEntries(profiles, child, profile => profile.entries, key);
  assert.equal(resolved.map(entry => entry.value.id).join(""), "adcb");
  assert.equal(resolved[3].value.value, "override");
  assert.deepEqual(Array.from(resolved, entry => entry.own), [false, true, false, true]);
  assert.equal(resolveOverlayGroups(profiles, child).map(key).join(""), "adcb");
  assert.equal(parent.entries.map(key).join(""), "abc");
});

test("the Windows main window enables frontend HTML drag and drop", () => {
  const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  assert.equal(config.app.windows[0].dragDropEnabled, false);
});
