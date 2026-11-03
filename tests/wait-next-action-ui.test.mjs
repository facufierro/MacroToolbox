import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { root, browser, browserModules } from "./browserHarness.mjs";

async function scenario(){
  const results=[],wait=()=>new Promise(resolve=>setTimeout(resolve,40));
  const get=selector=>{const element=document.querySelector(selector);if(!element)throw Error(`Missing ${selector}`);return element;};
  const check=(name,value)=>{if(!value)throw Error(name);results.push(name);};
  const rows=()=>[...document.querySelectorAll('.step-row')];
  const waitRow=()=>rows().find(row=>row.querySelector('.step-row__type').textContent==='waitfor');
  const click=async selector=>{get(selector).click();await wait();};
  async function add(label){await click('[aria-label="Add action"]');await click(`.action-picker [aria-label="${label}"]`);}
  try{
    await wait();
    check('Wait for has no input mode value fields or recorder even when opening old settings',!waitRow().querySelector('.step-row__params').querySelector('input,select,button'));
    check('old input conditions move into the following mouse action automatically',rows()[1].querySelector('.step-row__type').textContent==='mousepress'&&rows()[1].querySelector('input').value==='LButton');
    await click('[aria-label="Save"]');
    check('saving upgrades the old wait without keeping hidden fields',JSON.stringify(JSON.parse(window.saved.behavior))===JSON.stringify(window.expected));
    const saved=JSON.parse(window.saved.behavior);
    check('conversion preserves the original release mouse action and overlay restart',JSON.stringify(saved[0])===JSON.stringify({type:'waitfor'})&&saved[2].onRelease&&saved[2].doubleClick&&saved[2].key==='rctrl LButton'&&saved[3].restart);
    await click('#reload');
    check('reopening keeps Wait for empty and input settings on the separate action',!waitRow().querySelector('.step-row__params').querySelector('input,select,button')&&rows()[2].querySelector('[aria-label="Activation"]').value==='release'&&rows()[2].querySelector('[aria-label="Click type"]').value==='double');
    get('[aria-label="Move startoverlay step 4"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));await wait();
    get('[aria-label="Move startoverlay step 3"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));await wait();
    await click('[aria-label="Save"]');
    check('reordering updates the next action without storing a stale target or key',JSON.parse(window.saved.behavior)[1].type==='startoverlay'&&JSON.parse(window.saved.behavior)[1].restart&&!('key'in JSON.parse(window.saved.behavior)[0]));
    await add('Wait for');
    check('new Wait for steps have no controls and require a following action',!rows().at(-1).querySelector('.step-row__params').querySelector('input,select,button')&&get('[aria-label="Save"]').disabled);
    await add('Start overlay');
    check('overlay actions can follow Wait for without a hardcoded input field',!get('[aria-label="Save"]').disabled);
    await click('[aria-label="Save"]');
    const appended=JSON.parse(window.saved.behavior);
    check('new next-action waits and overlay restart settings persist together',appended.at(-2).type==='waitfor'&&!('key'in appended.at(-2))&&appended.at(-1).type==='startoverlay'&&appended.at(-1).restart);
    document.getElementById('results').textContent=JSON.stringify({results});
  }catch(error){document.getElementById('results').textContent=JSON.stringify({results,error:error.message,stack:error.stack});}
}

test('Wait for defaults to the next action and preserves existing waits through save reorder and reopen',{skip:!browser&&'Chrome or Edge is required'},async t=>{
  const mocks=['./api','./AppConsole','./App.css','./CloudSettings','@tauri-apps/api/event','@tauri-apps/plugin-dialog','@tauri-apps/plugin-opener','@tauri-apps/plugin-notification'];
  const bundle=browserModules(['App.tsx'],{mocks,expose:{[join(root,'src/App.tsx')]:['HotkeyModal']}});
  const original=[{type:'waitfor',key:'LButton'},{type:'mousepress',key:'rctrl LButton',onRelease:true,doubleClick:true},{type:'startoverlay',itemId:'timer',restart:true}];
  const expected=[{type:'waitfor'},{type:'mousepress',key:'LButton'},original[1],{type:'startoverlay',restart:true,itemIds:['timer']}];
  const harness=`const modules={${bundle.declarations}},cache={};window.original=${JSON.stringify(original)};window.expected=${JSON.stringify(expected)};
function load(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;
if(id==='./AppConsole'){module.exports={useErrorReporter:()=>error=>{throw error;}};return module.exports;}
if(${JSON.stringify(mocks)}.includes(id))return module.exports;const [code,dependencies]=modules[id];code(module,module.exports,name=>load(dependencies[name]),{env:{NODE_ENV:'production'}});return module.exports;}
const React=load(${JSON.stringify(bundle.react)}),ReactDOM=load(${JSON.stringify(bundle.client)}),{HotkeyModal}=load(${JSON.stringify(bundle.entry)});
function Fixture(){const [revision,setRevision]=React.useState(0);return React.createElement(React.Fragment,null,React.createElement('button',{id:'reload',onClick:()=>setRevision(revision+1)},'Reload'),
React.createElement(HotkeyModal,{key:revision,initial:window.saved??{name:'Wait',trigger:'q',behavior:JSON.stringify(window.original),state_id:null},gameExe:'game.exe',states:[],overlays:[{id:'timer',name:'Timer',type:'timer'}],scripts:[],variables:[],onDb(){},onSave:hotkey=>window.saved=hotkey,onClose(){}}));}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));(${scenario})();`;
  const logs=join(root,'logs');mkdirSync(logs,{recursive:true});const directory=mkdtempSync(join(logs,'wait-next-ui-'));let result;
  try{
    const page=join(directory,'wait.html');writeFileSync(page,`<!doctype html><style>${readFileSync(join(root,'src/App.css'),'utf8')}#results{position:absolute;left:-10000px}</style><div id="root"></div><pre id="results"></pre><script>${harness.replace(/<\/script/gi,'<\\/script')}</script>`);
    const output=execFileSync(browser,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${join(directory,'profile')}`,'--window-size=1100,1100','--virtual-time-budget=10000','--dump-dom',pathToFileURL(page).href],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
    const match=output.match(/<pre id="results">([^<]+)<\/pre>/);assert.ok(match,'browser did not complete Wait for checks');
    result=JSON.parse(match[1].replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));
  }finally{assert.equal(dirname(directory),logs);rmSync(directory,{recursive:true,force:true});}
  for(const name of result.results)await t.test(name,()=>{});
  assert.equal(result.error,undefined,result.stack??result.error);
});
