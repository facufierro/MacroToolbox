import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { parseSteps, stepsToString } from "../src/behaviors.ts";
import * as behaviors from "../src/behaviors.ts";

const require = createRequire(import.meta.url);
const numberInputs = {};
runInNewContext(ts.transpileModule(readFileSync(new URL("../src/NumberInput.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { exports: numberInputs, require(name) { return name === "./behaviors" ? behaviors : require(name); } });
const compiled = ts.transpileModule(readFileSync(new URL("../src/BehaviorEditor.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const exports = {};
runInNewContext(compiled, { exports, require(name) {
  if (name === "./NumberInput") return numberInputs;
  if (name.startsWith(".")) return {};
  return require(name);
} });

test("mousepress editor saves and reopens click type without losing its key combination", () => {
  for (const doubleClick of [undefined, false, true]) {
    let steps = [{ type: "mousepress", key: "rctrl shift LButton", ...(doubleClick === undefined ? {} : { doubleClick }) }];
    function controls() {
      const editor = exports.BehaviorStepsEditor({ steps, states: [], overlays: [], scripts: [], gameExe: "", onChange: next => { steps = next; } });
      const row = editor.props.children[0].props.children[0][0];
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

test("sleep editor selects, reopens, renames and returns a variable to its numeric value", () => {
  let steps = [{ type: "sequence", steps: [{ type: "sleep", ms: "100" }] }];
  const variables = [{ id: "buff", name: "buff timer", value: 5000 }];
  function control() {
    let editor = exports.BehaviorStepsEditor({ steps, variables, states: [], overlays: [], scripts: [], gameExe: "", onChange: next => { steps = next; } });
    let row = editor.props.children[0].props.children[0][0];
    let nested = row.type(row.props).props.children[1].props.children.find(element => element?.type === exports.BehaviorStepsEditor);
    editor = nested.type(nested.props);
    row = editor.props.children[0].props.children[0][0];
    const input = row.type(row.props).props.children[1].props.children.find(element => element?.type === numberInputs.NumberInput);
    return input.type(input.props).props.children;
  }
  let [input, selector] = control();
  assert.equal(input.props.value, "100");
  selector.props.onChange({ target: { value: "$buff" } });
  steps = parseSteps(stepsToString(steps));
  [input, selector] = control();
  assert.equal(input, false);
  assert.equal(selector.props.value, "$buff");
  variables[0].name = "renamed timer";
  variables[0].value = 6000;
  [, selector] = control();
  assert.equal(selector.props.children[2][0].props.children, "renamed timer");
  selector.props.onChange({ target: { value: "" } });
  assert.equal(steps[0].steps[0].ms, "6000");
});
