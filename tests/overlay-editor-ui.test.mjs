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

async function scenario() {
  const results = [], wait = () => new Promise(resolve => setTimeout(resolve, 40));
  const check = (name, value) => { if (!value) throw Error(name); results.push(name); };
  const group = () => document.querySelector('.overlay-group');
  const own = () => window.snapshot.db.scopes[0].profiles[0];
  const field = (container, label) => {
    const element = [...container.querySelectorAll('input,select')].find(element => element.getAttribute('aria-label') === label)
      ?? [...container.querySelectorAll('label')].find(element => element.firstChild?.textContent.trim() === label)?.querySelector('input,select');
    if (!element) throw Error(`Missing ${label}`); return element;
  };
  const button = (container, label) => {
    const element = [...container.querySelectorAll('button')].find(element => element.getAttribute('aria-label') === label || element.textContent.trim() === label);
    if (!element) throw Error(`Missing button ${label}`); return element;
  };
  const click = async element => { element.click(); await wait(); };
  async function set(element, value) {
    const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles:true })); await wait();
  }
  const form = () => document.querySelector('.overlay-part-editor');
  const edit = async type => click(group().querySelector(`.overlay-type-badge--${type}`).closest('.overlay-item-row').querySelector('.overlay-item-row__open'));
  const add = async type => { await click(button(group(), 'Add part')); await click(button(group().querySelector('[aria-label="Part types"]'), type)); };
  const collapse = () => [...document.querySelectorAll('.section-toggle')].find(element => element.querySelector('h3').textContent === 'Overlays');
  const fits = () => [...document.querySelectorAll('.editor input,.editor select,.editor button')].filter(element => element.getClientRects().length).every(element => {
    const rect = element.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.width > 10;
  });
  try {
    await wait();
    check('overlay settings are visible without a Settings button or a dialog', group().querySelector('[aria-label="Overlay settings"]') && !group().querySelector('[aria-label="Settings"]') && !document.querySelector('.modal-overlay'));
    check('empty unrelated sections stay compact while the profile content is open', [...document.querySelectorAll('.section-toggle')].filter(element => ['Hotkeys','Events'].includes(element.querySelector('h3').textContent)).every(element => element.getAttribute('aria-expanded') === 'false'));
    check('overlay name, visibility, arrangement and position are directly editable', group().querySelector('[aria-label="Overlay name"]').value === 'Magic Protection' && field(group(), 'Arrange parts').value === 'row' && field(group(), 'X (%)').value === '10');
    check('overlay settings fit in compact rows with tooltip descriptions', group().querySelector('.overlay-group__config').getBoundingClientRect().height <= 70 && field(group(), 'Arrange parts').title && field(group(), 'Show overlay').title && field(group(), 'Gap (px)').title);
    check('parts have one Add part control and clickable rows instead of repeated edit and move buttons', !group().querySelector('[aria-label="Part types"]') && !group().querySelector('[aria-label="Move up"]') && group().querySelectorAll('button.overlay-item-row__open').length === 3);
    check('part rows avoid repeating the overlay title while keeping full names in tooltips', group().querySelector('.overlay-type-badge--timer').textContent === 'Timer 0' && group().querySelector('.overlay-type-badge--timer').title === 'Magic Protection Timer 0' && group().querySelector('button.overlay-item-row__open').getAttribute('aria-label') === 'Edit Magic Protection Timer 0');
    await set(field(group(), 'Arrange parts'), 'column');
    await set(field(group(), 'Gap (px)'), '12');
    await click(group().querySelector('input[aria-label="Magic Protection enabled"]'));
    check('unsaved settings survive unrelated saved changes', field(group(), 'Arrange parts').value === 'column' && field(group(), 'Gap (px)').value === '12' && own().overlay_groups[0].disabled === true);
    window.failSave = true;
    await click(button(group().querySelector('.overlay-group__save'), 'Save'));
    check('failed overlay saves retain the inline draft and saved configuration', field(group(), 'Arrange parts').value === 'column' && own().overlay_groups[0].layout === 'row' && window.errors.length === 1);
    window.failSave = false;
    await click(button(group().querySelector('.overlay-group__save'), 'Cancel'));
    check('Cancel restores saved settings without hiding them', field(group(), 'Arrange parts').value === 'row' && group().querySelector('[aria-label="Overlay settings"]') && !group().querySelector('.overlay-group__save'));
    await click(group().querySelector('input[aria-label="Magic Protection enabled"]'));
    await click(group().querySelector('.overlay-group__position [aria-label="Pick position"]'));
    await click(button(group().querySelector('.overlay-group__save'), 'Save'));
    check('position picking saves on the same card without altering its parts', own().overlay_groups[0].x === 25 && own().overlay_groups[0].y === 40 && own().overlay_items.length === 4);
    await add('Timer');
    check('new parts open inside their overlay with its settings still visible', form()?.closest('.overlay-group') === group() && !document.querySelector('.modal-overlay') && field(group(), 'Arrange parts').value === 'row');
    const beforeCancel = window.saveCalls;
    await click(button(form(), 'Cancel'));
    check('cancelling a new part leaves no saved part', !form() && own().overlay_items.length === 4 && window.saveCalls === beforeCancel);
    await edit('timer');
    await set(form().querySelector('[aria-label="Seconds"]'), '45');
    await set(form().querySelector('input[aria-label="Timer color"]'), '#aabbcc');
    check('another edit cannot silently replace an open part draft', button(group(), 'Add part').disabled && [...group().querySelectorAll('button.overlay-item-row__open')].filter(element => element.getAttribute('aria-expanded') !== 'true').every(element => element.disabled));
    await click(collapse()); await click(collapse());
    check('collapsing and reopening the section keeps the part draft', form().querySelector('[aria-label="Seconds"]').value === '45');
    window.failSave = true;
    await click(button(form(), 'Save'));
    check('failed part saves keep the draft in place', form().querySelector('[aria-label="Seconds"]').value === '45' && own().overlay_items[0].duration_ms === 65000);
    window.failSave = false; window.holdSave = true;
    await click(button(form(), 'Save'));
    check('pending saves lock the part controls and competing profile edits', form().querySelector('[aria-label="Seconds"]').matches(':disabled') && button(form(), 'Cancel').matches(':disabled') && group().querySelector('[aria-label="Overlay name"]').matches(':disabled') && document.querySelector('[aria-label="Profile settings"]').matches(':disabled'));
    window.finishSave(); await wait();
    const timer = own().overlay_items.find(item => item.id === 'timer');
    check('timer edits retain identity, source, visibility and appearance flags', !form() && timer.duration_ms === 105000 && timer.color === '#aabbcc' && timer.timer_state_id === 'buff' && timer.start_with_overlay && timer.show_only_running && !timer.show_background);
    await set(field(group(), 'Arrange parts'), 'free'); await click(button(group().querySelector('.overlay-group__save'), 'Save'));
    await edit('icon');
    await click(button(form(), 'Choose image'));
    await set(field(form(), 'Width (px)'), '96'); await set(field(form(), 'Height (px)'), '80');
    await click(form().querySelector('[aria-label="Pick position"]'));
    await click(button(form(), 'Save'));
    const icon = own().overlay_items.find(item => item.id === 'icon');
    check('image selection, dimensions and individual positions save inline', icon.w === 96 && icon.h === 80 && icon.x === 25 && icon.y === 40 && icon.src.startsWith('data:image/') && icon.state_id === 'buff');
    await edit('bar'); await set(field(form(), 'Maximum value'), '250'); await click(button(form(), 'Save'));
    check('bar settings remain editable with the existing values preserved', own().overlay_items.find(item => item.id === 'bar').max_value === 250 && own().overlay_items.find(item => item.id === 'bar').w === 200);
    await add('Text'); await set(field(form(), 'Content'), 'Magic; ø'); await click(button(form(), 'Save'));
    check('adding a text part preserves its group and literal content', own().overlay_items.length === 5 && own().overlay_items.at(-1).group_id === 'magic' && own().overlay_items.at(-1).content === 'Magic; ø');
    await edit('timer');
    check('settings and inline part controls fit the available width', fits());
    check('the complete timer editor stays compact without stacked legends', form().getBoundingClientRect().height <= 260 && !form().querySelector('legend'));
    check('unlabeled controls retain accessible names and tooltip descriptions', [...form().querySelectorAll('input,select')].every(element => element.getAttribute('aria-label') && (element.title || element.closest('[title]'))));
    document.getElementById('results').textContent = JSON.stringify({results});
  } catch(error) { document.getElementById('results').textContent = JSON.stringify({results,error:error.message,stack:error.stack}); }
}

