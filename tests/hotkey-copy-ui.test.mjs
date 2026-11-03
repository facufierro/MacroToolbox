import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { root, browser, browserModules } from "./browserHarness.mjs";

// Run the app's copy and save handlers alongside its actual profile and hotkey editors.
const app = ts.createSourceFile("App.tsx", readFileSync(join(root, "src/App.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node) && ["handleCopyHotkey", "handleHotkeySave"].includes(node.name?.text)) handlers.push(node.getText(app));
  ts.forEachChild(node, visit);
}
visit(app);
assert.equal(handlers.length, 2);
const handlerCode = ts.transpileModule(handlers.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;

async function scenario() {
  const results = [], wait = () => new Promise(resolve => setTimeout(resolve, 40));
  const check = (name, value) => { if (!value) throw Error(name); results.push(name); };
  const rows = () => [...document.querySelectorAll('.editor .steps-list > .sortable-item')];
  const saved = () => window.snapshot.scopes[0].profiles[0].hotkeys;
  const clickRow = async (index, label) => { rows()[index].querySelector(`button[aria-label="${label}"]`).click(); await wait(); };
  const set = async (selector, value) => {
    const input = document.querySelector(selector);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true })); await wait();
  };
  const names = () => rows().map(row => row.querySelector('.step-row__name').textContent);
  try {
    await wait();
    await clickRow(0, 'Copy');
    await clickRow(1, 'Copy');
    await clickRow(0, 'Copy');
    check('copies of copies and repeated copies remain visible as separate rows', rows().length === 4 && saved().length === 4);
    check('copying retains the original and every previous copy', names().join('|') === 'Original|Original (copy)|Original (copy) (copy)|Original (copy)' && saved()[0].trigger === 'f1' && saved().slice(1).every(hotkey => hotkey.trigger === ''));
    check('all copies preserve trigger-dependent actions', saved().every(hotkey => hotkey.behavior === saved()[0].behavior));
    await clickRow(2, 'Edit');
    check('editing a copy of a copy targets its own saved index', window.modal.index === 2 && document.querySelector('input[placeholder="Name"]').value === 'Original (copy) (copy)');
    await set('input[placeholder="Name"]', 'Edited second copy');
    await set('input[placeholder="Trigger"]', 'rctrl p');
    document.querySelector('button[aria-label="Save"]').click(); await wait();
    check('saving an edited copy preserves its siblings and assigns only its shortcut', saved()[2].name === 'Edited second copy' && saved()[2].trigger === 'rctrl p' && saved()[1].name === 'Original (copy)' && saved()[1].trigger === '' && saved()[3].trigger === '');
    const lastHandle = rows()[3].querySelector('.drag-handle');
    lastHandle.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowUp',bubbles:true})); await wait();
    check('unassigned copies reorder independently', saved()[2].trigger === '' && saved()[3].name === 'Edited second copy' && names()[3] === 'Edited second copy');
    await clickRow(2, 'Edit');
    check('editing a reordered unassigned copy uses its new position', window.modal.index === 2 && window.modal.hotkey.trigger === '');
    document.querySelector('button[aria-label="Cancel"]').click(); await wait();
    await clickRow(2, 'Delete');
    check('deleting an unassigned copy removes only the chosen row', rows().length === 3 && saved().length === 3 && saved()[1].trigger === '' && saved()[2].name === 'Edited second copy');
    document.querySelector('#reload').click(); await wait();
    check('reopening persisted settings retains every remaining copy', names().join('|') === 'Original|Original (copy)|Edited second copy' && saved()[2].trigger === 'rctrl p');
    check('copy operations report no errors', window.errors.length === 0);
    document.getElementById('results').textContent = JSON.stringify({results});
  } catch (error) { document.getElementById('results').textContent = JSON.stringify({results,error:error.message,stack:error.stack}); }
}

