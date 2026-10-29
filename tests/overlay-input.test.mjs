import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

// Exercise the real pointer callback with native client coordinates, without a Tauri build.
const source = ts.createSourceFile("OverlayApp.tsx", readFileSync(new URL("../src/OverlayApp.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === "subscribe"
      && node.arguments[0]?.text === "overlay-right-click") callback = node.arguments[1];
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(callback, "overlay must subscribe to native right-clicks");

test("right-click dismissal uses overlay client pixels across monitor origins and DPI scales", () => {
  for (const scale of [1, 1.25, 1.5, 2]) {
    for (const [screenX, screenY] of [[0, 0], [1920, 0], [-2560, -1440]]) {
      const dismissed = [];
      const itemEls = { current: new Map([
        ["other", { getBoundingClientRect: () => ({ left: 0, top: 0, right: 32, bottom: 32 }) }],
        ["timer", { getBoundingClientRect: () => ({ left: 400, top: 200, right: 500, bottom: 250 }) }],
      ]) };
      const click = runInNewContext(`(${callback.getText(source)})`, {
        window: { devicePixelRatio: scale, screenX, screenY }, itemEls,
        console: { log() {} }, reportError: assert.fail,
        invoke: async (command, args) => {
          assert.equal(command, "dismiss_overlay_item");
          dismissed.push(args.id);
        },
      });
      click([450 * scale, 225 * scale]);
      assert.deepEqual(dismissed, ["timer"]);
      click([600 * scale, 300 * scale]);
      assert.deepEqual(dismissed, ["timer"], "a click outside every part must leave timers running");
    }
  }
});
