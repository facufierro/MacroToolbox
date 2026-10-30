import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { profileVariableIds } from "../src/variables.ts";

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL("../src/VariablesView.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function view(saveVariables) {
  const state = [], changes = [], errors = [];
  let index;
  const exports = {};
  runInNewContext(compiled, { exports, crypto: globalThis.crypto, require(name) {
    if (name === "react") return { useEffect() {}, useState(initial) {
      const slot = index++;
      if (!(slot in state)) state[slot] = typeof initial === "function" ? initial() : initial;
      return [state[slot], next => { state[slot] = next; }];
    } };
    if (name === "./api") return { api: { saveVariables } };
    if (name === "./AppConsole") return { useErrorReporter: () => error => errors.push(error) };
    if (name === "./variables") return { profileVariableIds };
    if (name.startsWith(".")) return {};
    return require(name);
  } });
  const db = { variables: [{ id: "buff", name: "buff timer", value: 5000 }, { id: "unused", name: "other", value: 10 }],
    scopes: [{ profiles: [{ hotkeys: [], events: [{ behavior: '[{"type":"sequence","steps":[{"type":"sleep","ms":"$buff"}]}]' }] }] }] };
  function render() {
    index = 0;
    const element = exports.VariablesView({ db, onDb: value => changes.push(value) });
    return { rows: element.props.children[1].props.children, actions: element.props.children[2].props.children };
  }
  return { render, changes, errors };
}

test("variable editing retains identity, protects referenced variables, and saves one shared value", async () => {
  const saves = [];
  const editor = view(async variables => { saves.push(JSON.parse(JSON.stringify(variables))); return { variables }; });
  let { rows, actions } = editor.render();
  assert.equal(rows[0].props.children[2].props.disabled, true);
  assert.equal(rows[1].props.children[2].props.disabled, false);
  rows[0].props.children[0].props.onChange({ target: { value: " renamed timer " } });
  ({ rows } = editor.render());
  rows[0].props.children[1].props.onChange({ target: { value: "6000" } });
  ({ actions } = editor.render());
  assert.equal(actions[1].props.disabled, false);
  await actions[1].props.onClick();
  assert.deepEqual(saves[0][0], { id: "buff", name: "renamed timer", value: 6000 });
  assert.equal(editor.changes.length, 1);
  assert.deepEqual(editor.errors, []);
});

test("empty values and duplicate names cannot save, and a failed save retains edits", async () => {
  const failure = new Error("Variable is used by a repeat interval");
  const editor = view(async () => { throw failure; });
  let { rows } = editor.render();
  rows[0].props.children[1].props.onChange({ target: { value: "" } });
  assert.equal(editor.render().actions[1].props.disabled, true);
  ({ rows } = editor.render());
  rows[0].props.children[1].props.onChange({ target: { value: "-1" } });
  ({ rows } = editor.render());
  rows[0].props.children[0].props.onChange({ target: { value: " OTHER " } });
  assert.equal(editor.render().actions[1].props.disabled, true);
  ({ rows } = editor.render());
  rows[0].props.children[0].props.onChange({ target: { value: "buff timer" } });
  await editor.render().actions[1].props.onClick();
  assert.deepEqual(editor.errors, [failure]);
  assert.deepEqual(editor.changes, []);
  assert.equal(editor.render().rows[0].props.children[1].props.value, "-1");
  assert.equal(editor.render().actions[1].props.disabled, false);
});
