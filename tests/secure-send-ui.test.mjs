import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { root, browser, browserModules } from "./browserHarness.mjs";

async function scenario() {
  const results=[];
  const wait=()=>new Promise(resolve=>setTimeout(resolve,40));
  const get=selector=>{const element=document.querySelector(selector);if(!element)throw Error(`Missing ${selector}`);return element;};
  const click=async selector=>{get(selector).click();await wait();};
  const add=async(label,section=get('.modal--wide > .steps-section'))=>{section.querySelector(':scope > .step-add-btns > [aria-label="Add action"]').click();await wait();section.querySelector(`:scope > .action-picker [aria-label="${label}"]`).click();await wait();};
  const check=(name,condition)=>{if(!condition)throw Error(name);results.push(name);};
  async function set(selector,value){const element=get(selector);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));await wait();}
  const saved=()=>window.snapshot.db.scopes[0].profiles[0].hotkeys[0];
  const secret='fixture-only +!^{Enter};ø🚀';
  try {
    await wait();
    await add('Secure send');
    check('Secure send has one masked password field and requires a value before saving',get('[aria-label="Password"]').type==='password' && get('[aria-label="Password"]').autocomplete==='new-password' && get('[aria-label="Save"]').disabled);
    await set('[aria-label="Password"]',secret);
    check('entering a password keeps it out of the saved database and visible page text',!JSON.stringify(window.snapshot.db).includes(secret) && !get('#root').textContent.includes(secret) && !get('[aria-label="Save"]').disabled && window.savedPasswords.size===0);
    await click('[aria-label="Cancel"]');
    check('Cancel discards the password draft without any credential write',window.saveCalls.length===0 && window.savedPasswords.size===0 && !document.querySelector('[aria-label="Password"]'));
    await add('Secure send');
    await set('[aria-label="Password"]','x'.repeat(1281));
    check('passwords beyond the Windows credential limit cannot be saved',get('[aria-label="Save"]').disabled);
    await set('[aria-label="Password"]',secret);
    window.failSave=true;
    await click('[aria-label="Save"]');
    check('a failed save retains the masked draft and leaves the original profile untouched',get('[aria-label="Password"]').value===secret && window.savedPasswords.size===0 && !saved().behavior.includes('securesend') && window.errors.length===1);
    window.failSave=false;
    window.holdSave=true;
    await click('[aria-label="Save"]');
    check('saving locks password edits and Cancel until persistence finishes',get('[aria-label="Password"]').matches(':disabled') && get('[aria-label="Cancel"]').matches(':disabled') && get('[aria-label="Save"]').matches(':disabled'));
    window.finishSave();await wait();
    const first=JSON.parse(saved().behavior)[1].credentialId;
    check('Save passes the password separately and persists only its credential reference',window.savedPasswords.get(first)===secret && window.saveCalls[1].secureTexts[0].password===secret && !JSON.stringify(saved()).includes(secret));
    check('reopening does not retrieve or refill the saved password',get('[aria-label="Password"]').value==='' && get('[aria-label="Password"]').placeholder==='Saved password');
    const portable=window.exportProfile();
    check('profile export and reimport retain the secure action without exporting its password',portable.includes(first) && !portable.includes(secret) && JSON.parse(portable).profile.hotkeys[0].behavior===saved().behavior);
    await set('[aria-label="Password"]','replacement-fixture');
    check('password replacement stays in the draft until Save',window.savedPasswords.get(first)===secret);
    await click('[aria-label="Cancel"]');
    check('cancelling replacement preserves the stored credential reference and password',JSON.parse(saved().behavior)[1].credentialId===first && window.savedPasswords.get(first)===secret && get('[aria-label="Password"]').value==='');
    await set('[aria-label="Password"]','replacement-fixture');
    await click('[aria-label="Save"]');
    const second=JSON.parse(saved().behavior)[1].credentialId;
    check('saving replacement uses a fresh credential ID',second!==first && window.savedPasswords.get(second)==='replacement-fixture');
    await add('Sequence');
    await add('Secure send',get('.step-row--group .steps-section'));
    await set('.step-row--group [aria-label="Password"]','nested-fixture');
    await set('.step-row--group input[placeholder="Keys"]','Tab');
    await click('[aria-label="Save"]');
    const nested=JSON.parse(saved().behavior)[2].steps[1];
    check('nested sequences share the password draft owner and reopen using references',window.savedPasswords.get(nested.credentialId)==='nested-fixture' && !saved().behavior.includes('nested-fixture') && get('.step-row--group [aria-label="Password"]').value==='');
    await add('Secure send');
    await set('.modal--wide > .steps-section > .steps-list > .sortable-item:last-child [aria-label="Password"]','removed-fixture');
    await click('.modal--wide > .steps-section > .steps-list > .sortable-item:last-child [aria-label="Delete step"]');
    await click('[aria-label="Save"]');
    check('deleting an unsaved secure step excludes its password from persistence',window.saveCalls.at(-1).secureTexts.length===0 && ![...window.savedPasswords.values()].includes('removed-fixture'));
    const frame=get('.modal--wide').getBoundingClientRect();
    check('password fields and action controls fit the compact editor',frame.left>=0 && frame.right<=innerWidth && [...document.querySelectorAll('.modal--wide input,.modal--wide select,.modal--wide button')].every(element=>{const rect=element.getBoundingClientRect();return rect.left>=frame.left && rect.right<=frame.right && rect.width>15;}));
    await click('#event');
    await click('.step-add-btns > [aria-label="Add action"]');
    check('app events cannot add Secure send or Toggle keys or save an imported secure action',get('.action-picker [aria-label="Secure send"]').disabled && get('.action-picker [aria-label="Toggle keys"]').disabled && get('[aria-label="Save"]').disabled && get('[aria-label="Password"]').disabled);
    await click('#hotkey');
    document.getElementById('results').textContent=JSON.stringify({results});
  } catch(error){document.getElementById('results').textContent=JSON.stringify({results,error:error.message,stack:error.stack});}
}

