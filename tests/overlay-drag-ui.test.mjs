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
  const owner=()=>window.snapshot.scopes[0].profiles[0], grouped=()=>window.snapshot.scopes[0].profiles[1];
  const across=()=>window.snapshot.scopes[1].profiles[0],fresh=()=>window.snapshot.scopes[1].profiles[1];
  const card=name=>get(`.overlay-group[aria-label="${name}"]`);
  const handle=name=>get(`.editor .drag-handle[aria-label="Move ${name}"]`);
  const destination=name=>[...document.querySelectorAll('.profile-row')].find(row=>row.querySelector('.profile-row__name').textContent===name);
  async function drag(from,to,{drop=true,end=true}={}){
    from.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    const transfer=new DataTransfer(),start=new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer});
    from.dispatchEvent(start);await wait();
    to.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer}));await wait();
    const marker=to.dataset.itemDrop;
    if(drop)to.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
    if(end)from.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:transfer}));
    await wait();return{marker,start,from,transfer};
  }
  try{
    await wait();
    check('a single owned overlay has a working drag handle and a draggable card',handle('Magic').draggable&&card('Magic').closest('.sortable-item').draggable);
    check('inherited overlays and their parts cannot be dragged from the consuming profile',!card('Inherited').closest('.sortable-item').draggable&&!card('Inherited').querySelector('.overlay-item-row').closest('.sortable-item').draggable&&!document.querySelector('[aria-label="Move Inherited"]'));
    const before=JSON.stringify(window.snapshot),original=structuredClone(owner());
    const canceled=await drag(card('Magic'),destination('Grouped'),{drop:false});
    check('dragging an overlay card highlights its target and cancellation changes nothing',canceled.marker==='true'&&!window.moveCalls.length&&JSON.stringify(window.snapshot)===before&&!document.querySelector('[data-item-drop]'));
    await drag(handle('Magic'),destination('Source'));
    const blocked=await drag(card('Magic').querySelector('[aria-label="Overlay name"]'),destination('Grouped'));
    check('same-profile drops and dragging editable fields do not move an overlay',!window.moveCalls.length&&blocked.start.defaultPrevented&&JSON.stringify(window.snapshot)===before);
    window.holdSave=true;
    const pending=await drag(handle('Magic'),destination('Grouped'),{end:false});
    check('overlay moves use one atomic API request and lock edits while saving',window.moveCalls.length===1&&window.moveCalls[0].selection.kind==='overlay'&&window.moveCalls[0].selection.items.length===4&&JSON.stringify(window.snapshot)===before&&get('.editor').disabled);
    pending.from.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:pending.transfer}));await wait();
    window.finishSave(false);await wait();window.holdSave=false;
    check('failed overlay moves retain all parts and clear pending drag feedback',JSON.stringify(window.snapshot)===before&&window.errors.length===1&&!get('.editor').disabled&&!document.querySelector('[data-item-drop],[data-drop],.sortable-item--dragging'));
    await drag(card('Magic'),destination('Grouped'));
    check('dropping a whole overlay onto a grouped sidebar profile transfers every owned part',!owner().overlay_groups.length&&!owner().overlay_items.length&&grouped().overlay_groups.some(group=>group.id==='magic')&&grouped().overlay_items.length===4&&window.moveCalls.length===2);
    check('whole-overlay moves preserve all four part types and raw saved appearance settings',JSON.stringify(grouped().overlay_items)===JSON.stringify(original.overlay_items)&&JSON.stringify(grouped().overlay_groups.find(group=>group.id==='magic'))===JSON.stringify(original.overlay_groups[0]));
    check('moving an overlay preserves profile activation membership and existing behavior references',owner().armed&&!grouped().armed&&grouped().subfolder_id==='off'&&!window.snapshot.scopes[0].subfolders[0].enabled&&owner().hotkeys[0].behavior===original.hotkeys[0].behavior&&grouped().overlay_groups[0].id==='existing');
    destination('Grouped').click();await wait();
    const icon=card('Magic').querySelector('.overlay-type-badge--icon').closest('.overlay-item-row');
    const partDrop=await drag(icon,card('Existing'));
    check('a nested part row moves between overlays without dragging its parent overlay',partDrop.marker==='true'&&window.moveCalls.at(-1).selection.kind==='overlayPart'&&window.moveCalls.at(-1).targetGroupId==='existing'&&grouped().overlay_groups.length===2&&grouped().overlay_items.find(item=>item.id==='icon').group_id==='existing'&&grouped().overlay_items.length===4);
    await drag(handle('Magic Text 0'),destination('Across apps'));
    check('individual part handles move to profiles in another app with their overlay container',!grouped().overlay_items.some(item=>item.id==='text')&&across().overlay_items.length===1&&across().overlay_items[0].id==='text'&&across().overlay_groups[0].id==='magic'&&!across().armed);
    await drag(card('Magic'),destination('Fresh'));
    check('whole overlays also move across app folders with their timer state references',!grouped().overlay_groups.some(group=>group.id==='magic')&&grouped().overlay_items.length===1&&fresh().overlay_items.map(item=>item.id).join(',')==='timer,bar'&&window.snapshot.scopes[1].states.some(state=>state.id==='buff')&&fresh().overlay_items[0].timer_state_id==='buff');
    check('moving the overlay does not remove or move unrelated parts',grouped().overlay_groups.length===1&&grouped().overlay_groups[0].id==='existing'&&grouped().overlay_items[0].id==='icon'&&across().overlay_items[0].content==='Literal overlay text');
    const singleton=handle('Existing Icon 0');
    check('a single remaining overlay part still has a drag handle',singleton.draggable);
    await drag(singleton,destination('Across apps'));
    check('the last part moves independently while its original empty overlay remains',grouped().overlay_groups.length===1&&!grouped().overlay_items.length&&across().overlay_items.length===2&&across().overlay_items.find(item=>item.id==='icon').group_id==='existing');
    get('#reload').click();await wait();
    check('overlay moves survive reopening without stale drag state or duplicate parts',!owner().overlay_items.length&&!grouped().overlay_items.length&&across().overlay_items.length===2&&fresh().overlay_items.length===2&&!document.querySelector('[data-item-drop],[data-drop],.sortable-item--dragging'));
    document.getElementById('results').textContent=JSON.stringify({results});
  }catch(error){document.getElementById('results').textContent=JSON.stringify({results,error:error.message,stack:error.stack});}
}

