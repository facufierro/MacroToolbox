import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { root, browser, browserModules } from "./browserHarness.mjs";

async function editorScenario(empty) {
  const results = [], wait = () => new Promise(resolve => setTimeout(resolve, 60));
  const check = (name, value) => { if (!value) throw Error(name); results.push(name); };
  const get = label => document.querySelector(`[aria-label="${label}"]`);
  const button = text => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text || button.getAttribute('aria-label') === text);
  const click = async element => { if (!element) throw Error('Missing button'); element.click(); await wait(); };
  const set = async (label, value) => {
    const element = get(label), prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', {bubbles:true})); await wait();
  };
  const members = () => [...document.querySelectorAll('.overlay-bar-member > span')].map(element => element.textContent);
  const saved = () => window.snapshot.scopes[0];
  try {
    await wait();
    check('existing overlays keep their individual position until assigned a bar', get('Overlay bar').value === '' && get('X (%)').value === '15');
    await click(button('New bar'));
    check('a new bar starts with the current whole overlay and saves with its parent', members().join() === 'Magic' && button('Save overlay').disabled && !saved().overlay_bars?.length);
    await set('Bar name', 'Buffs'); await set('Bar gap (px)', '37');
    await set('Bar direction', 'column');
    await set('Bar gap (px)', '-1'); check('negative gaps cannot be applied', button('Apply bar').disabled);
    await set('Bar gap (px)', '37');
    await set('Add overlay to bar', 'other'); await set('Add overlay to bar', 'third');
    document.querySelector('[aria-label="Move Third"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true})); await wait();
    check('whole overlays reorder independently of their icon and timer parts', members().join() === 'Magic,Third,Other');
    if (empty) {
      while (button('Remove from bar')) await click(button('Remove from bar'));
      check('an empty bar has a compact editable empty state', document.querySelector('.overlay-bar-editor .steps-empty').textContent === 'No overlays in this bar');
    }
    const editor = get('Edit overlay group'), bounds = editor.getBoundingClientRect();
    check('empty and configured bar controls fit normal and narrow windows', bounds.left >= 0 && bounds.right <= innerWidth && editor.scrollWidth <= editor.clientWidth && [...editor.querySelectorAll('input,select,button')].every(element => element.getBoundingClientRect().right <= bounds.right + 1));
    if (empty) {
      await click(button('Cancel bar')); await click(button('Cancel overlay'));
      check('cancelling creates no bar or layout changes', !saved().overlay_bars?.length && window.saveCalls === 0);
    } else {
      await click(button('Apply bar'));
      check('bar position replaces individual overlay positioning while preserving its parts', !get('X (%)') && document.querySelectorAll('.overlay-item-row').length === 2 && get('Overlay bar').selectedOptions[0].textContent === 'Buffs');
      window.failSave = true; await click(button('Save overlay'));
      check('a failed save retains the complete bar draft without partial persistence', !saved().overlay_bars?.length && get('Overlay bar').selectedOptions[0].textContent === 'Buffs' && window.errors.length === 1);
      window.failSave = false; window.errors.length = 0; await click(button('Save overlay'));
      const bar = saved().overlay_bars[0];
      check('saving persists the chosen gap direction and member order atomically', bar.gap === 37 && bar.layout === 'column' && bar.group_ids.join() === 'magic,third,other' && window.saveCalls === 1);
      window.reopen('other'); await wait();
      check('another overlay reopens the same shared bar', get('Overlay bar').value === bar.id);
      await click(button('Edit bar')); await set('Bar gap (px)', '0'); await click(button('Apply bar')); await click(button('Save overlay'));
      check('zero gap is preserved across save and reopen', saved().overlay_bars[0].gap === 0 && saved().overlay_bars[0].group_ids.join() === 'magic,third,other');
      window.reopen('other'); await wait();
      await set('Overlay bar', ''); await click(button('Save overlay'));
      check('removing one overlay restores its position and leaves the other members ordered', saved().overlay_bars[0].group_ids.join() === 'magic,third' && saved().profiles[0].overlay_groups.find(group=>group.id==='other').x === 60);
      window.reopen('magic'); await wait();
      await click(button('Edit bar')); await click(button('Remove bar')); await click(button('Save overlay'));
      check('removing a bar keeps every overlay and its individual settings', saved().overlay_bars.length === 0 && saved().profiles[0].overlay_groups.length === 3 && saved().profiles[0].overlay_items.length === 4);
      window.reopen('magic'); await wait();
      await click(button('Duplicate overlay')); await click(button('New bar')); await click(button('Apply bar'));
      await click(button('Duplicate overlay')); await click(button('Save overlay'));
      check('replacing an unsaved overlay draft keeps its bar attached to the surviving copy', saved().overlay_bars.length === 1 && saved().overlay_bars[0].group_ids.length === 1 && saved().profiles[0].overlay_groups.some(group=>group.id===saved().overlay_bars[0].group_ids[0]));
      check('bar editing reports no unexpected errors', window.errors.length === 0);
    }
    await click(button('New bar')); await set('Bar name','Buffs'); await set('Bar gap (px)','37'); await set('Bar direction','column');
    if (empty) { while (button('Remove from bar')) await click(button('Remove from bar')); }
    else { await set('Add overlay to bar','third'); await set('Add overlay to bar','other'); }
    document.getElementById('results').textContent = JSON.stringify({results});
  } catch(error) { document.getElementById('results').textContent = JSON.stringify({results,error:String(error),stack:error.stack}); }
}

