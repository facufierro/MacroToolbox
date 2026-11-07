import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { root, browser, browserModules } from "./browserHarness.mjs";

async function scenario() {
  const results=[],wait=()=>new Promise(resolve=>setTimeout(resolve,40));
  const get=selector=>{const element=document.querySelector(selector);if(!element)throw Error(`Missing ${selector}`);return element;};
  const check=(name,value)=>{if(!value)throw Error(name);results.push(name);};
  const owner=()=>window.snapshot.scopes[0].profiles[0];
  const editor=()=>get('.behavior-overlay-editor');
  const button=(container,label)=>[...container.querySelectorAll('button')].find(button=>button.getAttribute('aria-label')===label||button.textContent.trim()===label);
  const click=async element=>{if(!element)throw Error('Missing button');element.click();await wait();};
  const handle=name=>get(`.behavior-overlay-editor .drag-handle[aria-label="Move ${name}"]`);
  const order=()=>[...editor().querySelectorAll('.overlay-type-badge--text')].map(element=>element.closest('.step-row').querySelector('.overlay-item-desc').textContent.split('"')[1]).join(',');
  async function drag(from,to,drop=true){
    const transfer=new DataTransfer(),destination=to.closest('.sortable-item');
    from.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}));await wait();
    const bounds=destination.getBoundingClientRect();
    destination.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:bounds.top+1}));await wait();
    const marker=destination.dataset.drop;
    if(drop)destination.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:bounds.top+1}));
    from.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:transfer}));await wait();return marker;
  }
  try{
    await wait();await click(button(document,'Edit overlay'));
    const original=structuredClone(owner()),before=JSON.stringify(window.snapshot);
    check('inherited parts remain visible without a drag handle in the consuming group',editor().querySelector('.step-row--muted')&&!document.querySelector('[aria-label="Move Magic Bar 0"]'));
    await drag(handle('Magic Text 1'),handle('Magic Text 0'),false);
    check('cancelling a part drag leaves the complete saved group unchanged',order()==='First,Second'&&JSON.stringify(window.snapshot)===before&&window.saveCalls===0&&!document.querySelector('[data-drop]'));
    const marker=await drag(handle('Magic Text 1'),handle('Magic Text 0'));
    check('parts reorder inside the behavior draft without changing the saved group',marker==='before'&&order()==='Second,First'&&window.saveCalls===0&&JSON.stringify(window.snapshot)===before);
    window.failSave=true;await click(button(editor(),'Save overlay'));
    check('failed group saves retain the dragged order and all original data',order()==='Second,First'&&JSON.stringify(window.snapshot)===before&&window.errors.length===1);
    window.failSave=false;await click(button(editor(),'Save overlay'));
    check('saving preserves part identity, raw appearance settings, and inherited parts',owner().overlay_items.map(item=>item.id).join(',')==='timer,icon,bar,text2,text'&&owner().overlay_items.find(item=>item.id==='icon').src===original.overlay_items[1].src&&window.snapshot.scopes[0].profiles[1].overlay_items.length===1);
    await click(button(document,'Edit overlay'));
    handle('Magic Text 0').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));await wait();
    await click(button(editor(),'Cancel overlay'));
    check('cancelling keyboard reordering does not write over the saved group',owner().overlay_items.map(item=>item.id).join(',')==='timer,icon,bar,text2,text'&&window.saveCalls===1);
    await click(button(document,'Edit overlay'));await click(button(editor(),'Duplicate overlay'));
    check('duplicating a whole group creates an unsaved draft with all inherited and owned parts',editor().querySelectorAll('.overlay-item-row').length===6&&owner().overlay_groups.length===1&&window.saveCalls===1);
    await click(button(editor(),'Save overlay'));
    const copy=owner().overlay_groups.find(group=>group.id!=='magic'),parts=owner().overlay_items.filter(item=>item.group_id===copy.id);
    check('the behavior selects the complete saved duplicate with fresh group and part identities',copy.name==='Magic (copy)'&&parts.length===6&&parts.every(item=>!original.overlay_items.some(original=>original.id===item.id))&&get('.step-row--overlay .overlay-targets summary > span').textContent==='Magic (copy)');
    check('duplication remaps timer links and preserves original shared state references',parts.find(item=>item.type==='icon').visible_while_timer_id===parts.find(item=>item.type==='timer').id&&parts.find(item=>item.type==='timer').timer_state_id==='buff');
    await click(button(document,'Edit overlay'));window.confirmAnswer=false;await click(button(editor(),'Delete overlay'));
    check('dismissing deletion leaves the saved group and selected behavior intact',owner().overlay_groups.length===2&&!!editor()&&window.saveCalls===2);
    window.confirmAnswer=true;window.failSave=true;await click(button(editor(),'Delete overlay'));
    check('failed deletion leaves the group editable and reports the failure',owner().overlay_groups.length===2&&!!editor()&&window.errors.length===2&&!editor().disabled);
    window.failSave=false;await click(button(editor(),'Delete overlay'));
    check('deleting the duplicate removes its group, parts, and in-flight behavior reference',owner().overlay_groups.length===1&&owner().overlay_items.length===5&&!document.querySelector('.behavior-overlay-editor,.step-row--overlay')&&window.saveCalls===3);
    check('group deletion preserves the original overlay and all raw part settings',JSON.stringify(owner().overlay_groups)===JSON.stringify(original.overlay_groups)&&owner().overlay_items.every(item=>JSON.stringify(item)===JSON.stringify(original.overlay_items.find(original=>original.id===item.id))));
    document.getElementById('results').textContent=JSON.stringify({results});
  }catch(error){document.getElementById('results').textContent=JSON.stringify({results,error:error.message,stack:error.stack});}
}