test('whole overlays and nested parts move through actual profile and overlay drop targets', {skip:!browser&&'Chrome or Edge is required'},async t=>{
  const mocks=['./api','./AppConsole','./App.css','./CloudSettings','@tauri-apps/api/event','@tauri-apps/plugin-dialog','@tauri-apps/plugin-opener','@tauri-apps/plugin-notification'];
  const bundle=browserModules(['App.tsx'],{mocks,expose:{[join(root,'src/App.tsx')]:['Library','ProfileEditor','useProfileItemDrag']}});
  const profile=(id,name,extra={})=>({id,name,kind:'overlay',armed:true,parent_id:null,hotkeys:[],events:[],scripts:[],states:[],overlay_groups:[],overlay_items:[],overlay_triggers:[],...extra});
  const part={name:'Legacy saved name',group_id:'magic',state_id:'buff',x:3,y:4};
  const initial={version:8,variables:[],settings:{},scopes:[
    {id:'app',name:'App',exe:'app.exe',states:[{id:'buff',name:'Buff',duration_ms:5000}],subfolders:[{id:'off',name:'Disabled',enabled:false}],profiles:[
      profile('owner','Source',{parent_id:'parent',overlay_groups:[{id:'magic',name:'Magic',x:15,y:25,layout:'row',gap:6,disabled:true}],overlay_items:[
        {...part,id:'timer',type:'timer',duration_ms:5000,color:'#ffffff',font_size:22,timer_state_id:'buff',start_with_overlay:true,show_only_running:true},
        {...part,id:'icon',type:'icon',w:48,h:64,src:'data:image/png;base64,image'},
        {...part,id:'bar',type:'bar',w:200,h:20,color:'#aabbcc',max_value:100},
        {...part,id:'text',type:'text',content:'Literal overlay text',color:'#ffffff',font_size:18}],hotkeys:[{name:'Show',trigger:'f1',behavior:'startoverlay(magic)',state_id:null}]}),
      profile('grouped','Grouped',{armed:false,subfolder_id:'off',overlay_groups:[{id:'existing',name:'Existing'}]}),
      profile('parent','Parent',{overlay_groups:[{id:'inherited',name:'Inherited'}],overlay_items:[{...part,id:'inherited-text',group_id:'inherited',type:'text',content:'Inherited',font_size:16,color:'#fff'}]}),
    ]},
    {id:'other',name:'Other app',exe:'other.exe',states:[],subfolders:[],profiles:[profile('across','Across apps',{armed:false}),profile('fresh','Fresh')]},
  ]};
  const harness=`const modules={${bundle.declarations}},cache={};window.errors=[];window.moveCalls=[];window.saved=${JSON.stringify(initial)};
function load(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;
if(id==='./api'){module.exports={api:{async moveOverlay(sourceGameId,sourceProfileId,selection,targetGameId,dependencies,targetGroupId){window.moveCalls.push(structuredClone({sourceGameId,sourceProfileId,selection,targetGameId,dependencies,targetGroupId}));
if(window.holdSave)await new Promise((resolve,reject)=>window.finishSave=success=>success?resolve():reject(Error('simulated persistence failure')));
const next=structuredClone(window.snapshot),origin=next.scopes.find(scope=>scope.id===sourceGameId),from=origin.profiles.find(profile=>profile.id===sourceProfileId),scope=next.scopes.find(scope=>scope.id===targetGameId),to=scope.profiles.find(profile=>profile.id===dependencies.id);
const items=structuredClone(selection.kind==='overlay'?selection.items:[selection.item]);
let group=selection.kind==='overlay'?structuredClone(selection.group):structuredClone(origin.profiles.flatMap(profile=>profile.overlay_groups).find(group=>group.id===selection.item.group_id));
if(selection.kind==='overlay')from.overlay_groups=from.overlay_groups.filter(current=>current.id!==group.id);
from.overlay_items=from.overlay_items.filter(item=>!items.some(moved=>moved.id===item.id));
if(targetGroupId){for(const item of items)item.group_id=targetGroupId;group=null;}
if(group&&!to.overlay_groups.some(current=>current.id===group.id))to.overlay_groups.push(group);to.overlay_items.push(...items);
for(const part of ['overlay_groups','overlay_items'])for(const item of dependencies[part])if(!scope.profiles.some(profile=>profile[part].some(current=>current.id===item.id)))to[part].push(structuredClone(item));
for(const state of dependencies.states)if(!scope.states.some(current=>current.id===state.id))scope.states.push(structuredClone(state));window.saved=next;return structuredClone(next);}}};return module.exports;}
if(id==='./AppConsole'){module.exports={useErrorReporter:()=>error=>window.errors.push(String(error))};return module.exports;}
if(${JSON.stringify(mocks)}.includes(id))return module.exports;const [code,dependencies]=modules[id];code(module,module.exports,name=>load(dependencies[name]),{env:{NODE_ENV:'production'}});return module.exports;}
const React=load(${JSON.stringify(bundle.react)}),ReactDOM=load(${JSON.stringify(bundle.client)}),{Library,ProfileEditor,useProfileItemDrag}=load(${JSON.stringify(bundle.entry)});
function Fixture(){const [db,onDb]=React.useState(window.saved),[selection,onSelect]=React.useState({kind:'profile',folderId:'app',profileId:'owner'}),[revision,setRevision]=React.useState(0),itemDrag=useProfileItemDrag(db,onDb);window.snapshot=db;
const folder=db.scopes.find(folder=>folder.id===selection.folderId),profile=folder.profiles.find(profile=>profile.id===selection.profileId);
return React.createElement(React.Fragment,null,React.createElement('button',{id:'reload',onClick:()=>{onDb(structuredClone(window.saved));setRevision(revision+1);}},'Reload'),
React.createElement('div',{className:'main-layout'},React.createElement(Library,{key:revision,db,itemDrag,disabledProfiles:new Set(),openExes:new Set(),selection,query:'',collapsed:new Set(),width:320,onQuery(){},onToggleCollapse(){},onSelect,onToggleArmed(){},onProfileContext(){},onFolderContext(){},onDb,onModal(){}}),
React.createElement(ProfileEditor,{key:profile.id+revision,folder,profile,variables:db.variables,itemDrag,showStates:false,onContext(){},onDb,onModal(){}})));}
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