test('overlay bars support adjustable gaps, ordering, staging, and save/reopen', {skip:!browser}, async t => {
  const mocks = ['./api','./AppConsole','@tauri-apps/plugin-dialog'];
  const bundle = browserModules(['BehaviorOverlayEditor.tsx'],{mocks});
  const icon = {type:'icon',name:'',x:0,y:0,w:32,h:32,src:null,state_id:null};
  const initial = {version:15,variables:[],settings:{},scopes:[{id:'game',name:'Game',exe:'game.exe',states:[],profiles:[{id:'p',name:'Spells',parent_id:null,hotkeys:[],events:[],scripts:[],states:[],overlay_groups:[{id:'magic',name:'Magic',x:15,y:25,layout:'column',gap:4},{id:'other',name:'Other',x:60,y:30,layout:'column',gap:4},{id:'third',name:'Third',x:80,y:30,layout:'row',gap:4}],overlay_items:[{...icon,id:'magic-icon',group_id:'magic'},{id:'timer',type:'timer',name:'',group_id:'magic',x:0,y:0,duration_ms:10000,color:'#fff',font_size:18,timer_state_id:null,state_id:null},{...icon,id:'other-icon',group_id:'other'},{...icon,id:'third-icon',group_id:'third'}]}]}]};
  const logs = join(root,'logs'); mkdirSync(logs,{recursive:true});
  for (const width of [1000,560]) for (const empty of [true,false]) await t.test(`${width}px ${empty?'empty':'configured'}`,async () => {
    const directory = mkdtempSync(join(logs,'overlay-bar-editor-'));
    try {
      const harness = `const modules={${bundle.declarations}},cache={};window.errors=[];window.saveCalls=0;window.reportError=error=>window.errors.push(String(error));
function load(id){if(cache[id])return cache[id].exports;const module=cache[id]={exports:{}};
if(id==='./api'){module.exports={api:{async getDatabase(){return structuredClone(window.snapshot);},async upsertGame(scope){if(window.failSave)throw Error('fixture failure');window.saveCalls++;return {...window.snapshot,scopes:[scope]};}}};return module.exports;}
if(id==='./AppConsole'){module.exports={useErrorReporter:()=>window.reportError};return module.exports;}
if(${JSON.stringify(mocks)}.includes(id))return module.exports;const [code,dependencies]=modules[id];code(module,module.exports,name=>load(dependencies[name]),{env:{NODE_ENV:'production'}});return module.exports;}
const React=load(${JSON.stringify(bundle.react)}),ReactDOM=load(${JSON.stringify(bundle.client)}),{BehaviorOverlayEditor}=load(${JSON.stringify(bundle.entry)});
function Fixture(){const [db,onDb]=React.useState(${JSON.stringify(initial)}),[current,setCurrent]=React.useState({id:'magic',revision:0});window.snapshot=db;window.reopen=id=>setCurrent(value=>({id,revision:value.revision+1}));return React.createElement('div',{className:'modal modal--wide',style:{margin:'16px auto'}},React.createElement(BehaviorOverlayEditor,{key:current.revision,groupId:current.id,defaultProfileId:'p',onDb,onSaved(){},onDeleted(){},onClose(){}}));}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));(${editorScenario})(${empty});`;
      const page=join(directory,'bars.html');
      writeFileSync(page,`<!doctype html><style>${readFileSync(join(root,'src/App.css'),'utf8')}#results{position:absolute;left:-10000px}</style><div id="root"></div><pre id="results"></pre><script>${harness.replace(/<\/script/gi,'<\\/script')}</script>`);
      const output=execFileSync(browser,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${join(directory,'profile')}`,`--window-size=${width},1100`,'--virtual-time-budget=15000',`--screenshot=${join(logs,`overlay-bar-${width}-${empty?'empty':'configured'}.png`)}`,'--dump-dom',pathToFileURL(page).href],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
      const match=output.match(/<pre id="results">([^<]+)<\/pre>/);assert.ok(match,'browser did not finish overlay bar editor checks');
      const result=JSON.parse(match[1].replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));
      assert.equal(result.error,undefined,result.stack??result.error);
    } finally {assert.equal(dirname(directory),logs);rmSync(directory,{recursive:true,force:true});}
  });
});
