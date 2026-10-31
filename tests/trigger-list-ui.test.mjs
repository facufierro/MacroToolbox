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
  const get = selector => { const element = document.querySelector(selector); if (!element) throw Error(`Missing ${selector}`); return element; };
  const click = async selector => { get(selector).click(); await wait(); };
  const check = (name, condition) => { if (!condition) throw Error(name); results.push(name); };
  async function set(selector, value) {
    const element = get(selector);
    const prototype = element.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
    element.dispatchEvent(new Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    await wait();
  }
  const list = () => window.snapshot.db.variables.find(variable => variable.type === "triggers");
  const listRow = () => [...document.querySelectorAll('.variable-row')].find(row => row.querySelector('.variable-row__type').textContent === 'Trigger list');
  try {
    await wait();
    await set('[aria-label="Keys source"]', 'trigger');
    check('Press offers Matched trigger before a list is created', get('[aria-label="Keys source"]').value === 'trigger');
    await set('[aria-label="Trigger source"]', 'variable');
    check('creating a trigger variable opens a fixed Trigger list form', get('[aria-label="Variable type"]').value === 'triggers' && get('[aria-label="Variable type"]').disabled);
    await set('[aria-label="Variable name"]', 'Cast shortcuts');
    check('blank list entries cannot be saved', get('button[type="submit"]').disabled);
    await set('input[placeholder="Trigger 1"]', 'lctrl 1');
    await click('button[aria-label="Add trigger"]');
    await set('input[placeholder="Trigger 2"]', ' LCTRL  1 ');
    check('duplicate shortcuts cannot be saved', get('button[type="submit"]').disabled);
    await set('input[placeholder="Trigger 2"]', 'lctrl 2');
    await click('button[aria-label="Add trigger"]');
    get('input[placeholder="Trigger 3"]').closest('.key-input').querySelector('button[aria-label="Record key"]').click(); await wait();
    window.dispatchEvent(new KeyboardEvent('keydown', { key:'Control', code:'ControlLeft', ctrlKey:true, bubbles:true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key:'3', code:'Digit3', ctrlKey:true, bubbles:true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key:'3', code:'Digit3', ctrlKey:true, bubbles:true }));
    await wait();
    window.dispatchEvent(new KeyboardEvent('keyup', { key:'Control', code:'ControlLeft', bubbles:true }));
    check('each list entry supports recording a complete shortcut', get('input[placeholder="Trigger 3"]').value === 'lctrl 3');
    const listFrame = get('form.modal').getBoundingClientRect();
    check('the trigger-list form keeps every entry and recording control within its width', [...get('form.modal').querySelectorAll('input,select,button')].every(element => { const rect=element.getBoundingClientRect();return rect.left>=listFrame.left && rect.right<=listFrame.right && rect.width>15; }));
    const from = get('[aria-label="Move trigger 1"]'), to = get('[aria-label="Move trigger 3"]').closest('.sortable-item');
    const transfer = new DataTransfer();
    from.dispatchEvent(new DragEvent('dragstart', { bubbles:true, dataTransfer:transfer })); await wait();
    const clientY = to.getBoundingClientRect().bottom - 1;
    to.dispatchEvent(new DragEvent('dragover', { bubbles:true, cancelable:true, dataTransfer:transfer, clientY })); await wait();
    check('dragging shows the list insertion position', to.dataset.drop === 'after');
    to.dispatchEvent(new DragEvent('drop', { bubbles:true, cancelable:true, dataTransfer:transfer, clientY }));
    from.dispatchEvent(new DragEvent('dragend', { bubbles:true, dataTransfer:transfer })); await wait();
    check('dragging reorders shortcut entries in the draft', [...document.querySelectorAll('.trigger-list input')].map(input => input.value).join(',') === 'lctrl 2,lctrl 3,lctrl 1');
    window.failSave = true;
    await click('button[type="submit"]');
    check('a failed list save keeps its draft and does not assign an unsaved variable', !list() && get('input[placeholder="Trigger 1"]').value === 'lctrl 2' && window.errors.length === 1);
    window.failSave = false;
    await click('button[type="submit"]');
    const id = list().id;
    check('Save and use assigns the saved list while preserving its entry order', get('[aria-label="Trigger variable"]').value === id && list().value.join(',') === 'lctrl 2,lctrl 3,lctrl 1');
    check('the Trigger selector excludes ordinary Keys variables', ![...get('[aria-label="Trigger variable"]').options].some(option => option.textContent === 'Output keys'));
    await set('[aria-label="Activation"]', 'release');
    await click('.step-add-btns > button[aria-label="Press keys"]');
    await set('.steps-list > .sortable-item:last-child input[placeholder="Keys"]', 'e');
    await click('button[aria-label="Save"]');
    const saved = window.snapshot.db.scopes[0].profiles[0].hotkeys[0];
    check('one saved definition retains its list reference, matched input, release choice, and common E step', saved.trigger.variable === id && JSON.stringify(JSON.parse(saved.behavior)) === JSON.stringify([{type:'press',key:{source:'trigger'},onRelease:true},{type:'press',key:'e'}]));
    check('reopening selects Matched trigger and the original list', get('[aria-label="Trigger variable"]').value === id && get('[aria-label="Keys source"]').value === 'trigger');
    const row = get('.step-row'), controls = [...row.querySelectorAll('.step-row__params select')];
    const centers = controls.map(control => {const rect=control.getBoundingClientRect();return rect.top+rect.height/2;});
    check('Matched trigger and activation stay compact on one line', Math.max(...centers)-Math.min(...centers)<2 && row.getBoundingClientRect().height<64 && controls[0].getBoundingClientRect().width>=160);
    await set('.steps-list > .sortable-item:last-child [aria-label="Keys source"]', 'variable');
    check('Press only offers ordinary Keys variables', ![...get('[aria-label="Keys variable"]').options].some(option => option.value === id) && get('[aria-label="Keys variable"]').selectedOptions[0].textContent === 'Output keys');
    await click('#manage');
    check('a saved trigger reference prevents deleting the list', listRow().querySelector('[aria-label="Delete variable"]').disabled);
    listRow().querySelector('[aria-label="Edit variable"]').click(); await wait();
    check('editing a referenced list keeps its type locked', get('[aria-label="Variable type"]').disabled);
    await set('[aria-label="Variable name"]', 'Renamed shortcuts');
    await set('input[placeholder="Trigger 1"]', 'rctrl 2');
    await click('button[type="submit"]');
    await click('#hotkey');
    check('list renames and edits update every use without changing the reference', get('[aria-label="Trigger variable"]').value === id && get('[aria-label="Trigger variable"]').selectedOptions[0].textContent === 'Renamed shortcuts' && get('[aria-label="Trigger list"]').textContent === 'rctrl 2, lctrl 3, lctrl 1');
    const frame = get('.modal--wide').getBoundingClientRect();
    check('all hotkey controls fit within the available editor width', frame.left>=0 && frame.right<=innerWidth && [...document.querySelectorAll('.modal--wide input,.modal--wide select,.modal--wide button,.modal--wide output')].every(element => {const rect=element.getBoundingClientRect();return rect.left>=frame.left && rect.right<=frame.right && rect.width>15;}));
    await click('#event');
    check('events cannot save Matched trigger and can switch back to literal keys', get('button[aria-label="Save"]').disabled && get('[aria-label="Keys source"] option[value="trigger"]').disabled);
    await set('[aria-label="Keys source"]', 'value');
    await set('input[placeholder="Keys"]', 'e');
    check('switching an invalid event source to Value restores normal editing', !get('button[aria-label="Save"]').disabled && !document.querySelector('[aria-label="Keys source"] option[value="trigger"]'));
    await click('#hotkey');
    if (innerWidth >= 1000) { await click('#manage'); listRow().querySelector('[aria-label="Edit variable"]').click(); await wait(); }
    document.getElementById('results').textContent = JSON.stringify({results});
  } catch(error) { document.getElementById('results').textContent=JSON.stringify({results,error:error.message,stack:error.stack}); }
}

