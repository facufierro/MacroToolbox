import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { root, browser, browserModules } from "./browserHarness.mjs";

async function scenario() {
  const results = [], wait = () => new Promise(resolve => setTimeout(resolve, 40));
  const check = (name, value) => { if (!value) throw Error(name); results.push(name); };
  const rows = () => [...document.querySelectorAll('.step-row')];
  const picker = index => rows()[index].querySelector('.overlay-targets');
  const selection = index => picker(index).querySelector('summary > span').textContent;
  async function toggle(index, name) {
    const menu = picker(index);
    if (!menu.open) { menu.querySelector('summary').click(); await wait(); }
    [...menu.querySelectorAll('label')].find(label => label.textContent === name).querySelector('input').click();
    await wait();
  }
  async function save() { document.querySelector('[aria-label="Save"]').click(); await wait(); }
  try {
    await wait();
    check('old single-overlay selections open unchanged in both actions', selection(0) === 'First' && selection(1) === 'Second');
    await toggle(0, 'Second'); await toggle(0, 'Timer');
    check('several overlays and parts can be checked without closing the picker', picker(0).open && picker(0).querySelectorAll('input:checked').length === 3);
    const action = rows()[0].querySelector('[aria-label="Overlay action"]');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(action, 'restart');
    action.dispatchEvent(new Event('change', { bubbles: true })); await wait();
    picker(0).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await wait();
    check('Escape closes the picker and returns focus to its control', !picker(0).open && document.activeElement === picker(0).querySelector('summary'));
    await toggle(1, 'First');
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await wait();
    check('clicking outside closes the selection list', !picker(1).open);
    await save();
    let saved = JSON.parse(window.saved.behavior);
    check('Start restart and Stop save the complete selected lists', saved.length === 2 && saved[0].type === 'startoverlay' && saved[0].restart === true
      && saved[0].itemIds.join(',') === 'a,b,timer' && saved[1].type === 'stopoverlay' && saved[1].itemIds.join(',') === 'b,a');
    document.getElementById('reload').click(); await wait();
    check('reopening preserves both selections and restart mode', selection(0) === 'First, Second, Timer' && selection(1) === 'Second, First' && rows()[0].querySelector('[aria-label="Overlay action"]').value === 'restart');
    await toggle(0, 'Second');
    await save(); saved = JSON.parse(window.saved.behavior);
    check('removing one selection retains the others', saved[0].itemIds.join(',') === 'a,timer' && saved[1].itemIds.join(',') === 'b,a');
    await toggle(1, 'Second'); await toggle(1, 'First');
    check('an empty overlay selection prevents saving', document.querySelector('[aria-label="Save"]').disabled);
    await toggle(1, 'Timer'); await save();
    check('Stop can be saved after choosing a new target', JSON.parse(window.saved.behavior)[1].itemIds.join(',') === 'timer');
    window.saved.behavior = JSON.stringify([{ type: 'stopoverlay', itemIds: ['missing', 'a'] }]);
    document.getElementById('reload').click(); await wait();
    await toggle(0, 'Missing overlay'); await save();
    check('missing targets remain removable without dropping the other selections', JSON.parse(window.saved.behavior)[0].itemIds.join(',') === 'a');
    if (!picker(0).open) picker(0).querySelector('summary').click();
    await wait();
    const modal = document.querySelector('.modal--wide').getBoundingClientRect(), menu = picker(0).querySelector('.overlay-targets__menu').getBoundingClientRect();
    check('the compact control and its menu fit the editor at this width', picker(0).open && menu.left >= modal.left && menu.right <= modal.right && menu.height > 0 && modal.left >= 0 && modal.right <= innerWidth);
    document.getElementById('results').textContent = JSON.stringify({ results });
  } catch (error) { document.getElementById('results').textContent = JSON.stringify({ results, error: error.message, stack: error.stack }); }
}

test('Start and Stop support multiple overlays through the real editor', { skip: !browser && 'Chrome or Edge is required' }, async t => {
  const mocks = ['./api', './AppConsole', './App.css', './CloudSettings', '@tauri-apps/api/event', '@tauri-apps/plugin-dialog', '@tauri-apps/plugin-opener', '@tauri-apps/plugin-notification'];
  const bundle = browserModules(['App.tsx'], { mocks, expose: { [join(root, 'src/App.tsx')]: ['HotkeyModal'] } });
  const harness = `const modules={${bundle.declarations}},cache={};
window.reportError=error=>{throw error;};
function load(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;
if(id==='./api'){module.exports={api:{async getDatabase(){return {version:8,scopes:[],variables:[],settings:{}};}}};return module.exports;}
if(id==='./AppConsole'){module.exports={useErrorReporter:()=>window.reportError};return module.exports;}
if(${JSON.stringify(mocks)}.includes(id))return module.exports;const [code,dependencies]=modules[id];code(module,module.exports,name=>load(dependencies[name]),{env:{NODE_ENV:'production'}});return module.exports;}
const React=load(${JSON.stringify(bundle.react)}),ReactDOM=load(${JSON.stringify(bundle.client)}),{HotkeyModal}=load(${JSON.stringify(bundle.entry)});
function Fixture(){const [revision,setRevision]=React.useState(0);return React.createElement(React.Fragment,null,React.createElement('button',{id:'reload',onClick:()=>setRevision(revision+1)},'Reload'),
React.createElement(HotkeyModal,{key:revision,initial:window.saved??{name:'Overlays',trigger:'q',behavior:JSON.stringify([{type:'startoverlay',itemId:'a',restart:false},{type:'stopoverlay',itemId:'b'}])},gameExe:'game.exe',states:[],overlays:[{id:'a',name:'First',type:'group'},{id:'b',name:'Second',type:'group'},{id:'timer',name:'Timer',type:'timer'}],scripts:[],variables:[],onDb(){},onSave:hotkey=>window.saved=hotkey,onClose(){}}));}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));(${scenario})();`;
  const logs = join(root, 'logs'); mkdirSync(logs, { recursive: true });
  for (const width of [1000, 800]) await t.test(`${width}px window`, async t => {
    const directory = mkdtempSync(join(logs, 'overlay-behaviors-ui-')); let result;
    try {
      const page = join(directory, 'overlays.html');
      writeFileSync(page, `<!doctype html><style>${readFileSync(join(root, 'src/App.css'), 'utf8')}#results{position:absolute;left:-10000px}</style><div id="root"></div><pre id="results"></pre><script>${harness.replace(/<\/script/gi, '<\\/script')}</script>`);
      const output = execFileSync(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(directory, 'profile')}`, `--window-size=${width},1000`, '--virtual-time-budget=10000', `--screenshot=${join(logs, `multiple-overlays-${width}.png`)}`, '--dump-dom', pathToFileURL(page).href], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
      const match = output.match(/<pre id="results">([^<]+)<\/pre>/); assert.ok(match, 'browser did not complete overlay selection checks');
      result = JSON.parse(match[1].replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>'));
    } finally { assert.equal(dirname(directory), logs); rmSync(directory, { recursive: true, force: true }); }
    for (const name of result.results) await t.test(name, () => {});
    assert.equal(result.error, undefined, result.stack ?? result.error);
  });
});