test('Secure send masks drafts and saves credential references through actual hotkey controls',{skip:!browser && 'Chrome or Edge is required'},async t=>{
  const mocks=['./api','./AppConsole','./App.css','./CloudSettings','@tauri-apps/api/event','@tauri-apps/plugin-dialog','@tauri-apps/plugin-opener','@tauri-apps/plugin-notification'];
  const bundle=browserModules(['App.tsx'],{mocks,expose:{[join(root,'src/App.tsx')]:['HotkeyModal','EventModal']}});
  const harness=`const modules={${bundle.declarations}},cache={};window.errors=[];window.savedPasswords=new Map();window.saveCalls=[];
function load(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;
if(id==='./AppConsole'){module.exports={useErrorReporter:()=>error=>window.errors.push(String(error))};return module.exports;}
if(${JSON.stringify(mocks)}.includes(id))return module.exports;
const [code,dependencies]=modules[id];code(module,module.exports,name=>load(dependencies[name]),{env:{NODE_ENV:'production'}});return module.exports;}
const React=load(${JSON.stringify(bundle.react)}),ReactDOM=load(${JSON.stringify(bundle.client)}),{HotkeyModal,EventModal}=load(${JSON.stringify(bundle.entry)}),{exportVariables,importVariables}=load(${JSON.stringify(join(root,'src/variables.ts'))});
const initial={name:'Login',trigger:'f8',behavior:'press(e)',allow_extra_modifiers:false,state_id:null};
function App(){const [db,onDb]=React.useState({version:7,variables:[],scopes:[{profiles:[{hotkeys:[initial],events:[]}]}]}),[revision,setRevision]=React.useState(0),[mode,setMode]=React.useState('hotkey');window.snapshot={db};
window.exportProfile=()=>{const profile=db.scopes[0].profiles[0],variables=exportVariables([profile],db.variables);return JSON.stringify({profile:importVariables([profile],variables,[]).profiles[0],variables});};
const common={variables:db.variables,onDb,gameExe:'game.exe',states:[],overlays:[],scripts:[],onClose:()=>setRevision(revision+1)};
return React.createElement(React.Fragment,null,React.createElement('nav',null,...['hotkey','event'].map(value=>React.createElement('button',{id:value,key:value,onClick:()=>setMode(value)},value))),mode==='event'?React.createElement(EventModal,{...common,initial:{event:'focus_gained',behavior:JSON.stringify([{type:'securesend',credentialId:'b8483943-e86c-41aa-a593-7388833369cd'}])},eventKinds:['focus_gained'],onSave(){}}):React.createElement(HotkeyModal,{...common,key:revision,initial:db.scopes[0].profiles[0].hotkeys[0],onSave:async(hotkey,secureTexts)=>{window.saveCalls.push(structuredClone({hotkey,secureTexts}));if(window.failSave){window.errors.push('fixture save failure');return;}if(window.holdSave){await new Promise(resolve=>window.finishSave=resolve);window.holdSave=false;}for(const draft of secureTexts)window.savedPasswords.set(draft.credentialId,draft.password);onDb({...db,scopes:[{profiles:[{hotkeys:[hotkey],events:[]}]}]});setRevision(revision+1);}}));}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));(${scenario})();`;
  const logs=resolve(root,'logs');mkdirSync(logs,{recursive:true});
  for(const width of [1000,800])await t.test(`${width}px window`,async t=>{
    const directory=mkdtempSync(join(logs,'secure-send-ui-'));let result;
    try{
      const page=join(directory,'secure.html');
      writeFileSync(page,`<!doctype html><style>${readFileSync(join(root,'src/App.css'),'utf8')}nav{position:fixed;z-index:1000;top:0;display:flex;gap:8px}#results{position:absolute;left:-10000px}</style><div id="root"></div><pre id="results"></pre><script>${harness.replace(/<\/script/gi,'<\\/script')}</script>`);
      const output=execFileSync(browser,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${join(directory,'profile')}`,`--window-size=${width},1100`,'--virtual-time-budget=15000',`--screenshot=${join(logs,`secure-send-${width}.png`)}`,'--dump-dom',pathToFileURL(page).href],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
      const match=output.match(/<pre id="results">([^<]+)<\/pre>/);assert.ok(match,'browser did not complete the secure-send scenario');
      result=JSON.parse(match[1].replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));
    }finally{assert.equal(dirname(directory),logs);rmSync(directory,{recursive:true,force:true});}
    for(const name of result.results)await t.test(name,()=>{});
    assert.equal(result.error,undefined,result.stack??result.error);
  });
});