test('trigger lists and matched input work through the actual hotkey and variable editors', {skip:!browser && 'Chrome or Edge is required'}, async t => {
  const mocks = ['./api','./AppConsole','./App.css','./CloudSettings','@tauri-apps/api/event','@tauri-apps/plugin-dialog','@tauri-apps/plugin-opener','@tauri-apps/plugin-notification'];
  const bundle = browserModules(['App.tsx'], {mocks,expose:{[join(root,'src/App.tsx')]:['HotkeyModal','EventModal']}});
  const harness = `const modules={${bundle.declarations}},cache={};window.errors=[];
function load(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;
if(id==='./api'){module.exports={api:{async saveVariables(variables){if(window.failSave)throw Error('simulated save failure');return {...window.snapshot.db,variables};}}};return module.exports;}
if(id==='./AppConsole'){module.exports={useErrorReporter:()=>error=>window.errors.push(String(error))};return module.exports;}
if(${JSON.stringify(mocks)}.includes(id))return module.exports;
const [code,dependencies]=modules[id];code(module,module.exports,name=>load(dependencies[name]),{env:{NODE_ENV:'production'}});return module.exports;}
const React=load(${JSON.stringify(bundle.react)}),ReactDOM=load(${JSON.stringify(bundle.client)}),{HotkeyModal,EventModal}=load(${JSON.stringify(bundle.entry)}),{VariablesView}=load(${JSON.stringify(join(root,'src/VariablesView.tsx'))});
const initial={name:'Shared cast',trigger:'',behavior:'',state_id:null,allow_extra_modifiers:false};
function App(){const [db,onDb]=React.useState({version:7,variables:[{id:'keys',name:'Output keys',type:'keys',value:'v'}],scopes:[{profiles:[{hotkeys:[],events:[]}]}]}),[mode,setMode]=React.useState('hotkey'),[revision,setRevision]=React.useState(0);window.snapshot={db};
const common={variables:db.variables,onDb,onClose(){},gameExe:'game.exe',states:[],overlays:[],scripts:[]};
return React.createElement(React.Fragment,null,React.createElement('nav',null,...['manage','hotkey','event'].map(value=>React.createElement('button',{key:value,id:value,onClick:()=>setMode(value)},value))),
mode==='manage'?React.createElement(VariablesView,{db,onDb}):mode==='event'?React.createElement(EventModal,{...common,initial:{event:'focus_gained',behavior:JSON.stringify([{type:'press',key:{source:'trigger'}}])},eventKinds:['focus_gained'],onSave(){}}):React.createElement(HotkeyModal,{...common,key:revision,initial:db.scopes[0].profiles[0].hotkeys[0]??initial,onSave:hotkey=>{onDb({...db,scopes:[{profiles:[{hotkeys:[hotkey],events:[]}]}]});setRevision(revision+1);}}));}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));(${scenario})();`;
  const logs = resolve(root,'logs'); mkdirSync(logs,{recursive:true});
  for(const width of [1000,800]) await t.test(`${width}px window`,async t=>{
    const directory=mkdtempSync(join(logs,'trigger-list-ui-'));
    let result;
    try {
      const page=join(directory,'triggers.html');
      writeFileSync(page,`<!doctype html><style>${readFileSync(join(root,'src/App.css'),'utf8')}nav{position:fixed;z-index:1000;top:0;display:flex;gap:8px}#results{position:absolute;left:-10000px}</style><div id="root"></div><pre id="results"></pre><script>${harness.replace(/<\/script/gi,'<\\/script')}</script>`);
      const output=execFileSync(browser,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${join(directory,'profile')}`,`--window-size=${width},1100`,'--virtual-time-budget=15000',`--screenshot=${join(logs,`trigger-list-${width}.png`)}`,'--dump-dom',pathToFileURL(page).href],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
      const match=output.match(/<pre id="results">([^<]+)<\/pre>/);
      assert.ok(match,'browser did not complete the trigger-list scenario');
      result=JSON.parse(match[1].replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));
    } finally {assert.equal(dirname(directory),logs);rmSync(directory,{recursive:true,force:true});}
    for(const name of result.results) await t.test(name,()=>{});
    assert.equal(result.error,undefined,result.stack??result.error);
  });
});
