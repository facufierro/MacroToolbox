import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { root, browser, browserModules } from "./browserHarness.mjs";

async function scenario() {
  const results = [], wait = () => new Promise(resolve => setTimeout(resolve, 40));
  const get = selector => { const value = document.querySelector(selector); if (!value) throw Error(`Missing ${selector}`); return value; };
  const check = (name, value) => { if (!value) throw Error(name); results.push(name); };
  const click = async selector => { get(selector).click(); await wait(); };
  async function set(selector, value) {
    const element = typeof selector === 'string' ? get(selector) : selector, prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles:true }));
    await wait();
  }
  const variable = name => window.snapshot.db.variables.find(value => value.name === name);
  const row = name => [...document.querySelectorAll('.variable-row')].find(value => value.querySelector('.variable-row__name').textContent === name);
  const add = async (label, section = get('form.modal .variable-behavior-editor > .steps-section')) => {
    section.querySelector(':scope > .step-add-btns > [aria-label="Add action"]').click(); await wait();
    section.querySelector(`:scope > .action-picker [aria-label="${label}"]`).click(); await wait();
  };
  const owner = () => window.snapshot.db.scopes[0].profiles[0];
  const flat = steps => steps.flatMap(step => step.type === 'sequence' || step.type === 'parallel' ? flat(step.steps) : [step]);
  try {
    await wait();
    await add('Secure send', get('.modal--wide > .steps-section'));
    await set('[aria-label="Password"]', 'converted-secret');
    await click('.modal--wide > .steps-section > .step-add-btns > [aria-label="Save as variable"]');
    check('Save as variable opens the existing complete action list in the wide editor', get('[aria-label="Variable type"]').value === 'behavior' && document.querySelectorAll('form.modal .step-row').length === 4 && get('form.modal').classList.contains('modal--wide'));
    await click('form.modal button[type="button"].btn--secondary');
    check('cancelling conversion preserves the original hotkey actions', !variable('Cast') && document.querySelectorAll('.modal--wide > .steps-section > .sortable-list .step-row').length !== 1);
    await click('.modal--wide > .steps-section > .step-add-btns > [aria-label="Save as variable"]');
    await set('[aria-label="Variable name"]', 'Cast');
    window.failSave = true;
    await click('form.modal button[type="submit"]');
    check('failed variable saves retain the action draft and do not replace the hotkey', !variable('Cast') && get('[aria-label="Variable name"]').value === 'Cast' && window.errors.length === 1);
    window.failSave = false;
    await click('form.modal button[type="submit"]');
    const castId = variable('Cast').id;
    check('saving replaces the current action list with a stable shared reference', get('[aria-label="Behavior variable"]').value === castId && JSON.parse(variable('Cast').value)[0].onRelease === true);
    await click('[aria-label="Save"]');
    check('hotkey persistence stores the variable reference rather than copying actions', JSON.stringify(JSON.parse(owner().hotkeys[0].behavior)) === JSON.stringify([{type:'behavior',variableId:castId}]));
    check('conversion transfers the unsaved password to the variable without saving it twice', window.credentials.size === 1 && window.passwordWrites === 1 && window.hotkeyDraftCounts.at(-1) === 0 && !JSON.stringify(window.snapshot.db).includes('converted-secret'));
    await click('#manage');
    check('referenced behavior and scalar dependencies cannot be deleted', row('Cast').querySelector('[aria-label="Delete variable"]').disabled && row('Delay').querySelector('[aria-label="Delete variable"]').disabled && row('Cast keys').querySelector('[aria-label="Delete variable"]').disabled);
    await click('.variables-view > [aria-label="Add variable"]');
    await set('[aria-label="Variable name"]', 'Wrapper');
    await set('[aria-label="Variable type"]', 'behavior');
    check('Behavior is available in Variables and an empty definition cannot be saved', get('form.modal button[type="submit"]').disabled);
    await add('Behavior variable');
    await set('form.modal [aria-label="Behavior variable"]', castId);
    await click('form.modal button[type="submit"]');
    const wrapperId = variable('Wrapper').id;
    check('a shared behavior can call another saved behavior', JSON.parse(variable('Wrapper').value)[0].variableId === castId);
    await click('#hotkey');
    await set('[aria-label="Behavior variable"]', wrapperId);
    await click('[aria-label="Save"]');
    const savedReference = owner().hotkeys[0].behavior;
    await click('#event');
    check('events reject release actions hidden inside nested shared definitions', get('[aria-label="Save"]').disabled);
    await click('#manage');
    row('Cast').querySelector('[aria-label="Edit variable"]').click(); await wait();
    check('editing a used behavior keeps its type locked and preserves its actions', get('[aria-label="Variable type"]').disabled && document.querySelectorAll('form.modal .step-row').length === 4);
    await set('form.modal [aria-label="Activation"]', 'press');
    await set('form.modal [aria-label="Keys source"]', 'value');
    await set('form.modal input[placeholder="Keys"]', 'rctrl 2');
    await add('Behavior variable');
    const selectors = document.querySelectorAll('form.modal [aria-label="Behavior variable"]');
    check('a definition cannot directly select itself', ![...selectors[0].options].some(option => option.value === castId));
    await set('form.modal [aria-label="Behavior variable"]', wrapperId);
    check('indirect recursive definitions cannot be saved', get('form.modal button[type="submit"]').disabled);
    const lastRow = [...document.querySelectorAll('form.modal .step-row')].at(-1);
    lastRow.querySelector('[aria-label="Delete step"]').click(); await wait();
    await click('form.modal button[type="submit"]');
    check('editing one definition preserves all callers and updates their expansion', owner().hotkeys[0].behavior === savedReference && window.expanded(owner().hotkeys[0].behavior).includes('rctrl 2'));
    await click('#event');
    check('the converted Secure send still requires a hotkey after release actions are removed', get('[aria-label="Save"]').disabled);
    await click('#manage');
    row('Cast').querySelector('[aria-label="Edit variable"]').click(); await wait();
    get('form.modal .value-input--number > button').click(); await wait();
    const childForm = [...document.querySelectorAll('form.modal')].at(-1);
    await set(childForm.querySelector('[aria-label="Variable name"]'), 'Child delay');
    await set(childForm.querySelector('[aria-label="Variable value"]'), '25');
    childForm.querySelector('button[type="submit"]').click(); await wait();
    check('saving an inner scalar variable does not submit or discard the outer behavior form', document.querySelectorAll('form.modal').length === 1 && get('[aria-label="Variable name"]').value === 'Cast' && JSON.parse(variable('Cast').value).find(step=>step.type==='sleep').ms.variable === 'delay' && get('form.modal [aria-label="Sleep (ms) variable"]').value === variable('Child delay').id);
    await add('Secure send');
    await set([...document.querySelectorAll('form.modal [aria-label="Password"]')].at(-1), 'fixture-only-secret');
    await add('State'); await add('Run script'); await add('Overlay');
    const overlays = [...document.querySelectorAll('form.modal .overlay-targets')].at(-1);
    overlays.querySelector('summary').click(); await wait();
    overlays.querySelectorAll('input')[0].click(); await wait();
    overlays.querySelectorAll('input')[1].click(); await wait();
    overlays.querySelector('summary').click(); await wait();
    check('the shared editor offers state, script, overlay and masked password controls', get('form.modal [aria-label="Password"]').type === 'password' && document.querySelectorAll('form.modal .step-row').length === 8);
    await click('form.modal button[type="submit"]');
    check('shared Secure send persists only credential IDs and writes its draft separately', !JSON.stringify(window.snapshot.db).includes('fixture-only-secret') && window.credentials.size === 2 && window.passwordWrites === 2);
    await click('#event');
    check('events reject Secure send inherited through a shared variable', get('[aria-label="Save"]').disabled);
    const portable = await window.makeExport();
    check('export carries shared definitions, scalar dependencies, states, scripts and complete overlays without passwords', portable.variables.length === 3 && portable.data.states.length === 1 && portable.data.scripts.length === 1 && portable.data.overlay_items.length === 1 && !JSON.stringify(portable).includes('fixture-only-secret'));
    window.importData = portable;
    const imported = await window.importOne();
    const importedSteps = flat(JSON.parse(window.expanded(imported.profile.hotkeys[0].behavior, imported.variables)));
    check('profile import remaps targets inside shared definitions with the imported entities', importedSteps.find(step=>step.type==='state').stateId === imported.profile.states[0].id && importedSteps.find(step=>step.type==='script').scriptId === imported.profile.scripts[0].id && importedSteps.find(step=>step.type==='startoverlay').itemIds[0] === imported.profile.overlay_groups[0].id && imported.profile.states[0].id !== 'state-old');
    check('profile import remaps every selected overlay target', importedSteps.find(step=>step.type==='startoverlay').itemIds.length === 2 && importedSteps.find(step=>step.type==='startoverlay').itemIds[1] === imported.profile.overlay_items[0].id);
    window.importData = {type:'scope',data:window.snapshot.db.scopes[0],variables:window.snapshot.db.variables};
    const folderImport = await window.importFolder();
    const importedScope = folderImport.scopes[0], importedOwner = importedScope.profiles.find(profile=>profile.name==='Caller');
    const folderSteps = flat(JSON.parse(window.expanded(importedOwner.hotkeys[0].behavior, folderImport.variables)));
    check('folder import remaps nested shared targets without losing caller references', folderSteps.find(step=>step.type==='state').stateId === importedScope.states[0].id && folderSteps.find(step=>step.type==='script').scriptId === importedScope.profiles.flatMap(profile=>profile.scripts)[0].id && folderSteps.find(step=>step.type==='startoverlay').itemIds[0] === importedScope.profiles.flatMap(profile=>profile.overlay_groups)[0].id);
    check('folder import remaps every selected overlay target', folderSteps.find(step=>step.type==='startoverlay').itemIds.length === 2 && folderSteps.find(step=>step.type==='startoverlay').itemIds[1] === importedScope.profiles.flatMap(profile=>profile.overlay_items)[0].id);
    await click('#manage');
    row('Cast').querySelector('[aria-label="Edit variable"]').click(); await wait();
    const frame = get('form.modal').getBoundingClientRect();
    check('the shared behavior editor fits the window without controls crossing its edges', frame.left >= 0 && frame.right <= innerWidth && [...get('form.modal').querySelectorAll('input,select,button')].every(control=>{const r=control.getBoundingClientRect();return r.left>=frame.left && r.right<=frame.right && r.width>10;}));
    document.getElementById('results').textContent = JSON.stringify({results});
  } catch(error) { document.getElementById('results').textContent = JSON.stringify({results,error:error.message,stack:error.stack}); }
}

