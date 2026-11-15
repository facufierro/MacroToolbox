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
  const profile = () => window.snapshot.scopes[0].profiles[0];
  const overlayId = hotkey => JSON.parse(hotkey.behavior)[1].itemIds[0];
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
    check('all copies preserve trigger-dependent actions', saved().every(hotkey => JSON.stringify(JSON.parse(hotkey.behavior)[0]) === JSON.stringify(JSON.parse(saved()[0].behavior)[0])));
    check('copies and copies of copies own distinct overlays and parts', new Set(saved().map(overlayId)).size === 4 && profile().overlay_groups.length === 4 && profile().overlay_items.length === 8);
    await clickRow(2, 'Edit');
    check('editing a copy of a copy targets its own saved index', window.modal.index === 2 && document.querySelector('input[placeholder="Name"]').value === 'Original (copy) (copy)');
    await set('input[placeholder="Name"]', 'Edited second copy');
    await set('input[placeholder="Trigger"]', 'rctrl p');
    document.querySelector('button[aria-label="Edit overlay"]').click(); await wait();
    await set('[aria-label="Overlay name"]', 'Independent copy');
    const overlay = document.querySelector('.behavior-overlay-editor');
    overlay.querySelector('.overlay-type-badge--timer').closest('.overlay-item-row').querySelector('.overlay-item-row__open').click(); await wait();
    await set('[aria-label="Seconds"]', '12');
    [...overlay.querySelectorAll('button')].find(button => button.textContent.trim() === 'Save').click(); await wait();
    [...overlay.querySelectorAll('button')].find(button => button.textContent.trim() === 'Save overlay').click(); await wait();
    document.querySelector('button[aria-label="Save"]').click(); await wait();
    check('saving an edited copy preserves its siblings and assigns only its shortcut', saved()[2].name === 'Edited second copy' && saved()[2].trigger === 'rctrl p' && saved()[1].name === 'Original (copy)' && saved()[1].trigger === '' && saved()[3].trigger === '');
    check('editing a copied overlay leaves every sibling overlay unchanged', saved().every((hotkey,index) => {
      const id = overlayId(hotkey), group = profile().overlay_groups.find(group => group.id === id), timer = profile().overlay_items.find(item => item.group_id === id && item.type === 'timer');
      return index === 2 ? group.name === 'Independent copy' && timer.duration_ms === 12000 : group.name !== 'Independent copy' && timer.duration_ms === 10000;
    }));
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
    check('reopening keeps the edited copy attached to its own overlay', profile().overlay_groups.find(group => group.id === overlayId(saved()[2])).name === 'Independent copy' && profile().overlay_items.find(item => item.id === 'timer').duration_ms === 10000);
    await window.copyTo('other-game','destination'); await wait();
    const destination = window.snapshot.scopes[1].profiles[0];
    check('copying to another folder also creates independent overlay definitions', destination.hotkeys.length === 1 && destination.hotkeys[0].trigger === 'f1' && destination.overlay_groups.length === 1 && destination.overlay_items.length === 2 && !profile().overlay_groups.some(group => group.id === overlayId(destination.hotkeys[0])));
    const beforeFailure = JSON.stringify(window.snapshot);
    window.failSave = true;
    await window.copyTo('game','profile'); await wait();
    window.failSave = false;
    check('a failed copy saves neither an orphan overlay nor a partial behavior', JSON.stringify(window.snapshot) === beforeFailure && window.errors.length === 1);
    window.errors.length = 0;
    window.saved = structuredClone(window.snapshot);
    const oldCopy = window.saved.scopes[0].profiles[0].hotkeys[1];
    const oldSteps = JSON.parse(oldCopy.behavior); oldSteps[1].itemIds = ['group']; oldCopy.behavior = JSON.stringify(oldSteps);
    document.querySelector('#reload').click(); await wait();
    await clickRow(1, 'Edit');
    await set('input[placeholder="Trigger"]', 'f2');
    document.querySelector('button[aria-label="Edit overlay"]').click(); await wait();
    document.querySelector('button[aria-label="Duplicate overlay"]').click(); await wait();
    await set('[aria-label="Overlay name"]', 'Separated old copy');
    [...document.querySelector('.behavior-overlay-editor').querySelectorAll('button')].find(button => button.textContent.trim() === 'Save overlay').click(); await wait();
    document.querySelector('button[aria-label="Save"]').click(); await wait();
    check('Duplicate overlay creates a separate group draft', document.querySelector('[aria-label="Overlay name"]') === null && profile().overlay_groups.some(group => group.name === 'Separated old copy'));
    check('Duplicate overlay separates an existing linked copy without modifying the original', overlayId(saved()[1]) !== 'group' && profile().overlay_groups.find(group => group.id === overlayId(saved()[1])).name === 'Separated old copy' && profile().overlay_groups.find(group => group.id === 'group').name === 'Buff' && profile().overlay_items.find(item => item.id === 'timer').duration_ms === 10000);
    check('copy operations report no errors', window.errors.length === 0);
    document.getElementById('results').textContent = JSON.stringify({results});
  } catch (error) { document.getElementById('results').textContent = JSON.stringify({results,error:error.message,stack:error.stack}); }
}

