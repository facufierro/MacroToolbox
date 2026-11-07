import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { root, browser, browserModules } from "./browserHarness.mjs";

const profile = { id: "profile", name: "Protection", kind: "overlay", armed: false, parent_id: null,
  hotkeys: [], events: [], scripts: [], states: [], overlay_triggers: [],
  overlay_groups: [{ id: "magic", name: "Magic Protection", layout: "row", x: 10, y: 20, gap: 8 }, { id: "other", name: "Resources", layout: "column", x: 50, y: 50, gap: 4 }],
  overlay_items: [
    { id: "timer", type: "timer", name: "", group_id: "magic", x: 0, y: 0, state_id: null, duration_ms: 65000, color: "#ffffff", font_size: 22, show_background: false, timer_state_id: "buff", start_with_overlay: true, show_only_running: true },
    { id: "icon", type: "icon", name: "", group_id: "magic", x: 5, y: 8, state_id: "buff", w: 64, h: 64, src: null },
    { id: "bar", type: "bar", name: "", group_id: "magic", x: 0, y: 0, state_id: null, w: 200, h: 20, color: "#4ade80", max_value: 100 },
    { id: "text", type: "text", name: "", group_id: "other", x: 0, y: 0, state_id: null, content: "MP", font_size: 16, color: "#ffffff" },
  ] };