test('complete shared behaviors work through creation, editing, secure storage and real import/export controls', {skip:!browser && 'Chrome or Edge is required'}, async t => {
  const mocks = ['./api','./AppConsole','./App.css','./CloudSettings','@tauri-apps/api/event','@tauri-apps/plugin-dialog','@tauri-apps/plugin-opener','@tauri-apps/plugin-notification'];
  const bundle = browserModules(['App.tsx'], {mocks,expose:{[join(root,'src/App.tsx')]:['HotkeyModal','EventModal','exportProfile','importProfile','importScope']}});
  const harness = `const modules={${bundle.declarations}},cache={};window.errors=[];window.reportError=error=>window.errors.push(String(error));window.credentials=new Map();window.passwordWrites=0;window.hotkeyDraftCounts=[];
function load(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;
if(id==='./api'){module.exports={api:{async getDatabase(){return structuredClone(window.snapshot.db);},async saveVariables(variables,secureTexts=[]){if(window.failSave)throw Error('simulated failure');for(const draft of secureTexts){window.credentials.set(draft.credentialId,draft.password);window.passwordWrites++;}return {...window.snapshot.db,variables};},async writeTextFile(path,text){window.exported=JSON.parse(text);},async readTextFile(){return JSON.stringify(window.importData);}}};return module.exports;}
if(id==='./AppConsole'){module.exports={useErrorReporter:()=>window.reportError};return module.exports;}
if(id==='@tauri-apps/plugin-dialog'){module.exports={open:async()=> 'fixture.hkm-profile',save:async()=> 'fixture.hkm-profile'};return module.exports;}
if(${JSON.stringify(mocks)}.includes(id))return module.exports;
const [code,dependencies]=modules[id];code(module,module.exports,name=>load(dependencies[name]),{env:{NODE_ENV:'production'}});return module.exports;}
const React=load(${JSON.stringify(bundle.react)}),ReactDOM=load(${JSON.stringify(bundle.client)}),{HotkeyModal,EventModal,exportProfile,importProfile,importScope}=load(${JSON.stringify(bundle.entry)}),{VariablesView}=load(${JSON.stringify(join(root,'src/VariablesView.tsx'))}),{expandBehavior}=load(${JSON.stringify(join(root,'src/behaviors.ts'))});
const initial=[{type:'press',key:{variable:'keys'},onRelease:true},{type:'sleep',ms:{variable:'delay'}},{type:'mousepress',key:'LButton',doubleClick:true}];
const profile={id:'caller',name:'Caller',kind:'hotkeys',parent_id:null,armed:false,states:[],scripts:[],overlay_items:[],overlay_groups:[],events:[],hotkeys:[{trigger:'f1',name:'Cast',behavior:JSON.stringify(initial),state_id:null}]};
const source={...profile,id:'source',name:'Resources',hotkeys:[],scripts:[{id:'script-old',name:'Cast script',language:'python',code:''}],overlay_groups:[{id:'group-old',name:'Cast overlay'}],overlay_items:[{id:'item-old',type:'timer',group_id:'group-old',duration_ms:1000}]};
function App(){const [db,onDb]=React.useState({version:7,variables:[{id:'delay',name:'Delay',type:'number',value:150},{id:'keys',name:'Cast keys',type:'keys',value:'rctrl shift n'}],scopes:[{id:'scope',name:'Game',exe:'Game.exe',states:[{id:'state-old',name:'Buff',duration_ms:null}],profiles:[profile,source]}]}),[mode,setMode]=React.useState('hotkey'),[revision,setRevision]=React.useState(0);window.snapshot={db};
window.expanded=(source,variables=db.variables)=>expandBehavior(source,variables);window.makeExport=async()=>{await exportProfile(db.scopes[0].profiles[0],db.scopes[0],db.variables);return window.exported;};window.importOne=()=>importProfile([]);window.importFolder=()=>importScope([]);
const common={variables:db.variables,onDb,onClose(){},gameExe:'Game.exe',states:db.scopes[0].states,overlays:[],scripts:[]};
return React.createElement(React.Fragment,null,React.createElement('nav',null,...['manage','hotkey','event'].map(value=>React.createElement('button',{key:value,id:value,onClick:()=>setMode(value)},value))),
mode==='manage'?React.createElement(VariablesView,{db,onDb}):mode==='event'?React.createElement(EventModal,{...common,initial:{event:'focus_gained',behavior:db.scopes[0].profiles[0].hotkeys[0].behavior},eventKinds:['focus_gained'],onSave(){}}):React.createElement(HotkeyModal,{...common,key:revision,initial:db.scopes[0].profiles[0].hotkeys[0],onSave:(hotkey,drafts)=>{window.hotkeyDraftCounts.push(drafts.length);onDb({...db,scopes:[{...db.scopes[0],profiles:[{...db.scopes[0].profiles[0],hotkeys:[hotkey]},db.scopes[0].profiles[1]]}]});setRevision(revision+1);}}));}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));(${scenario})();`;
  const logs = resolve(root,'logs'); mkdirSync(logs,{recursive:true});
  for(const width of [1000,800]) await t.test(`${width}px window`,async t=>{
    const directory=mkdtempSync(join(logs,'behavior-variable-ui-')); let result;
    try {
      const page=join(directory,'behaviors.html');
      writeFileSync(page,`<!doctype html><style>${readFileSync(join(root,'src/App.css'),'utf8')}nav{position:fixed;top:0;z-index:1000;display:flex;gap:8px}#results{position:absolute;left:-10000px}</style><div id="root"></div><pre id="results"></pre><script>${harness.replace(/<\/script/gi,'<\\/script')}</script>`);
      const output=execFileSync(browser,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${join(directory,'profile')}`,`--window-size=${width},1400`,'--virtual-time-budget=15000',`--screenshot=${join(logs,`behavior-variable-${width}.png`)}`,'--dump-dom',pathToFileURL(page).href],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
      const match=output.match(/<pre id="results">([^<]+)<\/pre>/); assert.ok(match,'browser did not complete the shared-behavior scenario');
      result=JSON.parse(match[1].replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));
    } finally {assert.equal(dirname(directory),logs);rmSync(directory,{recursive:true,force:true});}
    for(const name of result.results) await t.test(name,()=>{});
    assert.equal(result.error,undefined,result.stack??result.error);
  });
});
