import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";

// Exercise the actual action callbacks without mounting the app or opening native dialogs.
const source = ts.createSourceFile("App.tsx", readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers = [];
function visit(node) {
  if (ts.isCallExpression(node) && ["confirm", "confirmDialog"].includes(node.expression.getText(source))) {
    let handler = node.parent;
    while (handler && !ts.isArrowFunction(handler)) handler = handler.parent;
    assert.ok(handler, "confirmation must belong to an action callback");
    handlers.push({ label: node.arguments[0].head.text, code: handler.getText(source) });
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(handlers.length, 4, "cover overlay, profile, folder, and process confirmations");

for (const { label, code } of handlers) {
  test(`${label.replace(/[\s"]+$/, "")} waits for confirmation and cancels safely on dismissal or dialog failure`, async () => {
    for (const answer of ["Ok", "Cancel", "failure"]) {
      const actions = [], commands = [], errors = [];
      let resolve, reject;
      const response = new Promise((yes, no) => { resolve = yes; reject = no; });
      const previousWindow = globalThis.window;
      globalThis.window = { __TAURI_INTERNALS__: { invoke(command, args) {
        commands.push({ command, args });
        return response;
      } } };
      const api = Object.fromEntries(["upsertGame", "deleteProfile", "deleteGame", "killGame"]
        .map(name => [name, async () => { actions.push(name); return {}; }]));
      const failure = new Error("dialog unavailable");
      let running;
      try {
        const run = runInNewContext(`(${code})`, {
          confirm() { throw new Error("The browser confirm shim calls an unavailable command"); },
          confirmDialog, api,
          group: { name: "Overlay" }, p: { id: "profile", name: "Profile" },
          folder: { id: "folder", name: "Folder" }, folderId: "folder", profileId: "profile", targetExe: "game.exe",
          profile: { overlay_items: [] }, removeOverlayGroup: () => ({}),
          onDb() {}, handleDb() {}, reportError: error => errors.push(error),
        });
        running = run().catch(error => errors.push(error));
        await Promise.resolve();
        assert.deepEqual(actions, [], "action ran before the user answered");
        assert.equal(commands.length, 1);
        assert.equal(commands[0].command, "plugin:dialog|message", "used an unavailable dialog command");
        assert.equal(commands[0].args.buttons, "OkCancel");
        if (answer === "failure") reject(failure); else resolve(answer);
        await running;
        assert.equal(actions.length, answer === "Ok" ? 1 : 0, "dismissed or failed confirmation performed an action");
        assert.deepEqual(errors, answer === "failure" ? [failure] : []);
      } finally {
        resolve("Cancel");
        await running;
        if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
      }
    }
  });
}
