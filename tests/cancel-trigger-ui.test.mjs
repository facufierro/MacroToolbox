import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { root, browser, browserModules } from "./browserHarness.mjs";

async function scenario() {
  const results = [];
  const wait = () => new Promise(resolve => setTimeout(resolve, 40));
  const get = selector => { const element = document.querySelector(selector); if (!element) throw Error(`Missing ${selector}`); return element; };
  const check = (name, value) => { if (!value) throw Error(name); results.push(name); };
  const click = async selector => { get(selector).click(); await wait(); };
  async function openCancel() { if (!get('.cancel-triggers').open) await click('summary[aria-label="Cancel triggers"]'); }
  async function setCancel(index, value) {
    const input = get(`[aria-label="Cancel trigger ${index}"]`);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await wait();
  }
  try {
    await wait();
    const summary = get('summary[aria-label="Cancel triggers"]');
    const start = get('[aria-label="Trigger"]').getBoundingClientRect(), compact = summary.getBoundingClientRect();
    check('cancellation has a visible Cancel on label beside the trigger', summary.querySelector('.cancel-triggers__label').textContent === 'Cancel on' && compact.width <= 120 && Math.abs((start.top + start.bottom) / 2 - (compact.top + compact.bottom) / 2) < 2);
    check('the labeled control retains its tooltip and compact dropdown', summary.title === 'Cancel triggers' && !document.querySelector('.cancel-triggers__menu') && !get('.hotkey-triggers').querySelector('.form-field'));
    await openCancel();
    check('cancellation by another behavior is opt-in', !get('[aria-label="Another behavior starts"]').checked);
    check('the cancellation list sits outside the behavior list', !get('fieldset[aria-label="Cancel triggers"]').closest('.steps-section'));
    check('add uses the existing icon and tooltip style', get('[aria-label="Add cancel trigger"]').title === 'Add cancel trigger' && !get('[aria-label="Add cancel trigger"]').querySelector('span'));
    await click('[aria-label="Add cancel trigger"]');
    check('an unfinished cancel entry prevents saving', get('[aria-label="Save"]').disabled);
    await setCancel(1, ' RButton ');
    await click('[aria-label="Add cancel trigger"]');
    await setCancel(2, 'Esc');
    await click('[aria-label="Add cancel trigger"]');
    await setCancel(3, ' esc ');
    check('duplicate cancellation entries prevent saving', get('[aria-label="Save"]').disabled);
    document.querySelectorAll('[aria-label="Delete cancel trigger"]')[2].click(); await wait();
    await click('[aria-label="Save"]');
    check('saving keeps alternative keys separate without changing actions or the start trigger', JSON.stringify(window.saved.cancel_triggers) === JSON.stringify(['RButton', 'Esc'])
      && window.saved.trigger === 'e' && window.saved.behavior === JSON.stringify(window.steps));
    await click('#reload');
    check('configured keys retain their visible Cancel on label', get('.cancel-triggers__label').textContent === 'Cancel on:' && get('.cancel-triggers__keys').textContent === 'RButton, Esc' && get('summary[aria-label="Cancel triggers"]').title === 'Cancel on: RButton, Esc');
    await openCancel();
    check('reopening retains every cancellation entry', get('[aria-label="Cancel trigger 1"]').value === 'RButton' && get('[aria-label="Cancel trigger 2"]').value === 'Esc');
    get('[aria-label="Cancel trigger 1"]').closest('.key-input').querySelector('[aria-label="Record key"]').click(); await wait();
    window.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true, cancelable: true }));
    await wait();
    check('each entry retains the existing key and mouse recorder', get('[aria-label="Cancel trigger 1"]').value === 'RButton');
    get('[aria-label="Move cancel trigger 2"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })); await wait();
    check('cancel alternatives can be reordered independently of behavior steps', get('[aria-label="Cancel trigger 1"]').value === 'Esc' && get('[aria-label="Cancel trigger 2"]').value === 'RButton');
    await click('[aria-label="Save"]');
    await click('#reload');
    await openCancel();
    check('reordered alternatives persist after reopening', JSON.stringify(window.saved.cancel_triggers) === JSON.stringify(['Esc', 'RButton']) && get('[aria-label="Cancel trigger 1"]').value === 'Esc');
    const frame = get('.modal--wide').getBoundingClientRect();
    check('the list stays within the existing modal width', [...get('fieldset[aria-label="Cancel triggers"]').querySelectorAll('input,button')].every(element => {
      const bounds = element.getBoundingClientRect(); return bounds.left >= frame.left && bounds.right <= frame.right && bounds.width > 15 && bounds.height >= 28 && bounds.height <= 32;
    }));
    get('[aria-label="Cancel trigger 1"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait();
    check('Escape closes the menu and returns focus to its compact control', !get('.cancel-triggers').open && document.activeElement === get('summary[aria-label="Cancel triggers"]'));
    await openCancel();
    get('.modal-name').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await wait();
    check('clicking outside closes the secondary controls', !get('.cancel-triggers').open && !document.querySelector('.cancel-triggers__menu'));
    await click('[aria-label="Add action"]');
    check('cancellation adds no behavior command', ![...document.querySelectorAll('.action-picker button')].some(button => /cancel/i.test(button.textContent)));
    get('[aria-label="Find action"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait();
    await openCancel();
    await click('[aria-label="Delete cancel trigger"]');
    check('removing one alternative preserves the other', get('[aria-label="Cancel trigger 1"]').value === 'RButton');
    await click('[aria-label="Delete cancel trigger"]');
    await click('[aria-label="Save"]');
    await click('#reload');
    check('removing all alternatives keeps the purpose labeled and disables cancellation', get('.cancel-triggers__label').textContent === 'Cancel on' && !document.querySelector('.cancel-triggers__keys')
      && window.saved.cancel_triggers.length === 0 && window.saved.behavior === JSON.stringify(window.steps));
    await openCancel();
    await click('[aria-label="Another behavior starts"]');
    await click('[aria-label="Save"]');
    await click('#reload');
    check('another-behavior cancellation is visible without requiring a cancel key', window.saved.cancel_on_other_behavior === true && get('.cancel-triggers__keys').textContent === 'Another behavior');
    await openCancel();
    check('another-behavior cancellation survives reopening', get('[aria-label="Another behavior starts"]').checked);
    await click('[aria-label="Add cancel trigger"]');
    await setCancel(1, 'RButton');
    await click('[aria-label="Save"]');
    check('another behavior and physical cancel keys can be combined', window.saved.cancel_on_other_behavior && JSON.stringify(window.saved.cancel_triggers) === JSON.stringify(['RButton'])
      && window.saved.behavior === JSON.stringify(window.steps));
    await click('[aria-label="Another behavior starts"]');
    await click('[aria-label="Save"]');
    await click('#reload');
    await openCancel();
    check('turning the option off retains configured cancel keys', !window.saved.cancel_on_other_behavior && !get('[aria-label="Another behavior starts"]').checked && get('[aria-label="Cancel trigger 1"]').value === 'RButton');
    document.getElementById('results').textContent = JSON.stringify({ results });
  } catch (error) { document.getElementById('results').textContent = JSON.stringify({ results, error: error.message, stack: error.stack }); }
}

test('hotkeys add record reorder save reopen and remove alternative cancel triggers', { skip: !browser && 'Chrome or Edge is required' }, async t => {
  const mocks = ['./api', './AppConsole', './App.css', './CloudSettings', '@tauri-apps/api/event', '@tauri-apps/plugin-dialog', '@tauri-apps/plugin-opener', '@tauri-apps/plugin-notification'];
  const bundle = browserModules(['App.tsx'], { mocks, expose: { [join(root, 'src/App.tsx')]: ['HotkeyModal'] } });
  const harness = `const modules={${bundle.declarations}},cache={};window.steps=[{type:'waitfor'},{type:'mousepress',key:'LButton'},{type:'send',text:'done'}];
function load(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;
if(id==='./AppConsole'){module.exports={useErrorReporter:()=>error=>{throw error;}};return module.exports;}
if(${JSON.stringify(mocks)}.includes(id))return module.exports;const [code,dependencies]=modules[id];code(module,module.exports,name=>load(dependencies[name]),{env:{NODE_ENV:'production'}});return module.exports;}
const React=load(${JSON.stringify(bundle.react)}),ReactDOM=load(${JSON.stringify(bundle.client)}),{HotkeyModal}=load(${JSON.stringify(bundle.entry)});
function Fixture(){const [revision,setRevision]=React.useState(0);return React.createElement(React.Fragment,null,React.createElement('button',{id:'reload',onClick:()=>setRevision(revision+1)},'Reload'),
React.createElement(HotkeyModal,{key:revision,initial:window.saved??{name:'Cast',trigger:'e',behavior:JSON.stringify(window.steps),state_id:null},gameExe:'game.exe',states:[],overlays:[],scripts:[],variables:[],onDb(){},onSave:hotkey=>window.saved=hotkey,onClose(){}}));}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));(${scenario})();`;
  const logs = join(root, 'logs'); mkdirSync(logs, { recursive: true });
  const directory = mkdtempSync(join(logs, 'cancel-trigger-ui-'));
  let result;
  try {
    const page = join(directory, 'cancel.html');
    writeFileSync(page, `<!doctype html><style>${readFileSync(join(root, 'src/App.css'), 'utf8')}#results{position:absolute;left:-10000px}</style><div id="root"></div><pre id="results"></pre><script>${harness.replace(/<\/script/gi, '<\\/script')}</script>`);
    const output = execFileSync(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(directory, 'profile')}`,
      '--window-size=1000,1100', '--virtual-time-budget=10000', '--dump-dom', pathToFileURL(page).href], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
    const match = output.match(/<pre id="results">([^<]+)<\/pre>/);
    assert.ok(match, 'browser did not complete cancel trigger checks');
    result = JSON.parse(match[1].replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>'));
  } finally {
    assert.equal(dirname(directory), logs);
    rmSync(directory, { recursive: true, force: true });
  }
  for (const name of result.results) await t.test(name, () => {});
  assert.equal(result.error, undefined, result.stack ?? result.error);
});
