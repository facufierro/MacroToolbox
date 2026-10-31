import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { root, browser, browserModules } from "./browserHarness.mjs";

async function scenario() {
  const results = [];
  const wait = () => new Promise(resolve => setTimeout(resolve, 40));
  const get = selector => { const element = document.querySelector(selector); if (!element) throw new Error(`Missing control: ${selector}`); return element; };
  const set = async (selector, value) => {
    const element = get(selector);
    const prototype = element.tagName === "SELECT" ? HTMLSelectElement.prototype : element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
    element.dispatchEvent(new Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    await wait();
  };
  const click = async selector => { get(selector).click(); await wait(); };
  const button = async text => {
    const element = [...document.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === text || button.textContent.trim() === text);
    if (!element) throw new Error(`Missing button: ${text}`);
    element.click(); await wait();
  };
  const check = (name, condition) => { if (!condition) throw new Error(name); results.push(name); };
  try {
    await wait();
    check("Sleep always offers a Variable source with an empty variable library", !!get('[aria-label="Sleep (ms) source"]').querySelector('option[value="variable"]'));
    await set('[aria-label="Sleep (ms) source"]', "variable");
    check("creating from Sleep opens a Number variable with Save and use", get('[aria-label="Variable type"]').value === "number" && get('[aria-label="Variable type"]').disabled);
    await button("Cancel");
    check("cancelling creation preserves the original Sleep value", window.snapshot.steps[0].ms === "100" && window.snapshot.db.variables.length === 0);
    await set('[aria-label="Sleep (ms) source"]', "variable");
    await set('[aria-label="Variable name"]', "buff timer");
    await set('[aria-label="Variable value"]', "");
    check("an empty number cannot be saved", get('button[type="submit"]').disabled);
    await set('[aria-label="Variable value"]', "5000");
    await button("Save and use");
    const id = window.snapshot.db.variables[0].id;
    check("Save and use persists a typed number and selects it for Sleep", window.snapshot.db.variables[0].type === "number" && window.snapshot.db.variables[0].value === 5000 && window.snapshot.steps[0].ms.variable === id);
    check("Sleep displays the selected variable's current value", get('[aria-label="Sleep (ms) value"]').textContent === "5000");
    await click("#save-behavior");
    check("saving and reopening the behavior preserves its explicit reference", window.snapshot.steps[0].ms.variable === id && get('[aria-label="Sleep (ms) variable"]').value === id);
    await click("#manage");
    check("saved variables show their name, type, and value", get('.variable-row__name').textContent === "buff timer" && get('.variable-row__type').textContent === "Number" && get('.variable-row__value').textContent === "5000");
    check("a variable used by a saved behavior cannot be deleted", get('[aria-label="Delete variable"]').disabled);
    await click('[aria-label="Edit variable"]');
    check("a referenced variable keeps its type while editing", get('[aria-label="Variable type"]').disabled);
    await set('[aria-label="Variable name"]', "buff timer renamed");
    await set('[aria-label="Variable value"]', "6000");
    await button("Save");
    await button("Add variable");
    await set('[aria-label="Variable name"]', "chat message");
    await set('[aria-label="Variable type"]', "text");
    await set('[aria-label="Variable value"]', "$buff; hello\nworld");
    await button("Save");
    await button("Add variable");
    await set('[aria-label="Variable name"]', "cast keys");
    await set('[aria-label="Variable type"]', "keys");
    await set('input[placeholder="Key"]', "rctrl shift n");
    await button("Save");
    check("Text and Keys variables save with their values intact", window.snapshot.db.variables[1].type === "text" && window.snapshot.db.variables[1].value === "$buff; hello\nworld" && window.snapshot.db.variables[2].type === "keys" && window.snapshot.db.variables[2].value === "rctrl shift n");
    await button("Add variable");
    await set('[aria-label="Variable name"]', "failed save");
    window.failSave = true;
    await button("Save");
    check("failed persistence retains the edit and does not create an unsaved library row", get('[aria-label="Variable name"]').value === "failed save" && window.snapshot.db.variables.length === 3 && window.errors.length === 1);
    window.failSave = false;
    await button("Cancel");
    await click("#behavior");
    check("renaming updates the selector while retaining its identity", get('[aria-label="Sleep (ms) variable"]').selectedOptions[0].textContent === "buff timer renamed" && get('[aria-label="Sleep (ms) value"]').textContent === "6000" && window.snapshot.steps[0].ms.variable === id);
    const sleepChoices = [...get('[aria-label="Sleep (ms) variable"]').options].map(option => option.textContent);
    check("Sleep only offers Number variables", !sleepChoices.includes("chat message") && !sleepChoices.includes("cast keys"));
    await button("Type text");
    await set('[aria-label="Text source"]', "variable");
    await button("Press keys");
    await set('[aria-label="Keys source"]', "variable");
    check("Press defaults to On press", get('[aria-label="Activation"]').value === "press");
    await set('[aria-label="Activation"]', "release");
    await click("#save-behavior");
    check("text and key fields save and reopen their matching references", typeof window.snapshot.steps[1].text === "object" && typeof window.snapshot.steps[2].key === "object" && !get("#save-behavior").disabled);
    check("Press saves its On release choice alongside a Keys variable", window.snapshot.steps[2].onRelease === true && get('[aria-label="Activation"]').value === "release");
    await set('[aria-label="Text source"]', "value");
    check("switching text back to Value preserves literal dollar-prefixed content and visible line breaks", window.snapshot.steps[1].text === "$buff; hello\nworld" && get('[aria-label="Text"]').value === "$buff; hello\nworld");
    await set('[aria-label="Sleep (ms) source"]', "value");
    check("switching Sleep back to Value uses the resolved number", get('[aria-label="Sleep (ms)"]').value === "6000");
    await button("Sequence");
    const group = [...document.querySelectorAll('.step-row__type')].find(element => element.textContent === "sequence").closest('.step-row');
    const nested = group.querySelector('.steps-section');
    nested.querySelector('button[aria-label="Sleep"]').click(); await wait();
    const sources = document.querySelectorAll('[aria-label="Sleep (ms) source"]');
    const nestedSource = sources[sources.length - 1];
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(nestedSource, "variable");
    nestedSource.dispatchEvent(new Event("change", { bubbles:true })); await wait();
    nested.querySelector('.step-row button[aria-label="Delete step"]').click(); await wait();
    check("nested Sleep steps can select the shared variable and save", window.snapshot.steps[3].steps[0].ms.variable === id && !get("#save-behavior").disabled);
    await click("#save-behavior");
    await click('#editor > .steps-section > .step-add-btns button[aria-label="Mouse press"]');
    check("Mouse press defaults to On press and Single click", get('.step-row:has([aria-label="Click type"]) [aria-label="Activation"]').value === "press" && get('[aria-label="Click type"]').value === "single");
    await set('.step-row:has([aria-label="Click type"]) [aria-label="Activation"]', "release");
    await set('[aria-label="Click type"]', "double");
    await click("#save-behavior");
    check("Mouse press retains On release and Double click after reopening", window.snapshot.steps[4].onRelease === true && window.snapshot.steps[4].doubleClick === true && get('.step-row:has([aria-label="Click type"]) [aria-label="Activation"]').value === "release");
    const sequence = get('.step-row--group .steps-section');
    sequence.querySelector('button[aria-label="Press keys"]').click(); await wait();
    await set('.step-row--group [aria-label="Keys source"]', "variable");
    await set('.step-row--group [aria-label="Activation"]', "release");
    await click("#save-behavior");
    check("nested Press steps retain activation and variable references", window.snapshot.steps[3].steps[1].onRelease === true && typeof window.snapshot.steps[3].steps[1].key === "object");
    const frame = get("#editor").getBoundingClientRect();
    check("the controls fit the existing behavior modal width", [...document.querySelectorAll('#editor input,#editor select,#editor .step-row__btns')].every(element => {
      const rect = element.getBoundingClientRect(); return rect.left >= frame.left && rect.right <= frame.right;
    }));
    await click('#event-mode');
    check("release choices cannot be saved in an app event without a trigger", get('#save-behavior').disabled && [...document.querySelectorAll('[aria-label="Activation"] option[value="release"]')].every(option => option.disabled));
    while (document.querySelector('[aria-label="Activation"]')) await set('[aria-label="Activation"]', "press");
    check("switching an imported release action back to On press restores event validity", !get('#save-behavior').disabled && !document.querySelector('[aria-label="Activation"]'));
    document.getElementById("results").textContent = JSON.stringify({ results });
  } catch (error) { document.getElementById("results").textContent = JSON.stringify({ results, error: error.message, stack: error.stack }); }
}

test("variable creation, selection, editing and persistence work through actual browser controls", { skip: !browser && "Chrome or Edge is required" }, async t => {
  const bundle = browserModules(["BehaviorEditor.tsx", "VariablesView.tsx"]);
  const harness = `const modules={${bundle.declarations}},cache={};
function load(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;
if(id==='./api'){module.exports={api:{async saveVariables(variables){window.saveCalls.push(structuredClone(variables));if(window.failSave)throw Error('simulated save failure');return {...window.snapshot.db,variables};}}};return module.exports;}
if(id==='./AppConsole'){module.exports={useErrorReporter:()=>error=>window.errors.push(String(error))};return module.exports;}
const [code,dependencies]=modules[id];code(module,module.exports,name=>load(dependencies[name]),{env:{NODE_ENV:'production'}});return module.exports;}
window.saveCalls=[];window.errors=[];
const React=load(${JSON.stringify(bundle.react)}),ReactDOM=load(${JSON.stringify(bundle.client)}),{BehaviorStepsEditor}=load(${JSON.stringify(bundle.entry)}),{VariablesView}=load(${JSON.stringify(join(root, "src/VariablesView.tsx"))}),{areStepsValid,parseSteps,stepsToString}=load(${JSON.stringify(join(root, "src/behaviors.ts"))});
function App(){const [db,onDb]=React.useState({version:7,variables:[],scopes:[{profiles:[{hotkeys:[],events:[]}]}]}),[steps,onChange]=React.useState([{type:'sleep',ms:'100'}]),[manage,setManage]=React.useState(false),[revision,setRevision]=React.useState(0),[hasTrigger,setHasTrigger]=React.useState(true);window.snapshot={db,steps};return React.createElement(React.Fragment,null,
React.createElement('nav',null,React.createElement('button',{id:'manage',onClick:()=>setManage(true)},'Manage variables'),React.createElement('button',{id:'behavior',onClick:()=>setManage(false)},'Behavior'),React.createElement('button',{id:'event-mode',onClick:()=>setHasTrigger(false)},'Event mode')),
manage?React.createElement(VariablesView,{db,onDb}):React.createElement('section',{id:'editor',className:'modal modal--wide'},React.createElement(BehaviorStepsEditor,{key:revision,steps,variables:db.variables,hasTrigger,onChange,onDb,gameExe:'',states:[],scripts:[],overlays:[]}),React.createElement('button',{id:'save-behavior',disabled:!areStepsValid(steps,db.variables,hasTrigger),onClick:()=>{const behavior=stepsToString(steps);onDb({...db,scopes:[{profiles:[{hotkeys:[{behavior}],events:[]}]}]});onChange(parseSteps(behavior));setRevision(revision+1);}},'Save behavior')));}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));(${scenario})();`;
  const logs = resolve(root, "logs"); mkdirSync(logs, { recursive: true });
  const directory = mkdtempSync(join(logs, "variable-ui-"));
  let result;
  try {
    const page = join(directory, "variables.html");
    const css = readFileSync(join(root, "src/App.css"), "utf8");
    writeFileSync(page, `<!doctype html><style>${css}body{height:auto;overflow:auto;padding:20px}nav{display:flex;gap:8px;margin-bottom:12px}#results{white-space:pre-wrap}</style><div id="root"></div><pre id="results"></pre><script>${harness.replace(/<\/script/gi, "<\\/script")}</script>`);
    const output = execFileSync(browser, ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${join(directory,"profile")}`,
      "--window-size=1000,1200", "--virtual-time-budget=10000", "--dump-dom", pathToFileURL(page).href], { encoding:"utf8",timeout:30000,stdio:["ignore","pipe","pipe"] });
    const match = output.match(/<pre id="results">([^<]+)<\/pre>/);
    assert.ok(match, "browser did not complete the UI scenario");
    result = JSON.parse(match[1].replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">"));
  } finally {
    assert.equal(dirname(directory), logs);
    rmSync(directory, { recursive: true, force:true });
  }
  for (const name of result.results) await t.test(name, () => {});
  assert.equal(result.error, undefined, result.stack ?? result.error);
  assert.ok(result.results.length >= 15);
});
