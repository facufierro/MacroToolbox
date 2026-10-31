import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { parseSteps, stepsToString } from "../src/behaviors.ts";

const require = createRequire(import.meta.url);
const valueInputs = { ValueInput() {} };
const compiled = ts.transpileModule(readFileSync(new URL("../src/BehaviorEditor.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const exports = {};
runInNewContext(compiled, { exports, require(name) {
  if (name === "./ValueInput") return valueInputs;
  if (name.startsWith(".")) return {};
  return require(name);
} });

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
