import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { root, browser, browserModules } from "./browserHarness.mjs";

async function scenario(empty) {
  const results = [], wait = () => new Promise(resolve => setTimeout(resolve,40));
  const check = (name, condition) => { if (!condition) throw Error(name); results.push(name); };
  const rows = () => [...document.querySelectorAll('.step-row')];
  const checkbox = row => row.querySelector('.step-row__compatibility input');
  const click = async element => { if (!element) throw Error('Missing control'); element.click(); await wait(); };
  const set = async (element,value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,value);
    element.dispatchEvent(new Event('input',{bubbles:true})); await wait();
  };
  try {
    await wait();
    if (empty) {
      check('an empty behavior has no mouse controls or extra compatibility row', rows().length === 0 && !document.querySelector('.step-row__compatibility'));
    } else {
      check('legacy keyboard and mouse actions share the Press editor', rows().length === 3 && rows().every(row => row.querySelector('.step-row__type').textContent === 'press'));
      check('keyboard presses hide mouse-only settings', !checkbox(rows()[0]) && !rows()[0].querySelector('[aria-label="Click type"]'));
      check('old Mouse press keeps Compatibility and its release double click', checkbox(rows()[1]).checked && rows()[1].querySelector('[aria-label="Click type"]').value === 'double' && rows()[1].querySelector('[aria-label="Activation"]').value === 'release');
      check('normal mouse presses default to unchecked Compatibility', !checkbox(rows()[2]).checked);
      check('Compatibility is a labeled checkbox without a method selector', checkbox(rows()[1]).closest('label').textContent.trim() === 'Compatibility' && !document.querySelector('select[aria-label="Click method"]'));
      await click(checkbox(rows()[1]));
      await click(document.querySelector('[aria-label="Save"]'));
      check('switching one method preserves its input and activation settings', window.savedSteps[1].compatibility === false && window.savedSteps[1].key === 'LButton' && window.savedSteps[1].doubleClick && window.savedSteps[1].onRelease && !window.savedSteps[0].compatibility);
      await click(document.getElementById('reopen'));
      check('reopening retains the explicitly selected method', !checkbox(rows()[1]).checked);
      await click(checkbox(rows()[1]));
      await click(document.querySelector('[aria-label="Add action"]'));
      const search = document.querySelector('[aria-label="Find action"]');
      await set(search,'mouse');
      check('mouse searches discover the unified Press action', document.querySelectorAll('.action-picker button').length === 1 && document.querySelector('.action-picker [aria-label="Press"]'));
      await click(document.querySelector('.action-picker [aria-label="Press"]'));
      let row = rows().at(-1);
      check('a new Press starts without mouse options or compatibility enabled', !checkbox(row) && !row.querySelector('[aria-label="Click type"]'));
      await set(row.querySelector('input[placeholder="Input"]'),'LButton');
      row = rows().at(-1);
      check('selecting a mouse button exposes Single click and unchecked Compatibility', !checkbox(row).checked && row.querySelector('[aria-label="Click type"]').value === 'single');
      await click(checkbox(row));
      await set(row.querySelector('input[placeholder="Input"]'),'Enter');
      check('editing an input never silently changes Compatibility', checkbox(rows().at(-1)).checked && document.querySelector('[aria-label="Save"]').disabled);
      await click(checkbox(rows().at(-1)));
      check('keyboard input is valid after explicitly disabling Compatibility', !checkbox(rows().at(-1)) && !rows().at(-1).querySelector('[aria-label="Click type"]') && !document.querySelector('[aria-label="Save"]').disabled);
    }
    const modal = document.querySelector('.modal');
    const frame = modal.getBoundingClientRect();
    check('empty and configured editors fit normal and narrow windows', frame.left >= 0 && frame.right <= innerWidth && modal.scrollWidth <= modal.clientWidth && [...modal.querySelectorAll('input,select,button')].filter(element => element.getClientRects().length).every(element => element.getBoundingClientRect().right <= frame.right));
    document.getElementById('results').textContent = JSON.stringify({results});
  } catch(error) { document.getElementById('results').textContent = JSON.stringify({results,error:String(error),stack:error.stack}); }
}

test('one Press action preserves explicit mouse methods and fits compact layouts', {skip:!browser}, async t => {
  const mocks = ['./api','./AppConsole','./App.css','./CloudSettings','@tauri-apps/api/event','@tauri-apps/plugin-dialog','@tauri-apps/plugin-opener','@tauri-apps/plugin-notification'];
  const bundle = browserModules(['App.tsx'],{mocks,expose:{[join(root,'src/App.tsx')]:['HotkeyModal']}});
  const logs = join(root,'logs'); mkdirSync(logs,{recursive:true});
  for (const empty of [true,false]) for (const width of [1000,600]) await t.test(`${empty?'empty':'configured'} at ${width}px`, async () => {
    const directory = mkdtempSync(join(logs,'press-ui-'));
    try {
      const page = join(directory,'press.html');
      const legacy = [{type:'press',key:'a'},{type:'mousepress',key:'LButton',doubleClick:true,onRelease:true},{type:'press',key:'RButton'}];
      const harness = `const modules={${bundle.declarations}},cache={};
function load(id){if(cache[id])return cache[id].exports;const module=cache[id]={exports:{}};
if(id==='./AppConsole'){module.exports={useErrorReporter:()=>error=>{throw error}};return module.exports;}
if(${JSON.stringify(mocks)}.includes(id))return module.exports;
const [code,dependencies]=modules[id];code(module,module.exports,name=>load(dependencies[name]),{env:{NODE_ENV:'production'}});return module.exports;}
const React=load(${JSON.stringify(bundle.react)}),ReactDOM=load(${JSON.stringify(bundle.client)}),{HotkeyModal}=load(${JSON.stringify(bundle.entry)});
let saved={name:'Press test',trigger:'f8',behavior:JSON.stringify(${empty?'[]':JSON.stringify(legacy)}),state_id:null};
function Fixture(){const [revision,setRevision]=React.useState(0);return React.createElement(React.Fragment,null,React.createElement('button',{id:'reopen',style:{position:'fixed',top:0,left:0,zIndex:10000},onClick:()=>setRevision(revision+1)},'Reopen'),React.createElement(HotkeyModal,{key:revision,initial:saved,gameExe:'fixture.exe',states:[],overlays:[],scripts:[],variables:[],onDb(){},onClose(){},onSave:hotkey=>{saved=hotkey;window.savedSteps=JSON.parse(hotkey.behavior)}}));}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));(${scenario})(${empty});`;
      writeFileSync(page,`<!doctype html><style>${readFileSync(join(root,'src/App.css'),'utf8')}#results{position:absolute;left:-10000px}</style><div id="root"></div><pre id="results"></pre><script>${harness.replace(/<\/script/gi,'<\\/script')}</script>`);
      const output = execFileSync(browser,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${join(directory,'profile')}`,`--window-size=${width},1000`,'--virtual-time-budget=12000',`--screenshot=${join(logs,`press-${empty?'empty':'configured'}-${width}.png`)}`,'--dump-dom',pathToFileURL(page).href],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
      const match = output.match(/<pre id="results">([^<]+)<\/pre>/);
      assert.ok(match,'browser did not finish Press scenario');
      const result = JSON.parse(match[1].replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));
      assert.equal(result.error,undefined,result.stack??result.error);
    } finally { assert.equal(dirname(directory),logs); rmSync(directory,{recursive:true,force:true}); }
  });
});
