import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { areStepsValid, parseSteps, stepsToString } from "../src/behaviors.ts";

const require = createRequire(import.meta.url);
const valueInputs = { ValueInput() {} };
const compiled = ts.transpileModule(readFileSync(new URL("../src/BehaviorEditor.tsx", import.meta.url), "utf8") + "\nexport { newStep };", {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const exports = {};
runInNewContext(compiled, { exports, require(name) {
  if (name === "react") return { ...require("react"), useState: initial => [typeof initial === "function" ? initial() : initial, () => {}], useRef: value => ({ current: value }), useId: () => "overlay-editor", useEffect() {} };
  if (name === "./behaviors") return { areStepsValid };
  if (name === "./ValueInput") return valueInputs;
  if (name.startsWith(".")) return {};
  return require(name);
} });

test("Toggle keys exposes the standard variable-capable key input", () => {
  let steps = [{ type: "toggle", key: "" }];
  const variables = [{ id: "keys", name: "Movement", type: "keys", value: "w LButton" }];
  const editor = hasTrigger => exports.BehaviorStepsEditor({ steps, variables, states: [], overlays: [], scripts: [], gameExe: "", hasTrigger, onChange: next => { steps = next; } });
  assert.deepEqual(parseSteps(stepsToString(steps)), [{ type: "toggle", key: "" }]);
  const row = editor(true).props.children[0].props.children(steps[0], 0);
  const input = row.type(row.props).props.children[1].props.children.find(element => element?.type === valueInputs.ValueInput);
  assert.equal(input.props.type, "keys");
  assert.equal(input.props.variables, variables);
  input.props.onChange({ variable: "keys" });
  assert.deepEqual(parseSteps(stepsToString(steps)), [{ type: "toggle", key: { variable: "keys" } }]);
});

test("mousepress editor saves and reopens click type without losing its key combination", () => {
  for (const doubleClick of [undefined, false, true]) {
    let steps = [{ type: "mousepress", key: "rctrl shift LButton", ...(doubleClick === undefined ? {} : { doubleClick }) }];
    function controls() {
      const editor = exports.BehaviorStepsEditor({ steps, states: [], overlays: [], scripts: [], gameExe: "", onChange: next => { steps = next; } });
      const row = editor.props.children[0].props.children(steps[0], 0);
      const params = row.type(row.props).props.children[1].props.children;
      return params.find(element => element?.type === Symbol.for("react.fragment")).props.children;
    }
    let [keyInput, selector] = controls();
    assert.equal(selector.props.value, doubleClick ? "double" : "single");
    selector.props.onChange({ target: { value: "double" } });
    steps = parseSteps(stepsToString(steps));
    [keyInput, selector] = controls();
    assert.equal(selector.props.value, "double");
    assert.equal(keyInput.props.value, "rctrl shift LButton");
    keyInput.props.onChange("ralt RButton");
    [keyInput, selector] = controls();
    assert.equal(selector.props.value, "double");
    selector.props.onChange({ target: { value: "single" } });
    assert.equal(steps[0].doubleClick, false);
    assert.equal(steps[0].key, "ralt RButton");
  }
});

test("one Overlay row switches Start, Restart, and Stop without losing its targets", () => {
  for (const source of ['startoverlay(group)', 'restartoverlay(group)', 'stopoverlay(group)',
    '[{"type":"stopoverlay","itemIds":["group","timer"]}]']) {
    let steps = parseSteps(source);
    const targets = steps[0].itemIds;
    function row() {
      const editor = exports.BehaviorStepsEditor({ steps, states: [], overlays: [], scripts: [], gameExe: "", onChange: next => { steps = next; } });
      const element = editor.props.children[0].props.children(steps[0], 0);
      return element.type(element.props);
    }
    function action() {
      assert.equal(row().props.children[0].props.children, "overlay");
      return row().props.children[1].props.children.find(element => element?.type === Symbol.for("react.fragment")).props.children[0];
    }
    assert.equal(action().props.value, steps[0].type === "stopoverlay" ? "stop" : steps[0].restart ? "restart" : "start");
    for (const mode of ["stop", "start", "restart", "stop"]) {
      action().props.onChange({ target: { value: mode } });
      steps = parseSteps(stepsToString(steps));
      assert.equal(action().props.value, mode);
      assert.deepEqual(steps[0], mode === "stop" ? { type: "stopoverlay", itemIds: targets }
        : { type: "startoverlay", itemIds: targets, restart: mode === "restart" });
      assert.equal(areStepsValid(steps), true);
    }
  }
});

test("adding Overlay opens its own fresh group and cancelling removes only that unfinished action", () => {
  const existing = { id: "existing", name: "Existing group", type: "group" };
  const step = exports.newStep("startoverlay", [], [existing], []);
  assert.equal(step.itemIds.length, 0);
  assert.equal(step.restart, true);
  let steps = [{ type: "sleep", ms: "100" }, step];
  const editor = exports.BehaviorStepsEditor({ steps, states: [], overlays: [existing], scripts: [], gameExe: "", onChange: next => { steps = next; } });
  const element = editor.props.children[0].props.children(step, 1);
  const row = element.type(element.props);
  const group = row.props.children.find(element => element?.props?.className === "step-row__overlay").props.children;
  assert.equal(group.props.groupId, "");
  group.props.onClose();
  assert.equal(steps.length, 1);
  assert.equal(steps[0].type, "sleep");
});