test('repeated hotkey copies can be edited, reordered, deleted, and reopened independently', {skip:!browser && 'Chrome or Edge is required'}, async t => {
  const mocks = ['./api','./AppConsole','./App.css','./CloudSettings','@tauri-apps/api/event','@tauri-apps/plugin-dialog','@tauri-apps/plugin-opener','@tauri-apps/plugin-notification'];
  const bundle = browserModules(['App.tsx'], {mocks,expose:{[join(root,'src/App.tsx')]:['ProfileEditor','HotkeyModal','copyName','triggerLabel','allowsExtraModifiers','uid','blankProfile','transferVariables']}});
  const profile = {id:'profile',name:'Copies',kind:'hotkeys',armed:true,parent_id:null,hotkeys:[{name:'Original',trigger:'f1',behavior:JSON.stringify([{type:'press',key:{source:'trigger'},onRelease:true},{type:'startoverlay',itemIds:['group'],restart:true}]),state_id:null}],events:[],states:[],scripts:[],overlay_items:[{type:'timer',id:'timer',group_id:'group',name:'Timer',x:0,y:0,duration_ms:10000,color:'#ffffff',font_size:22,state_id:null,timer_state_id:null,start_with_overlay:true},{type:'icon',id:'icon',group_id:'group',visible_while_timer_id:'timer',name:'Icon',x:0,y:0,w:32,h:32,src:null,state_id:null}],overlay_groups:[{id:'group',name:'Buff',x:20,y:30,layout:'row',gap:8,visible_while_timer_id:'timer'}],overlay_triggers:[]};
  const initial = {version:14,settings:{},variables:[],scopes:[{id:'game',name:'Game',exe:'game.exe',states:[],profiles:[profile]},{id:'other-game',name:'Other',exe:'other.exe',states:[],profiles:[{...profile,id:'destination',hotkeys:[],overlay_items:[],overlay_groups:[]}]}]};
  for (const scope of initial.scopes) scope.variables = [];
  delete initial.variables;
  const harness = `const modules={${bundle.declarations}},cache={};window.errors=[];window.reportError=error=>window.errors.push(String(error));window.saved=${JSON.stringify(initial)};
function load(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;
if(id==='./api'){module.exports={api:{async getDatabase(){return structuredClone(window.snapshot);},async upsertGame(folder){window.saved={...window.snapshot,scopes:window.snapshot.scopes.map(scope=>scope.id===folder.id?folder:scope)};return structuredClone(window.saved);},async upsertProfile(gameId,profile){if(window.failSave)throw Error('fixture save failure');window.saved={...window.snapshot,scopes:window.snapshot.scopes.map(scope=>scope.id===gameId?{...scope,profiles:scope.profiles.map(current=>current.id===profile.id?profile:current)}:scope)};return structuredClone(window.saved);}}};return module.exports;}
if(id==='./AppConsole'){module.exports={useErrorReporter:()=>window.reportError};return module.exports;}
if(${JSON.stringify(mocks)}.includes(id))return module.exports;
const [code,dependencies]=modules[id];code(module,module.exports,name=>load(dependencies[name]),{env:{NODE_ENV:'production'}});return module.exports;}
const React=load(${JSON.stringify(bundle.react)}),ReactDOM=load(${JSON.stringify(bundle.client)}),{ProfileEditor,HotkeyModal,copyName,triggerLabel,allowsExtraModifiers,uid,blankProfile,transferVariables}=load(${JSON.stringify(bundle.entry)}),{api}=load('./api'),{duplicateBehaviorOverlays,availableOverlayTargets}=load(${JSON.stringify(join(root,'src/overlayItems.ts'))});
function Fixture(){const [db,handleDb]=React.useState(window.saved),[modal,setModal]=React.useState(null),[revision,setRevision]=React.useState(0);window.snapshot=db;
const reportError=error=>window.errors.push(String(error)),carryStates=(_sourceGameId,_sourceProfileId,_targetGameId,profile)=>profile;
${handlerCode}
const folder=db.scopes[0],profile=folder.profiles[0];
window.copyTo=(gameId,profileId)=>handleCopyHotkey(folder.id,profile.id,profile.hotkeys[0],gameId,profileId);
const onModal=next=>{window.modal=next;if(next.type==='copyHotkey')void handleCopyHotkey(next.sourceGameId,next.sourceProfileId,next.hotkey,folder.id,profile.id);else setModal(next);};
return React.createElement(React.Fragment,null,React.createElement('button',{id:'reload',onClick:()=>{handleDb(structuredClone(window.saved));setRevision(revision+1);}},'Reload'),
React.createElement(ProfileEditor,{key:revision,folder,profile,variables:[],showStates:false,onContext(){},onDb:handleDb,onModal}),
modal?.type==='editHotkey'?React.createElement(HotkeyModal,{folderId:folder.id,initial:modal.hotkey,gameExe:folder.exe,states:[],overlayProfileId:profile.id,overlays:availableOverlayTargets(folder.profiles,[]),scripts:[],variables:[],onDb:handleDb,onClose:()=>setModal(null),onSave:(hotkey,secureTexts)=>handleHotkeySave(folder.id,profile.id,modal.index,hotkey,secureTexts)}):null);}
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
