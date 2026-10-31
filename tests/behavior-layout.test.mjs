import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { root, browser, browserModules } from "./browserHarness.mjs";

const steps = [
  { type: "press", key: "lctrl 1" },
  { type: "waitfor", key: "LButton" },
  { type: "waitfor", key: "LButton" },
  { type: "sleep", ms: { variable: "after-cast" } },
  { type: "press", key: "v" },
];
const variables = [{ id: "after-cast", name: "after-cast-timer", type: "number", value: 150 },
  { id: "movement", name: "Movement", type: "keys", value: "w LButton" }];

async function scenario() {
  const results = [];
  const wait = () => new Promise(resolve => setTimeout(resolve, 40));
  const check = (name, condition) => { if (!condition) throw Error(name); results.push(name); };
  const bounds = element => element.getBoundingClientRect();
  function fits() {
    const modal = document.querySelector('.modal--wide');
    const frame = bounds(modal);
    return frame.left >= 0 && frame.right <= innerWidth && modal.scrollWidth <= modal.clientWidth
      && [...modal.querySelectorAll('input,select,textarea,button,output')].every(element => {
        const rect = bounds(element); return rect.left >= frame.left && rect.right <= frame.right && rect.width > 15;
      });
  }
  try {
    await wait();
    const rows = [...document.querySelectorAll('.step-row')];
    for (const row of rows) {
      const controls = [...row.querySelectorAll('.step-row__params input,.step-row__params select,.step-row__params button,.step-row__params output')];
      const centers = controls.map(element => { const rect = bounds(element); return rect.top + rect.height / 2; });
      check(`${row.querySelector('.step-row__type').textContent} controls share one line`, Math.max(...centers) - Math.min(...centers) < 2 && bounds(row).height < 64);
    }
    check('the editor uses available width without overflowing the window', bounds(document.querySelector('.modal--wide')).width >= Math.min(900, innerWidth - 32) - 1 && fits());
    const source = document.querySelector('[aria-label="Sleep (ms) source"]');
    check('the selected variable, value, and New variable action stay on the same line',
      Math.abs(bounds(source).top + bounds(source).height / 2 - (bounds(document.querySelector('[aria-label="Sleep (ms) value"]')).top + bounds(document.querySelector('[aria-label="Sleep (ms) value"]')).height / 2)) < 2);
    document.querySelector('button[aria-label="Save"]').click(); await wait();
    check('layout changes preserve the saved behavior and variable reference', JSON.stringify(JSON.parse(window.saved.behavior)) === JSON.stringify(window.originalSteps));
    window.showNested(true); await wait();
    check('nested editors wrap within their available width', fits());
    const inner = [...document.querySelectorAll('.step-row--group .steps-section')].at(-1);
    inner.querySelector(':scope > .step-add-btns [aria-label="Add action"]').click(); await wait();
    check('the complete grouped action picker fits inside nested editors', fits() && inner.querySelectorAll('.action-picker__group').length === 5);
    inner.querySelector('[aria-label="Find action"]').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true})); await wait();
    window.showNested(false); await wait();
    check('recording controls and activation choices remain available', document.querySelectorAll('button[aria-label="Record key"]').length === 4 && document.querySelectorAll('[aria-label="Activation"]').length === 2);
    check('the action toolbar only shows Add action and Save as variable', document.querySelectorAll('.step-add-btns > button').length === 2 && !document.querySelector('.action-picker'));
    document.querySelector('button[aria-label="Add action"]').click(); await wait();
    check('all existing actions remain available within the editor width', document.querySelectorAll('.action-picker button').length === 26 && fits());
    const search = document.querySelector('[aria-label="Find action"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, 'toggle');
    search.dispatchEvent(new Event('input', { bubbles: true })); await wait();
    check('actions can be found by name without a wall of buttons', document.querySelectorAll('.action-picker button').length === 1 && document.activeElement === search && fits());
    search.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true})); await wait();
    check('Escape closes the picker and returns focus to Add action', !document.querySelector('.action-picker') && document.activeElement.getAttribute('aria-label') === 'Add action');
    document.querySelector('button[aria-label="Add action"]').click(); await wait();
    const keyboardSearch = document.querySelector('[aria-label="Find action"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(keyboardSearch, 'toggle');
    keyboardSearch.dispatchEvent(new Event('input', { bubbles: true })); await wait();
    keyboardSearch.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true,cancelable:true})); await wait();
    check('Enter adds the matching action and closes the picker', !document.querySelector('.action-picker'));
    const toggle = [...document.querySelectorAll('.step-row')].find(row => row.querySelector('.step-row__type').textContent === 'toggle');
    const toggleSource = toggle.querySelector('[aria-label="Keys source"]');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(toggleSource, 'variable');
    toggleSource.dispatchEvent(new Event('change', { bubbles: true })); await wait();
    check('Toggle keys uses the existing compact key-variable controls', toggle.querySelector('[aria-label="Keys variable"]').value === 'movement' && fits() && bounds(toggle).height < 64);
    document.querySelector('button[aria-label="Save"]').click(); await wait();
    check('Toggle keys saves as a shared key reference', JSON.stringify(JSON.parse(window.saved.behavior).at(-1)) === JSON.stringify({type:'toggle',key:{variable:'movement'}}));
    document.getElementById('results').textContent = JSON.stringify({ results });
  } catch (error) { document.getElementById('results').textContent = JSON.stringify({ results, error: error.message, stack: error.stack }); }
}