test('overlay behaviors own part ordering, duplication, and confirmed group deletion', {skip:!browser&&'Chrome or Edge is required'},async t=>{
  const mocks=['./api','./AppConsole','./App.css','./CloudSettings','@tauri-apps/api/event','@tauri-apps/plugin-dialog','@tauri-apps/plugin-opener','@tauri-apps/plugin-notification'];
  const bundle=browserModules(['App.tsx'],{mocks,expose:{[join(root,'src/App.tsx')]:['HotkeyModal']}});
  const part={name:'Legacy saved name',group_id:'magic',state_id:null,x:3,y:4};
  const profile={id:'owner',name:'Source',kind:'overlay',armed:true,parent_id:'parent',hotkeys:[],events:[],scripts:[],states:[],overlay_triggers:[],overlay_groups:[{id:'magic',name:'Magic',x:15,y:25,layout:'row',gap:6,disabled:true}],overlay_items:[
    {...part,id:'timer',type:'timer',duration_ms:5000,color:'#ffffff',font_size:22,timer_state_id:'buff',start_with_overlay:true,show_only_running:true},
    {...part,id:'icon',type:'icon',w:48,h:64,src:'data:image/png;base64,image',visible_while_timer_id:'timer'},
    {...part,id:'bar',type:'bar',w:200,h:20,color:'#aabbcc',max_value:100},
    {...part,id:'text',type:'text',content:'First',color:'#ffffff',font_size:18},
    {...part,id:'text2',type:'text',content:'Second',color:'#ffffff',font_size:18}]};
  const initial={version:8,variables:[],settings:{},scopes:[{id:'app',name:'App',exe:'app.exe',states:[{id:'buff',name:'Buff',duration_ms:5000}],profiles:[profile,
    {...profile,id:'parent',parent_id:null,overlay_groups:[],overlay_items:[{...part,id:'inherited',type:'bar',w:100,h:20,color:'#ffffff',max_value:100}]}]}]};
  const harness=`const modules={${bundle.declarations}},cache={};window.errors=[];window.saveCalls=0;window.reportError=error=>window.errors.push(String(error));
function load(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;
if(id==='./api'){module.exports={api:{async getDatabase(){return structuredClone(window.snapshot);},async upsertGame(folder){if(window.failSave)throw Error('fixture failure');window.saveCalls++;return {...window.snapshot,scopes:[folder]};}}};return module.exports;}
if(id==='./AppConsole'){module.exports={useErrorReporter:()=>window.reportError};return module.exports;}
if(id==='@tauri-apps/plugin-dialog'){module.exports={confirm:async()=>window.confirmAnswer};return module.exports;}
if(${JSON.stringify(mocks)}.includes(id))return module.exports;const [code,dependencies]=modules[id];code(module,module.exports,name=>load(dependencies[name]),{env:{NODE_ENV:'production'}});return module.exports;}
const React=load(${JSON.stringify(bundle.react)}),ReactDOM=load(${JSON.stringify(bundle.client)}),{HotkeyModal}=load(${JSON.stringify(bundle.entry)}),{availableOverlayTargets}=load(${JSON.stringify(join(root,'src/overlayItems.ts'))});
function Fixture(){const [db,onDb]=React.useState(${JSON.stringify(initial)});window.snapshot=db;return React.createElement(HotkeyModal,{initial:{name:'Show',trigger:'q',behavior:'startoverlay(magic)',state_id:null},overlayProfileId:'owner',gameExe:'app.exe',states:db.scopes[0].states,overlays:availableOverlayTargets(db.scopes[0].profiles,[]),scripts:[],variables:[],onDb,onSave(){},onClose(){}});}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));(${scenario})();`;
  const logs=join(root,'logs');mkdirSync(logs,{recursive:true});const directory=mkdtempSync(join(logs,'overlay-drag-ui-'));let result;
  try{
    const page=join(directory,'drag.html');
    writeFileSync(page,`<!doctype html><style>${readFileSync(join(root,'src/App.css'),'utf8')}#results{position:absolute;left:-10000px}</style><div id="root"></div><pre id="results"></pre><script>${harness.replace(/<\/script/gi,'<\\/script')}</script>`);
    const output=execFileSync(browser,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${join(directory,'profile')}`,'--window-size=1300,1100','--virtual-time-budget=10000','--dump-dom',pathToFileURL(page).href],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
    const match=output.match(/<pre id="results">([^<]+)<\/pre>/);assert.ok(match,'browser did not complete overlay drag checks');
    result=JSON.parse(match[1].replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));
  }finally{assert.equal(dirname(directory),logs);rmSync(directory,{recursive:true,force:true});}
  for(const name of result.results)await t.test(name,()=>{});
  assert.equal(result.error,undefined,result.stack??result.error);
});
