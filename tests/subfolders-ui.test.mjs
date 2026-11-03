import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { root, browser, browserModules } from "./browserHarness.mjs";

async function scenario() {
  const results = [], wait = () => new Promise(resolve => setTimeout(resolve, 40));
  const get = selector => { const element = document.querySelector(selector); if (!element) throw Error(`Missing ${selector}`); return element; };
  const click = async selector => { get(selector).click(); await wait(); };
  const check = (name, value) => { if (!value) throw Error(name); results.push(name); };
  const set = async (selector, value) => {
    const input = get(selector), prototype = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', {bubbles:true})); await wait();
  };
  const folder = () => window.snapshot.scopes[0];
  const group = () => folder().subfolders[0];
  const rows = () => [...get('.folder-group').querySelectorAll('.profile-row')];
  const subfolder = name => [...document.querySelectorAll('.profile-subfolder')].find(element => element.querySelector('.folder-group__name').textContent === name);
  const handle = name => get(`.drag-handle[aria-label="Move ${name}"]`);
  async function drag(source, target, {after = false, drop = true} = {}) {
    const transfer = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', {bubbles:true,dataTransfer:transfer})); await wait();
    const bounds = target.getBoundingClientRect(), clientY = after ? bounds.bottom - 1 : bounds.top + 1;
    target.dispatchEvent(new DragEvent('dragover', {bubbles:true,cancelable:true,dataTransfer:transfer,clientY})); await wait();
    const marker = target.dataset.drop ?? target.dataset.profileDrop;
    if (drop) target.dispatchEvent(new DragEvent('drop', {bubbles:true,cancelable:true,dataTransfer:transfer,clientY}));
    source.dispatchEvent(new DragEvent('dragend', {bubbles:true,dataTransfer:transfer})); await wait();
    return marker;
  }
  try {
    await wait();
    await click('[aria-label="Folder settings"]');
    check('app folders expose the same settings icon as subfolders', window.lastModal.type === 'editGame' && window.lastModal.game.id === folder().id);
    await click('[aria-label="New subfolder"]');
    check('an unnamed subfolder cannot be saved', get('[aria-label="Save"]').disabled);
    await set('[placeholder="Subfolder name"]', 'Combat');
    await set('[placeholder="Toggle-subfolder key"]', 'rctrl shift n');
    window.failSave = true;
    await click('[aria-label="Save"]');
    check('failed subfolder saves retain the draft without changing settings', !folder().subfolders.length && get('[placeholder="Subfolder name"]').value === 'Combat' && window.errors.length === 1);
    window.failSave = false;
    await click('[aria-label="Save"]');
    check('subfolders save their name, shortcut, and initial enabled state', group().name === 'Combat' && group().toggle_key === 'rctrl shift n' && group().enabled && get('.profile-subfolder .folder-group__name').textContent === 'Combat');
    check('subfolders appear above profiles immediately after creation', !!(get('.folder-group__subfolders').compareDocumentPosition(get('.folder-group > .folder-group__profiles')) & Node.DOCUMENT_POSITION_FOLLOWING));
    await click('[aria-label="New subfolder"]');
    await set('[placeholder="Subfolder name"]', 'Utility');
    await click('[aria-label="Save"]');
    check('new subfolders are inserted at the top of their own list', folder().subfolders.map(group => group.name).join(',') === 'Utility,Combat' && get('.profile-subfolder .folder-group__name').textContent === 'Utility');
    const insertion = await drag(handle('Combat'), handle('Utility').closest('.sortable-item'));
    check('subfolders drag between other subfolders and persist their order', insertion === 'before' && folder().subfolders.map(group => group.name).join(',') === 'Combat,Utility');
    window.failSave = true;
    await drag(handle('Utility'), handle('Combat').closest('.sortable-item'));
    window.failSave = false;
    check('failed subfolder reordering keeps the saved order and clears drag feedback', folder().subfolders.map(group => group.name).join(',') === 'Combat,Utility' && window.errors.length === 2 && !document.querySelector('[data-drop]'));
    handle('Utility').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowUp',bubbles:true})); await wait();
    check('subfolder handles also support keyboard ordering', folder().subfolders[0].name === 'Utility');
    handle('Utility').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown',bubbles:true})); await wait();
    await click('#profile-settings');
    await set('[aria-label="Subfolder"]', group().id);
    await click('[aria-label="Save"]');
    check('existing profiles can move into a subfolder without changing their activation', folder().profiles[0].subfolder_id === group().id && folder().profiles[0].armed && document.querySelectorAll('.profile-subfolder .profile-row').length === 1);
    await click('.profile-subfolder [aria-label="New profile"]');
    check('new profiles opened from a subfolder inherit its membership', get('[aria-label="Subfolder"]').value === group().id);
    await set('[placeholder="Profile name"]', 'Child');
    await click('[aria-label="Save"]');
    check('new profiles retain their own initial disabled state inside the group', folder().profiles[2].subfolder_id === group().id && !folder().profiles[2].armed);
    const callsBeforeForeign = window.saveCalls.length;
    await drag(handle('Foreign'), subfolder('Combat').querySelector('.folder-group__head-row'));
    check('profile drops cannot move profiles from another app folder', window.saveCalls.length === callsBeforeForeign && !window.snapshot.scopes[1].profiles[0].subfolder_id);
    const beforeMove = JSON.stringify(folder().profiles[0]);
    const targetMarker = await drag(handle('Main').closest('.sortable-item').querySelector('.profile-row'), subfolder('Utility').querySelector('.folder-group__head-row'));
    check('whole profile rows drag into empty subfolders with a destination highlight', targetMarker === 'true' && folder().profiles[0].subfolder_id === folder().subfolders[1].id && subfolder('Utility').querySelectorAll('.profile-row').length === 1);
    check('dragging a profile changes only its subfolder membership', JSON.stringify({...folder().profiles[0],subfolder_id:group().id}) === beforeMove);
    await click('.profile-subfolder .folder-group__head');
    await drag(handle('Main'), subfolder('Combat').querySelector('.folder-group__head-row'));
    check('profiles can move into a collapsed subfolder without changing its collapsed state', folder().profiles[0].subfolder_id === group().id && !subfolder('Combat').querySelector('.profile-row'));
    await click('.profile-subfolder .folder-group__head');
    await drag(handle('Child'), subfolder('Utility').querySelector('.folder-group__head-row'));
    check('a single profile still has a handle for leaving its subfolder', !!subfolder('Combat').querySelector('.drag-handle[aria-label="Move Main"]'));
    await drag(handle('Main'), get('.folder-group > .folder-group__head-row'));
    check('profiles can be dragged back to the app-folder header', folder().profiles[0].subfolder_id === null && subfolder('Combat').querySelectorAll('.profile-row').length === 0 && folder().profiles[0].armed);
    await drag(handle('Main'), subfolder('Combat').querySelector('.folder-group__head-row'));
    await drag(handle('Child'), subfolder('Combat').querySelector('.folder-group__head-row'));
    check('a one-profile source can move between subfolders while retaining its disabled state', folder().profiles[2].subfolder_id === group().id && !folder().profiles[2].armed);
    const callsBeforeCancel = window.saveCalls.length;
    await drag(handle('Other'), subfolder('Combat').querySelector('.folder-group__head-row'), {drop:false});
    check('canceling a profile drag clears its target without saving', window.saveCalls.length === callsBeforeCancel && !folder().profiles[1].subfolder_id && !document.querySelector('[data-profile-drop]'));
    window.failSave = true;
    await drag(handle('Other'), subfolder('Combat').querySelector('.folder-group__head-row'));
    window.failSave = false;
    check('failed profile moves retain membership and allow another drag', !folder().profiles[1].subfolder_id && window.errors.length === 3 && handle('Other').draggable && !document.querySelector('[data-profile-drop]'));
    await click('[aria-label="Subfolder enabled"]');
    check('disabling a subfolder leaves individual profile choices and unrelated profiles unchanged', !group().enabled && folder().profiles[0].armed && !folder().profiles[2].armed && folder().profiles[1].armed && [...document.querySelectorAll('.profile-subfolder input[aria-label="Profile enabled"]')].every(input => !input.checked) && rows().find(row => row.textContent === 'Other').querySelector('input').checked);
    await click('#reload');
    check('subfolder membership, shortcuts, and disabled state survive reopening', !get('[aria-label="Subfolder enabled"]').checked && group().toggle_key === 'rctrl shift n' && document.querySelectorAll('.profile-subfolder .profile-row').length === 2);
    check('reopening preserves subfolder order above ungrouped profiles', folder().subfolders.map(group => group.name).join(',') === 'Combat,Utility' && !!(get('.folder-group__subfolders').compareDocumentPosition(get('.folder-group > .folder-group__profiles')) & Node.DOCUMENT_POSITION_FOLLOWING));
    await click('[aria-label="Subfolder enabled"]');
    check('reenabling a group restores only its individually enabled profiles', get('.profile-subfolder .profile-row input').checked && !document.querySelectorAll('.profile-subfolder .profile-row input')[1].checked);
    const imported = await window.roundtrip();
    const copy = imported.scopes[0];
    check('folder export and import preserve the group and remap all memberships together', copy.subfolders[0].id !== group().id && copy.subfolders[0].toggle_key === 'rctrl shift n' && copy.profiles[0].subfolder_id === copy.subfolders[0].id && copy.profiles[2].subfolder_id === copy.subfolders[0].id && !copy.profiles[1].subfolder_id);
    check('copying a single profile detaches it from the source subfolder', window.copyProfile(folder().profiles[0]).subfolder_id === null);
    await click('.profile-subfolder .folder-group__head');
    check('collapsing a subfolder only hides its rows', !document.querySelector('.profile-subfolder .profile-row') && group().enabled && folder().profiles[0].armed);
    await click('.profile-subfolder .folder-group__head');
    const bounds = get('.library').getBoundingClientRect();
    check('subfolder controls fit the existing sidebar width', [...get('.profile-subfolder').querySelectorAll('button,input')].every(control => { const rect = control.getBoundingClientRect(); return rect.left >= bounds.left && rect.right <= bounds.right; }));
    await click('[aria-label="Subfolder settings"]');
    await set('[placeholder="Subfolder name"]', 'Renamed');
    await set('[placeholder="Toggle-subfolder key"]', 'rctrl f2');
    await click('[aria-label="Save"]');
    check('subfolder edits preserve profile membership', group().name === 'Renamed' && group().toggle_key === 'rctrl f2' && folder().profiles[0].subfolder_id === group().id);
    await click('[aria-label="Subfolder settings"]');
    await click('[aria-label="Delete subfolder"]');
    check('deleting a subfolder keeps all profiles and other subfolders intact', folder().subfolders.length === 1 && group().name === 'Utility' && folder().profiles.length === 3 && folder().profiles.every(profile => !profile.subfolder_id) && folder().profiles[0].armed && !folder().profiles[2].armed && rows().length === 3);
    document.getElementById('results').textContent = JSON.stringify({results});
  } catch (error) { document.getElementById('results').textContent = JSON.stringify({results,error:error.message,stack:error.stack}); }
}

