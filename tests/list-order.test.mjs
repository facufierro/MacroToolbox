import { resolveProfileEntries } from "../src/profileEntries.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { moveItem, orderOwnedSlots } from "../src/listOrder.ts";
import { resolveOverlayGroups } from "../src/overlayItems.ts";
import { triggerIdentity } from "../src/triggers.ts";

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
const resolvers = ["hotkeyEntryKey", "resolveHotkeys"].map(name =>
  app.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(app));
const code = ts.transpileModule(resolvers.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const { resolveProfileEntries: resolveEntries, resolveHotkeys, hotkeyEntryKey } = runInNewContext(
  `${code};({resolveProfileEntries,resolveHotkeys,hotkeyEntryKey})`, { orderOwnedSlots, triggerIdentity, resolveProfileEntries });

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

test("unassigned copies retain separate identities, saved order, and inherited drafts", () => {
  const hotkey = (name, trigger = "") => ({ name, trigger, behavior: "press(x)", state_id: null });
  const parent = { id: "parent", parent_id: null, hotkeys: [hotkey("Original", "f1"), hotkey("Parent copy"), hotkey("Parent copy")] };
  const child = { id: "child", parent_id: "parent", hotkeys: [hotkey("Copy"), hotkey("Copy of copy", " "), hotkey("Override", "f1")] };
  const profiles = [parent, child];
  const resolved = resolveHotkeys(profiles, child);
  assert.equal(resolved.map(entry => entry.hotkey.name).join(","), "Copy,Parent copy,Parent copy,Copy of copy,Override");
  assert.equal(new Set(resolved.map(entry => entry.key)).size, 5);
  assert.deepEqual(Array.from(resolved, entry => entry.own), [true, false, false, true, true]);
  assert.ok(resolved.every(entry => [...parent.hotkeys, ...child.hotkeys].includes(entry.hotkey)));

  const keyOf = (hotkey, index) => hotkeyEntryKey(hotkey, child, index);
  const reordered = { ...child, hotkeys: moveItem(child.hotkeys, keyOf, keyOf(child.hotkeys[1], 1), keyOf(child.hotkeys[0], 0), false) };
  assert.equal(reordered.hotkeys.map(hotkey => hotkey.name).join(","), "Copy of copy,Copy,Override");
  assert.equal(resolveHotkeys([parent, reordered], reordered).map(entry => entry.hotkey.name).join(","), "Copy of copy,Parent copy,Parent copy,Copy,Override");
  assert.equal(parent.hotkeys.length, 3);
  assert.equal(child.hotkeys[0].name, "Copy");
});

test("the Windows main window enables frontend HTML drag and drop", () => {
  const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  assert.equal(config.app.windows[0].dragDropEnabled, false);
});