test('repeated hotkey copies can be edited, reordered, deleted, and reopened independently', {skip:!browser && 'Chrome or Edge is required'}, async t => {
  const mocks = ['./api','./AppConsole','./App.css','./CloudSettings','@tauri-apps/api/event','@tauri-apps/plugin-dialog','@tauri-apps/plugin-opener','@tauri-apps/plugin-notification'];
  const bundle = browserModules(['App.tsx'], {mocks,expose:{[join(root,'src/App.tsx')]:['ProfileEditor','HotkeyModal','copyName','triggerLabel','allowsExtraModifiers']}});
  const profile = {id:'profile',name:'Copies',kind:'hotkeys',armed:true,parent_id:null,hotkeys:[{name:'Original',trigger:'f1',behavior:JSON.stringify([{type:'press',key:{source:'trigger'},onRelease:true}]),state_id:null}],events:[],states:[],scripts:[],overlay_items:[],overlay_groups:[],overlay_triggers:[]};
  const initial = {version:7,settings:{},variables:[],scopes:[{id:'game',name:'Game',exe:'game.exe',states:[],profiles:[profile]}]};
  const harness = `const modules={${bundle.declarations}},cache={};window.errors=[];window.saved=${JSON.stringify(initial)};
function load(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;
if(id==='./api'){module.exports={api:{async upsertProfile(gameId,profile){window.saved={...window.snapshot,scopes:window.snapshot.scopes.map(scope=>scope.id===gameId?{...scope,profiles:scope.profiles.map(current=>current.id===profile.id?profile:current)}:scope)};return structuredClone(window.saved);}}};return module.exports;}
if(id==='./AppConsole'){module.exports={useErrorReporter:()=>error=>window.errors.push(String(error))};return module.exports;}
if(${JSON.stringify(mocks)}.includes(id))return module.exports;
const [code,dependencies]=modules[id];code(module,module.exports,name=>load(dependencies[name]),{env:{NODE_ENV:'production'}});return module.exports;}
const React=load(${JSON.stringify(bundle.react)}),ReactDOM=load(${JSON.stringify(bundle.client)}),{ProfileEditor,HotkeyModal,copyName,triggerLabel,allowsExtraModifiers}=load(${JSON.stringify(bundle.entry)}),{api}=load('./api');
function Fixture(){const [db,handleDb]=React.useState(window.saved),[modal,setModal]=React.useState(null),[revision,setRevision]=React.useState(0);window.snapshot=db;
const reportError=error=>window.errors.push(String(error)),carryStates=(_sourceGameId,_sourceProfileId,_targetGameId,profile)=>profile;
${handlerCode}
const folder=db.scopes[0],profile=folder.profiles[0];
const onModal=next=>{window.modal=next;if(next.type==='copyHotkey')void handleCopyHotkey(next.sourceGameId,next.sourceProfileId,next.hotkey,folder.id,profile.id);else setModal(next);};
return React.createElement(React.Fragment,null,React.createElement('button',{id:'reload',onClick:()=>{handleDb(structuredClone(window.saved));setRevision(revision+1);}},'Reload'),
React.createElement(ProfileEditor,{key:revision,folder,profile,variables:[],showStates:false,onContext(){},onDb:handleDb,onModal}),
modal?.type==='editHotkey'?React.createElement(HotkeyModal,{initial:modal.hotkey,gameExe:folder.exe,states:[],overlays:[],scripts:[],variables:[],onDb:handleDb,onClose:()=>setModal(null),onSave:(hotkey,secureTexts)=>handleHotkeySave(folder.id,profile.id,modal.index,hotkey,secureTexts)}):null);}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));(${scenario})();`;
  const logs = join(root,'logs'); mkdirSync(logs,{recursive:true});
  const directory = mkdtempSync(join(logs,'hotkey-copy-ui-'));
  let result;
  try {
    const page = join(directory,'copies.html');
    writeFileSync(page,`<!doctype html><style>${readFileSync(join(root,'src/App.css'),'utf8')}#results{position:absolute;left:-10000px}</style><div id="root"></div><pre id="results"></pre><script>${harness.replace(/<\/script/gi,'<\\/script')}</script>`);
    const output = execFileSync(browser,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${join(directory,'profile')}`,'--window-size=1200,1000','--virtual-time-budget=10000','--dump-dom',pathToFileURL(page).href],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
    const match = output.match(/<pre id="results">([^<]+)<\/pre>/);
    assert.ok(match,'browser did not complete hotkey copy checks');
    result = JSON.parse(match[1].replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));
  } finally { assert.equal(dirname(directory),logs); rmSync(directory,{recursive:true,force:true}); }
  for (const name of result.results) await t.test(name,()=>{});
  assert.equal(result.error,undefined,result.stack??result.error);
});