test('app subfolders preserve profile choices through creation, grouping, switching, reopening and import', {skip:!browser && 'Chrome or Edge is required'}, async t => {
  const mocks = ['./api','./AppConsole','./App.css','./CloudSettings','@tauri-apps/api/event','@tauri-apps/plugin-dialog','@tauri-apps/plugin-opener','@tauri-apps/plugin-notification'];
  const bundle = browserModules(['App.tsx'], {mocks,expose:{[join(root,'src/App.tsx')]:['Library','SubfolderModal','ProfileSettingsModal','exportScope','importScope','remapProfileIds']}});
  const profile = (id,name) => ({id,name,kind:'hotkeys',armed:true,parent_id:null,hotkeys:[],events:[],states:[],scripts:[],overlay_items:[],overlay_groups:[],overlay_triggers:[],toggle_hotkeys_key:null,toggle_overlay_key:null});
  const initial = {version:8,settings:{},variables:[],scopes:[{id:'game',name:'Game',exe:'game.exe',states:[],subfolders:[],profiles:[{...profile('main','Main'),hotkeys:[{name:'Behavior',trigger:'f1',behavior:'press(x)',state_id:null}]},profile('other','Other')]},{id:'foreign',name:'Foreign app',exe:'foreign.exe',states:[],subfolders:[],profiles:[profile('foreign-profile','Foreign')]}]};
  const harness = `const modules={${bundle.declarations}},cache={};window.errors=[];window.saveCalls=[];window.saved=${JSON.stringify(initial)};
function load(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;
if(id==='./api'){module.exports={api:{async upsertGame(folder){window.saveCalls.push(structuredClone(folder));if(window.failSave)throw Error('simulated save failure');window.saved={...window.snapshot,scopes:window.snapshot.scopes.map(current=>current.id===folder.id?folder:current)};return structuredClone(window.saved);},async upsertProfile(id,profile){const folder=window.snapshot.scopes.find(folder=>folder.id===id);return this.upsertGame({...folder,profiles:folder.profiles.some(current=>current.id===profile.id)?folder.profiles.map(current=>current.id===profile.id?profile:current):[...folder.profiles,profile]});},async setSubfolderEnabled(id,subfolderId,enabled){const folder=window.snapshot.scopes.find(folder=>folder.id===id);return this.upsertGame({...folder,subfolders:folder.subfolders.map(group=>group.id===subfolderId?{...group,enabled}:group)});},async writeTextFile(path,text){window.exported=text;},async readTextFile(){return window.exported;}}};return module.exports;}
if(id==='./AppConsole'){module.exports={useErrorReporter:()=>error=>window.errors.push(String(error))};return module.exports;}
if(id==='@tauri-apps/plugin-dialog'){module.exports={open:async()=>'/fixture.hkm-scope',save:async()=>'/fixture.hkm-scope'};return module.exports;}
if(${JSON.stringify(mocks)}.includes(id))return module.exports;
const [code,dependencies]=modules[id];code(module,module.exports,name=>load(dependencies[name]),{env:{NODE_ENV:'production'}});return module.exports;}
const React=load(${JSON.stringify(bundle.react)}),ReactDOM=load(${JSON.stringify(bundle.client)}),{Library,SubfolderModal,ProfileSettingsModal,exportScope,importScope,remapProfileIds}=load(${JSON.stringify(bundle.entry)}),{api}=load('./api');
function Fixture(){const [db,onDb]=React.useState(window.saved),[modal,setModal]=React.useState(null),[revision,setRevision]=React.useState(0);window.snapshot=db;const folder=db.scopes[0];window.roundtrip=async()=>{await exportScope(folder,db.variables);return importScope(db.variables);};window.copyProfile=remapProfileIds;
const onSaveGroup=async group=>onDb(await api.upsertGame({...folder,subfolders:folder.subfolders.some(current=>current.id===group.id)?folder.subfolders.map(current=>current.id===group.id?group:current):[group,...folder.subfolders]}));
return React.createElement(React.Fragment,null,React.createElement('button',{id:'profile-settings',onClick:()=>setModal({type:'profileSettings',profile:folder.profiles[0],isNew:false})},'Profile settings'),React.createElement('button',{id:'reload',onClick:()=>{onDb(structuredClone(window.saved));setRevision(revision+1);}},'Reload'),
React.createElement(Library,{key:revision,db,disabledProfiles:new Set(),openExes:new Set(['game.exe']),selection:{kind:'profile',folderId:'game',profileId:'main'},query:'',collapsed:new Set(),width:300,onQuery(){},onToggleCollapse(){},onSelect(){},onToggleArmed(){},onProfileContext(){},onFolderContext(){},onDb,onModal:next=>{window.lastModal=next;setModal(next);}}),
modal?.type==='subfolder'?React.createElement(SubfolderModal,{initial:modal.folder,onSave:onSaveGroup,onClose:()=>setModal(null),onDelete:folder.subfolders.some(group=>group.id===modal.folder.id)?async()=>onDb(await api.upsertGame({...folder,subfolders:folder.subfolders.filter(group=>group.id!==modal.folder.id),profiles:folder.profiles.map(profile=>profile.subfolder_id===modal.folder.id?{...profile,subfolder_id:null}:profile)})):undefined}):modal?.type==='profileSettings'?React.createElement(ProfileSettingsModal,{initial:modal.profile,isNew:modal.isNew,subfolders:folder.subfolders,onClose:()=>setModal(null),onSave:async profile=>{onDb(await api.upsertProfile(folder.id,profile));setModal(null);}}):null);}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));(${scenario})();`;
  const logs = join(root,'logs'); mkdirSync(logs,{recursive:true});
  const directory = mkdtempSync(join(logs,'subfolders-ui-'));
  let result;
  try {
    const page = join(directory,'subfolders.html');
    writeFileSync(page,`<!doctype html><style>${readFileSync(join(root,'src/App.css'),'utf8')}#results{position:absolute;left:-10000px}</style><div id="root"></div><pre id="results"></pre><script>${harness.replace(/<\/script/gi,'<\\/script')}</script>`);
    const output = execFileSync(browser,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${join(directory,'profile')}`,'--window-size=1000,1100','--virtual-time-budget=10000','--dump-dom',pathToFileURL(page).href],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
    const match = output.match(/<pre id="results">([^<]+)<\/pre>/); assert.ok(match,'browser did not complete subfolder checks');
    result = JSON.parse(match[1].replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));
  } finally { assert.equal(dirname(directory),logs); rmSync(directory,{recursive:true,force:true}); }
  for (const name of result.results) await t.test(name,()=>{});
  assert.equal(result.error,undefined,result.stack??result.error);
});