async function scenario(empty) {
  const results = [], wait = () => new Promise(resolve => setTimeout(resolve, 40));
  const check = (name, value) => { if (!value) throw Error(name); results.push(name); };
  const group = () => document.querySelector('.behavior-overlay-editor');
  const own = () => window.snapshot.db.scopes[0].profiles[0];
  const field = (container, label) => container.querySelector(`[aria-label="${label}"]`);
  const button = (container, label) => [...container.querySelectorAll('button')].find(element => element.getAttribute('aria-label') === label || element.textContent.trim() === label);
  const click = async element => { if (!element) throw Error('Missing button'); element.click(); await wait(); };
  async function set(element, value) {
    if (!element) throw Error('Missing field');
    Object.getOwnPropertyDescriptor(element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', {bubbles:true})); await wait();
  }
  const form = () => group().querySelector('.overlay-part-editor');
  const edit = async type => click(group().querySelector(`.overlay-type-badge--${type}`).closest('.overlay-item-row').querySelector('.overlay-item-row__open'));
  const fits = container => [...container.querySelectorAll('input,select,button')].filter(element => element.getClientRects().length).every(element => {
    const rect = element.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.width > 10;
  });
  try {
    await wait();
    check('profiles no longer have an Overlays section, Add overlay button, or separate group editor', ![...document.querySelectorAll('.section-toggle h3')].some(element => element.textContent === 'Overlays') && !document.querySelector('[aria-label="Add overlay"],.overlay-group'));
    check('existing overlay profiles open Hotkeys for the replacement workflow', [...document.querySelectorAll('.section-toggle')].find(element => element.querySelector('h3').textContent === 'Hotkeys').getAttribute('aria-expanded') === 'true');
    check('removing the section leaves every saved group and part unchanged', own().overlay_groups.length === 2 && own().overlay_items.length === 4 && window.saveCalls === 0 && fits(document.querySelector('.editor')));
    if (empty) { document.getElementById('results').textContent = JSON.stringify({results}); return; }
    await click(button(document, 'Profile settings'));
    check('the existing profile-wide overlay switch remains available in Profile settings', [...document.querySelectorAll('.modal label')].some(element => element.textContent.trim() === 'Show overlay'));
    await click(button(document.querySelector('.modal'), 'Cancel'));
    await click(button(document, 'Add hotkey'));
    await set(document.querySelector('[aria-label="Trigger"]'), 'q');
    await click(document.querySelector('[aria-label="Delete step"]'));
    await click(button(document.querySelector('.modal'), 'Add action'));
    await click(button(document.querySelector('.action-picker'), 'Overlay'));
    check('adding Overlay opens a new group directly without a New overlay button', field(group(),'Overlay name').value === 'Overlay' && !button(document,'New overlay'));
    const targets = document.querySelector('.step-row--overlay .overlay-targets');
    await click(targets.querySelector('summary'));
    await click([...targets.querySelectorAll('label')].find(label => label.textContent === 'Magic Protection').querySelector('input'));
    await click(targets.querySelector('summary'));
    await click(button(document, 'Edit overlay'));
    check('saved groups without a behavior remain editable through the replacement Overlay action', field(group(),'Overlay name').value === 'Magic Protection' && group().querySelectorAll('.overlay-item-row').length === 3);
    check('the replacement reuses compact settings and derived part names', group().querySelector('.overlay-group__config').getBoundingClientRect().height <= 70 && group().querySelector('.overlay-type-badge--timer').textContent === 'Timer 0' && group().querySelector('.overlay-type-badge--timer').title === 'Magic Protection Timer 0');
    await set(field(group(),'Arrange parts'), 'column'); await set(field(group(),'Gap (px)'), '12');
    await click(button(group(),'Cancel overlay'));
    await click(button(document,'Edit overlay'));
    check('Cancel restores the saved group without modifying its parts', field(group(),'Arrange parts').value === 'row' && field(group(),'Gap (px)').value === '8' && window.saveCalls === 0);
    await click(group().querySelector('.overlay-group__position [aria-label="Pick position"]'));
    await edit('timer'); await set(field(form(),'Seconds'),'45'); await set(field(form(),'Timer color'),'#aabbcc');
    check('competing part edits cannot replace an open draft', button(group(),'Add part').disabled && button(group(),'Duplicate overlay').disabled && [...group().querySelectorAll('button.overlay-item-row__open')].filter(element => element.getAttribute('aria-expanded') !== 'true').every(element => element.disabled));
    await click(button(form(),'Save'));
    check('part edits stay in the group draft until Save overlay', own().overlay_items[0].duration_ms === 65000 && window.saveCalls === 0);
    window.failSave = true; await click(button(group(),'Save overlay'));
    check('failed saves retain group settings and configured parts', field(group(),'X (%)').value === '25' && own().overlay_items[0].duration_ms === 65000 && window.errors.length === 1);
    window.failSave = false; window.holdSave = true; await click(button(group(),'Save overlay'));
    check('pending group saves lock controls and the behavior Save button', field(group(),'Overlay name').matches(':disabled') && button(group(),'Cancel overlay').matches(':disabled') && document.querySelector('.modal__actions [aria-label="Save"]').disabled);
    window.finishSave(); await wait();
    const timer = own().overlay_items.find(item => item.id === 'timer');
    check('saved timer edits preserve identity, source, visibility, and appearance flags', timer.duration_ms === 105000 && timer.color === '#aabbcc' && timer.timer_state_id === 'buff' && timer.start_with_overlay && timer.show_only_running && !timer.show_background && own().overlay_groups[0].x === 25);
    await click(button(document,'Edit overlay')); await set(field(group(),'Arrange parts'),'free');
    await edit('icon'); await click(button(form(),'Choose image')); await set(field(form(),'Width (px)'),'96'); await set(field(form(),'Height (px)'),'80');
    await click(form().querySelector('[aria-label="Pick position"]')); await click(button(form(),'Save')); await click(button(group(),'Save overlay'));
    const icon = own().overlay_items.find(item => item.id === 'icon');
    check('image selection, dimensions, and individual positions save through the behavior', icon.w === 96 && icon.h === 80 && icon.x === 25 && icon.y === 40 && icon.src.startsWith('data:image/') && icon.state_id === 'buff');
    await click(button(document,'Edit overlay')); await edit('bar'); await set(field(form(),'Maximum value'),'250'); await click(button(form(),'Save')); await click(button(group(),'Save overlay'));
    check('bar editing retains its existing dimensions and identity', own().overlay_items.find(item => item.id === 'bar').max_value === 250 && own().overlay_items.find(item => item.id === 'bar').w === 200);
    await click(document.querySelector('.modal__actions [aria-label="Save"]'));
    check('the behavior saves a group reference while the profile stays free of the removed section', !document.querySelector('.modal') && JSON.parse(own().hotkeys[0].behavior)[0].itemIds.join() === 'magic' && !document.querySelector('.overlay-group'));
    await click(document.querySelector('.editor [aria-label="Edit"]'));
    await click(button(document,'Edit overlay')); await edit('timer');
    check('reopening retains the complete configured group within the behavior', field(form(),'Seconds').value === '45' && group().querySelectorAll('.overlay-item-row').length === 3 && fits(document.querySelector('.modal')));
    document.getElementById('results').textContent = JSON.stringify({results});
  } catch(error) { document.getElementById('results').textContent = JSON.stringify({results,error:error.message,stack:error.stack}); }
}

test('Overlay behaviors replace the separate section and preserve saved group editing', {skip:!browser && 'Chrome or Edge is required'}, async t => {
  const mocks = ['./api','./AppConsole','./App.css','./CloudSettings','@tauri-apps/api/event','@tauri-apps/plugin-dialog','@tauri-apps/plugin-opener','@tauri-apps/plugin-notification'];
  const bundle = browserModules(['App.tsx'], {mocks, expose:{[join(root,'src/App.tsx')]:['ProfileEditor','HotkeyModal','ProfileSettingsModal']}});
  const initial = {version:7,settings:{},variables:[],scopes:[{id:'game',name:'Game',exe:'game.exe',states:[{id:'buff',name:'Magic Protection',duration_ms:10000}],profiles:[profile]}]};
  const harness = `const modules={${bundle.declarations}},cache={};window.errors=[];window.saveCalls=0;window.reportError=error=>window.errors.push(String(error));
const updateProfile=profile=>({...window.snapshot.db,scopes:window.snapshot.db.scopes.map(scope=>({...scope,profiles:scope.profiles.map(current=>current.id===profile.id?profile:current)}))});
function load(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;
if(id==='./api'){module.exports={api:{async getDatabase(){return structuredClone(window.snapshot.db);},async upsertProfile(folder,profile){if(window.failSave)throw Error('fixture failure');window.saveCalls++;if(window.holdSave)await new Promise(resolve=>{window.finishSave=()=>{window.holdSave=false;resolve();};});return updateProfile(profile);},async upsertGame(folder){if(window.failSave)throw Error('fixture failure');if(window.holdSave)await new Promise(resolve=>{window.finishSave=()=>{window.holdSave=false;resolve();};});window.saveCalls++;return {...window.snapshot.db,scopes:[folder]};},async setProfilePartEnabled(id,part,enabled,groupId){const profile=window.snapshot.db.scopes[0].profiles[0];return updateProfile({...profile,overlay_groups:profile.overlay_groups.map(group=>group.id===groupId?{...group,disabled:!enabled}:group)});},async pickCoordinate(){return [25,40];},async readImageAsDataUrl(){return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="20" height="20"%3E%3Crect width="20" height="20" fill="violet"/%3E%3C/svg%3E';}}};return module.exports;}
if(id==='./AppConsole'){module.exports={useErrorReporter:()=>window.reportError};return module.exports;}
if(id==='@tauri-apps/plugin-dialog'){module.exports={open:async()=> 'fixture.png',confirm:async()=>true};return module.exports;}
if(${JSON.stringify(mocks)}.includes(id))return module.exports;
const [code,dependencies]=modules[id];code(module,module.exports,name=>load(dependencies[name]),{env:{NODE_ENV:'production'}});return module.exports;}
const {availableOverlayTargets}=load(${JSON.stringify(join(root,"src/overlayItems.ts"))});
const React=load(${JSON.stringify(bundle.react)}),ReactDOM=load(${JSON.stringify(bundle.client)}),{ProfileEditor,HotkeyModal,ProfileSettingsModal}=load(${JSON.stringify(bundle.entry)});
function App(){const [db,onDb]=React.useState(${JSON.stringify(initial)}),[modal,onModal]=React.useState(null);window.snapshot={db};const folder=db.scopes[0],profile=folder.profiles[0];
return React.createElement(React.Fragment,null,React.createElement(ProfileEditor,{folder,profile,variables:[],showStates:false,onContext(){},onDb,onModal}),
modal?.type==='editHotkey'?React.createElement(HotkeyModal,{initial:modal.hotkey,overlayProfileId:profile.id,gameExe:folder.exe,states:folder.states,overlays:availableOverlayTargets(folder.profiles,[]),scripts:[],variables:[],onDb,onClose:()=>onModal(null),onSave:async hotkey=>{onDb(await load('./api').api.upsertProfile(folder.id,{...profile,hotkeys:modal.index===null?[...profile.hotkeys,hotkey]:profile.hotkeys.map((current,index)=>index===modal.index?hotkey:current)}));onModal(null);}}):null,
modal?.type==='profileSettings'?React.createElement(ProfileSettingsModal,{initial:profile,isNew:false,onSave(){},onClose:()=>onModal(null)}):null);}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));`;
  const logs=resolve(root,'logs');mkdirSync(logs,{recursive:true});
  for(const width of [1000,560]) for(const empty of [true,false]) await t.test(`${width}px ${empty?"profile":"behavior"}`,async t=>{
    const directory=mkdtempSync(join(logs,'overlay-editor-ui-'));let result;
    try {
      const page=join(directory,'editor.html');
      writeFileSync(page,`<!doctype html><style>${readFileSync(join(root,'src/App.css'),'utf8')}#root{display:flex;height:100vh}#results{position:absolute;left:-10000px}</style><div id="root"></div><pre id="results"></pre><script>${(harness+`(${scenario})(${empty});`).replace(/<\/script/gi,'<\\/script')}</script>`);
      const output=execFileSync(browser,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${join(directory,'profile')}`,`--window-size=${width},1200`,'--virtual-time-budget=20000',`--screenshot=${join(logs,`overlay-editor-${width}-${empty?"profile":"behavior"}.png`)}`,'--dump-dom',pathToFileURL(page).href],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
      const match=output.match(/<pre id="results">([^<]+)<\/pre>/);assert.ok(match,'browser did not complete the inline overlay scenario');
      result=JSON.parse(match[1].replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));
    } finally {assert.equal(dirname(directory),logs);rmSync(directory,{recursive:true,force:true});}
    for(const name of result.results) await t.test(name,()=>{});
    assert.equal(result.error,undefined,result.stack??result.error);
  });
});