test('behavior controls use a single row when space is available and stay usable at narrower widths', { skip: !browser && 'Chrome or Edge is required' }, async t => {
  const mocks = ['./api', './AppConsole', './App.css', './CloudSettings', '@tauri-apps/api/event', '@tauri-apps/plugin-dialog', '@tauri-apps/plugin-opener', '@tauri-apps/plugin-notification'];
  const bundle = browserModules(['App.tsx'], { mocks, expose: { [join(root, 'src/App.tsx')]: ['HotkeyModal'] } });
  const harness = `const modules={${bundle.declarations}},cache={};window.originalSteps=${JSON.stringify(steps)};
function load(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;
if(id==='./AppConsole'){module.exports={useErrorReporter:()=>error=>{throw error;}};return module.exports;}
if(${JSON.stringify(mocks)}.includes(id))return module.exports;
const [code,dependencies]=modules[id];code(module,module.exports,name=>load(dependencies[name]),{env:{NODE_ENV:'production'}});return module.exports;}
const React=load(${JSON.stringify(bundle.react)}),ReactDOM=load(${JSON.stringify(bundle.client)}),{HotkeyModal}=load(${JSON.stringify(bundle.entry)});
function App(){const [nested,setNested]=React.useState(false);window.showNested=setNested;
const behavior=nested?[{type:'sequence',steps:[{type:'sequence',steps:[{type:'press',key:'rctrl shift n',onRelease:true}]},{type:'sleep',ms:{variable:'after-cast'}}]},{type:'mousepress',key:'rctrl LButton',doubleClick:true,onRelease:true}]:window.originalSteps;
return React.createElement(HotkeyModal,{key:String(nested),initial:{name:'',trigger:'lctrl 1',behavior:JSON.stringify(behavior),state_id:null,allow_extra_modifiers:false},gameExe:'game.exe',states:[],overlays:[],scripts:[],variables:${JSON.stringify(variables)},onDb(){},onSave:hotkey=>window.saved=hotkey,onClose(){}});}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));(${scenario})();`;
  const logs = resolve(root, 'logs'); mkdirSync(logs, { recursive: true });
  for (const width of [1000, 800]) await t.test(`${width}px window`, async t => {
    const directory = mkdtempSync(join(logs, 'behavior-layout-'));
    let result;
    try {
      const page = join(directory, 'layout.html');
      writeFileSync(page, `<!doctype html><style>${readFileSync(join(root, 'src/App.css'), 'utf8')}#results{position:absolute;left:-10000px}</style><div id="root"></div><pre id="results"></pre><script>${harness.replace(/<\/script/gi, '<\\/script')}</script>`);
      const output = execFileSync(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(directory, 'profile')}`,
        `--window-size=${width},1100`, '--virtual-time-budget=10000', `--screenshot=${join(logs, `behavior-layout-${width}.png`)}`, '--dump-dom', pathToFileURL(page).href], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
      const match = output.match(/<pre id="results">([^<]+)<\/pre>/);
      assert.ok(match, 'browser did not complete the layout scenario');
      result = JSON.parse(match[1].replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>'));
    } finally {
      assert.equal(dirname(directory), logs);
      rmSync(directory, { recursive: true, force: true });
    }
    for (const name of result.results) await t.test(name, () => {});
    assert.equal(result.error, undefined, result.stack ?? result.error);
  });
});
