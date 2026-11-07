import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { root, browser, browserModules } from "./browserHarness.mjs";

async function scenario(empty) {
  const results = [], wait = () => new Promise(resolve => setTimeout(resolve, 40));
  const check = (name, value) => { if (!value) throw Error(name); results.push(name); };
  const editor = () => document.querySelector('.behavior-overlay-editor');
  const part = () => editor().querySelector('.overlay-part-editor');
  const own = () => window.snapshot.scopes[0].profiles[0];
  const field = label => editor().querySelector(`[aria-label="${label}"]`);
  const button = (container, label) => [...container.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label || button.textContent.trim() === label);
  const click = async element => { if (!element) throw Error('Missing button'); element.click(); await wait(); };
  const addOverlay = async () => {
    await click(button(document.querySelector('.modal'), 'Add action'));
    await click(button(document.querySelector('.action-picker'), 'Overlay'));
  };
  async function set(element, value) {
    if (!element) throw Error('Missing field');
    Object.getOwnPropertyDescriptor(element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', {bubbles:true})); await wait();
  }
  function fits() {
    const modal = document.querySelector('.modal--wide'), frame = modal.getBoundingClientRect();
    return frame.left >= 0 && frame.right <= innerWidth && modal.scrollWidth <= modal.clientWidth
      && [...modal.querySelectorAll('input,select,button')].filter(element => element.getClientRects().length).every(element => {
        const rect = element.getBoundingClientRect(); return rect.left >= frame.left && rect.right <= frame.right && rect.width > 10;
      });
  }
  async function add(type) {
    await click(button(editor(), 'Add part'));
    await click(button(editor().querySelector('[aria-label="Part types"]'), type));
    check(`${type} uses the existing inline part editor`, !!part() && !part().matches('form') && document.querySelectorAll('.modal-overlay').length === 1);
  }
  try {
    await wait();
    await addOverlay();
    check('adding the behavior opens a fresh group without a New overlay button', !!editor() && !button(document, 'New overlay'));
    check('the whole group opens inside the behavior with no extra dialog', !!editor() && editor().closest('.step-row--overlay') && document.querySelectorAll('.modal-overlay').length === 1);
    check('unfinished overlay edits block the parent Save and step deletion', document.querySelector('[aria-label="Save"]').disabled && document.querySelector('[aria-label="Delete step"]').disabled);
    check('the empty group retains the compact established controls', field('Overlay name').value === 'Overlay' && field('Arrange parts').value === 'row' && editor().textContent.includes('No parts yet') && fits());
    if (empty) { document.getElementById('results').textContent = JSON.stringify({results}); return; }
    await set(field('Overlay name'), 'Protection');
    await set(field('X (%)'), '25'); await set(field('Y (%)'), '40');
    await add('Timer'); await set(field('Seconds'), '30');
    await click(button(part(), 'Save'));
    await add('Icon'); await click(button(part(), 'Choose image')); await click(button(part(), 'Save'));
    await add('Bar'); await set(field('Maximum value'), '250'); await click(button(part(), 'Save'));
    await add('Text'); await set(field('Content'), 'Buff ø'); await click(button(part(), 'Save'));
    check('all four part types remain inside the same unsaved group', editor().querySelectorAll('.overlay-item-row').length === 4 && own().overlay_groups.length === 0 && window.saveCalls === 0);
    window.failSave = true; await click(button(editor(), 'Save overlay'));
    check('a failed save keeps the complete draft and original settings', field('Overlay name').value === 'Protection' && editor().querySelectorAll('.overlay-item-row').length === 4 && own().overlay_groups.length === 0 && window.errors.length === 1);
    window.failSave = false; window.holdSave = true;
    await click(button(editor(), 'Save overlay'));
    check('pending saves lock the entire group and its cancellation', field('Overlay name').matches(':disabled') && button(editor(), 'Cancel overlay').matches(':disabled') && document.querySelector('[aria-label="Save"]').disabled);
    window.finishSave(); await wait();
    const group = own().overlay_groups[0], groupId = group.id;
    check('saving closes the overlay draft', !editor());
    check('saving preserves all four parts', own().overlay_items.length === 4);
    check('all parts belong to the newly saved group', own().overlay_items.every(item => item.group_id === groupId));
    check('saving selects the whole group by name', document.querySelector('.step-row--overlay .overlay-targets summary > span').textContent === 'Protection');
    check('appearance and positioning save with the complete group', group.x === 25 && group.y === 40 && own().overlay_items.find(item => item.type === 'icon').src.startsWith('data:image/') && own().overlay_items.find(item => item.type === 'bar').max_value === 250 && own().overlay_items.find(item => item.type === 'text').content === 'Buff ø');
    for (const mode of ['stop','start','restart']) {
      await set(document.querySelector('[aria-label="Overlay action"]'), mode);
      await click(document.querySelector('[aria-label="Save"]'));
      const saved = JSON.parse(window.saved.behavior)[0];
      check(`${mode} retains the complete group's reference`, saved.itemIds.join() === groupId && saved.type === (mode === 'stop' ? 'stopoverlay' : 'startoverlay') && (mode === 'stop' || saved.restart === (mode === 'restart')));
    }
    await addOverlay();
    check('a second Overlay action creates a fresh group instead of selecting the existing group', field('Overlay name').value === 'Overlay' && own().overlay_groups.length === 1 && document.querySelectorAll('.step-row--overlay').length === 2);
    await set(field('Overlay name'), 'Discard me');
    await add('Timer'); await click(button(part(), 'Save')); await click(button(editor(), 'Cancel overlay'));
    check('cancelling removes only the unfinished behavior without creating an orphan group or part', own().overlay_groups.length === 1 && own().overlay_items.length === 4 && document.querySelectorAll('.step-row--overlay').length === 1 && document.querySelector('.step-row--overlay .overlay-targets summary > span').textContent === 'Protection');
    window.switchMode('event'); await wait();
    await click(button(document, 'Edit overlay')); await set(field('Overlay name'), 'Shared protection'); await click(button(editor(), 'Save overlay'));
    check('events edit the same saved group without duplicating its parts', own().overlay_groups[0].name === 'Shared protection' && own().overlay_items.length === 4);
    window.switchMode('variable'); await wait();
    await addOverlay();
    check('standalone reusable behaviors choose an explicit owning profile', field('Overlay profile').value === '' && button(editor(), 'Save overlay').disabled);
    await set(field('Overlay profile'), 'profile'); await set(field('Overlay name'), 'Variable overlay');
    await click(button(editor(), 'Save overlay'));
    check('creating a group in a behavior variable does not submit the parent form', own().overlay_groups.length === 2 && document.querySelectorAll('form.modal').length === 1 && document.querySelector('[aria-label="Variable name"]').value === 'Shared');
    window.switchMode('hotkey'); await wait();
    await click(button(document, 'Edit overlay'));
    const timer = own().overlay_items.find(item => item.type === 'timer');
    await click(editor().querySelector('.overlay-type-badge--timer').closest('.overlay-item-row').querySelector('.overlay-item-row__open'));
    check('reopening shows all saved group settings and parts together', field('Overlay name').value === 'Shared protection' && field('X (%)').value === '25' && field('Seconds').value === '30' && editor().querySelectorAll('.overlay-item-row').length === 4);
    await set(field('Seconds'), '20'); await click(button(part(), 'Save')); await click(button(editor(), 'Save overlay'));
    check('part editing retains identity and all other parts', own().overlay_items.find(item => item.id === timer.id).duration_ms === 80000 && own().overlay_items.length === 4);
    await click(button(document, 'Edit overlay'));
    await click(editor().querySelector('.overlay-type-badge--timer').closest('.overlay-item-row').querySelector('.overlay-item-row__open'));
    check('the configured group and timer editor fit the available width', fits());
    document.getElementById('results').textContent = JSON.stringify({results});
  } catch(error) { document.getElementById('results').textContent = JSON.stringify({results,error:error.message,stack:error.stack}); }
}

test('complete overlay groups can be created and edited inside hotkeys, events, and reusable behaviors', {skip:!browser && 'Chrome or Edge is required'}, async t => {
  const mocks = ['./api','./AppConsole','./App.css','./CloudSettings','@tauri-apps/api/event','@tauri-apps/plugin-dialog','@tauri-apps/plugin-opener','@tauri-apps/plugin-notification'];
  const bundle = browserModules(['App.tsx'], {mocks, expose:{[join(root,'src/App.tsx')]:['HotkeyModal','EventModal']}});
  const initial = {version:8,settings:{},variables:[],scopes:[{id:'app',name:'Game',exe:'game.exe',states:[],profiles:[{id:'profile',name:'Buffs',parent_id:null,hotkeys:[],events:[],states:[],scripts:[],overlay_groups:[],overlay_items:[]}]}]};
  const harness = `const modules={${bundle.declarations}},cache={};window.errors=[];window.saveCalls=0;window.reportError=error=>window.errors.push(String(error));
function load(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;
if(id==='./api'){module.exports={api:{async getDatabase(){return structuredClone(window.snapshot);},async upsertGame(folder){if(window.failSave)throw Error('fixture failure');if(window.holdSave)await new Promise(resolve=>{window.finishSave=()=>{window.holdSave=false;resolve();};});window.saveCalls++;return {...window.snapshot,scopes:[folder]};},async readImageAsDataUrl(){return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="20" height="20"%3E%3Crect width="20" height="20" fill="violet"/%3E%3C/svg%3E';}}};return module.exports;}
if(id==='./AppConsole'){module.exports={useErrorReporter:()=>window.reportError};return module.exports;}
if(id==='@tauri-apps/plugin-dialog'){module.exports={open:async()=> 'fixture.png'};return module.exports;}
if(${JSON.stringify(mocks)}.includes(id))return module.exports;const [code,dependencies]=modules[id];code(module,module.exports,name=>load(dependencies[name]),{env:{NODE_ENV:'production'}});return module.exports;}
const React=load(${JSON.stringify(bundle.react)}),ReactDOM=load(${JSON.stringify(bundle.client)}),{HotkeyModal,EventModal}=load(${JSON.stringify(bundle.entry)}),{VariableModal}=load(${JSON.stringify(join(root,'src/VariableModal.tsx'))}),{BehaviorStepsEditor}=load(${JSON.stringify(join(root,'src/BehaviorEditor.tsx'))}),{availableOverlayTargets}=load(${JSON.stringify(join(root,'src/overlayItems.ts'))});
function App(){const [db,onDb]=React.useState(${JSON.stringify(initial)}),[mode,setMode]=React.useState('hotkey');window.snapshot=db;window.switchMode=setMode;
const props={key:mode,gameExe:'game.exe',states:[],overlays:availableOverlayTargets(db.scopes[0].profiles,[]),scripts:[],variables:db.variables,onDb,onClose(){}},behavior=window.saved?.behavior??'';
if(mode==='event')return React.createElement(EventModal,{...props,overlayProfileId:'profile',initial:{event:'focus_gained',behavior},eventKinds:['focus_gained'],onSave:event=>window.saved=event});
if(mode==='variable')return React.createElement(VariableModal,{key:mode,initial:{id:'shared',name:'Shared',type:'behavior',value:behavior},variables:db.variables,onSaved(){},onClose(){},renderBehavior:editorProps=>React.createElement(BehaviorStepsEditor,{...props,...editorProps})});
return React.createElement(HotkeyModal,{...props,overlayProfileId:'profile',initial:{name:'Buff',trigger:'q',behavior,state_id:null},onSave:hotkey=>window.saved=hotkey});}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));`;
  const logs = join(root,'logs'); mkdirSync(logs,{recursive:true});
  for (const width of [1000,560]) for (const empty of [true,false]) await t.test(`${width}px ${empty?'empty':'configured'}`, async t => {
    const directory = mkdtempSync(join(logs,'overlay-inline-ui-')); let result;
    try {
      const page = join(directory,'inline.html');
      writeFileSync(page,`<!doctype html><style>${readFileSync(join(root,'src/App.css'),'utf8')}#results{position:absolute;left:-10000px}</style><div id="root"></div><pre id="results"></pre><script>${(harness+`(${scenario})(${empty});`).replace(/<\/script/gi,'<\\/script')}</script>`);
      const output = execFileSync(browser,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${join(directory,'profile')}`,`--window-size=${width},1200`,'--virtual-time-budget=20000',`--screenshot=${join(logs,`overlay-inline-${width}-${empty?'empty':'configured'}.png`)}`,'--dump-dom',pathToFileURL(page).href],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
      const match=output.match(/<pre id="results">([^<]+)<\/pre>/);assert.ok(match,'browser did not complete the inline overlay scenario');
      result=JSON.parse(match[1].replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));
    } finally { assert.equal(dirname(directory),logs); rmSync(directory,{recursive:true,force:true}); }
    for (const name of result.results) await t.test(name,()=>{});
    assert.equal(result.error,undefined,result.stack??result.error);
  });
});