test('overlays keep their settings and part editing together without losing draft or saved data', {skip:!browser && 'Chrome or Edge is required'}, async t => {
  const mocks = ['./api','./AppConsole','./App.css','./CloudSettings','@tauri-apps/api/event','@tauri-apps/plugin-dialog','@tauri-apps/plugin-opener','@tauri-apps/plugin-notification'];
  const bundle = browserModules(['App.tsx'], {mocks, expose:{[join(root,'src/App.tsx')]:['ProfileEditor']}});
  const initial = {version:7,settings:{},variables:[],scopes:[{id:'game',name:'Game',exe:'game.exe',states:[{id:'buff',name:'Magic Protection',duration_ms:10000}],profiles:[profile]}]};
  const harness = `const modules={${bundle.declarations}},cache={};window.errors=[];window.saveCalls=0;
const updateProfile=profile=>({...window.snapshot.db,scopes:window.snapshot.db.scopes.map(scope=>({...scope,profiles:scope.profiles.map(current=>current.id===profile.id?profile:current)}))});
function load(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;
if(id==='./api'){module.exports={api:{async upsertProfile(folder,profile){if(window.failSave)throw Error('fixture failure');window.saveCalls++;if(window.holdSave)await new Promise(resolve=>{window.finishSave=()=>{window.holdSave=false;resolve();};});return updateProfile(profile);},async upsertGame(folder){if(window.failSave)throw Error('fixture failure');window.saveCalls++;return {...window.snapshot.db,scopes:[folder]};},async setProfilePartEnabled(id,part,enabled,groupId){const profile=window.snapshot.db.scopes[0].profiles[0];return updateProfile({...profile,overlay_groups:profile.overlay_groups.map(group=>group.id===groupId?{...group,disabled:!enabled}:group)});},async pickCoordinate(){return [25,40];},async readImageAsDataUrl(){return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="20" height="20"%3E%3Crect width="20" height="20" fill="violet"/%3E%3C/svg%3E';}}};return module.exports;}
if(id==='./AppConsole'){module.exports={useErrorReporter:()=>error=>window.errors.push(String(error))};return module.exports;}
if(id==='@tauri-apps/plugin-dialog'){module.exports={open:async()=> 'fixture.png',confirm:async()=>true};return module.exports;}
if(${JSON.stringify(mocks)}.includes(id))return module.exports;
const [code,dependencies]=modules[id];code(module,module.exports,name=>load(dependencies[name]),{env:{NODE_ENV:'production'}});return module.exports;}
const React=load(${JSON.stringify(bundle.react)}),ReactDOM=load(${JSON.stringify(bundle.client)}),{ProfileEditor}=load(${JSON.stringify(bundle.entry)});
function App(){const [db,onDb]=React.useState(${JSON.stringify(initial)});window.snapshot={db};return React.createElement(ProfileEditor,{folder:db.scopes[0],profile:db.scopes[0].profiles[0],variables:[],showStates:false,onContext(){},onDb,onModal(){throw Error('Unexpected modal');}});}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));(${scenario})();`;
  const logs=resolve(root,'logs');mkdirSync(logs,{recursive:true});
  for(const width of [1000,560]) await t.test(`${width}px editor`,async t=>{
    const directory=mkdtempSync(join(logs,'overlay-editor-ui-'));let result;
    try {
      const page=join(directory,'editor.html');
      writeFileSync(page,`<!doctype html><style>${readFileSync(join(root,'src/App.css'),'utf8')}#root{display:flex;height:100vh}#results{position:absolute;left:-10000px}</style><div id="root"></div><pre id="results"></pre><script>${harness.replace(/<\/script/gi,'<\\/script')}</script>`);
      const output=execFileSync(browser,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${join(directory,'profile')}`,`--window-size=${width},1200`,'--virtual-time-budget=20000',`--screenshot=${join(logs,`overlay-editor-${width}.png`)}`,'--dump-dom',pathToFileURL(page).href],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
      const match=output.match(/<pre id="results">([^<]+)<\/pre>/);assert.ok(match,'browser did not complete the inline overlay scenario');
      result=JSON.parse(match[1].replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));
    } finally {assert.equal(dirname(directory),logs);rmSync(directory,{recursive:true,force:true});}
    for(const name of result.results) await t.test(name,()=>{});
    assert.equal(result.error,undefined,result.stack??result.error);
  });
});
