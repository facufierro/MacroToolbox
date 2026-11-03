import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { root, browser, browserModules } from "./browserHarness.mjs";

async function scenario() {
  const results = [], wait = () => new Promise(resolve => setTimeout(resolve,40));
  const get = selector => { const element=document.querySelector(selector); if (!element) throw Error(`Missing ${selector}`); return element; };
  const check = (name,value) => { if (!value) throw Error(name); results.push(name); };
  const handle = name => get(`.editor .drag-handle[aria-label="Move ${name}"]`);
  const row = name => [...document.querySelectorAll('.editor .step-row')].find(element=>element.querySelector('.step-row__name')?.textContent===name);
  const destination = name => [...document.querySelectorAll('.profile-row')].find(element=>element.querySelector('.profile-row__name').textContent===name);
  const source = () => window.snapshot.scopes[0].profiles[0];
  const target = () => window.snapshot.scopes[1].profiles[0];
  async function drag(from,to,{drop=true,end=true}={}) {
    from.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    const transfer=new DataTransfer();
    const start=new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer});
    from.dispatchEvent(start); await wait();
    const over=new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer});
    to.dispatchEvent(over); await wait();
    const marker=to.dataset.itemDrop;
    if(drop)to.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
    if(end)from.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:transfer}));
    await wait();
    return {marker,start,from,transfer};
  }
  try {
    await wait();
    const inherited=[...document.querySelectorAll('.editor .step-row')].find(element=>element.textContent.includes('Inherited'));
    check('inherited behaviors remain owned by their original profile', !inherited.closest('.sortable-item').draggable && !document.querySelector('.editor [aria-label="Move Inherited"]'));
    await drag(row('Stay'),row('Move me').closest('.sortable-item'));
    check('whole-row dragging still reorders behaviors inside the editor', source().hotkeys.map(hotkey=>hotkey.name).join(',')==='Stay,Move me,Blank copy' && !window.moveCalls.length);
    await drag(row('Move me'),row('Stay').closest('.sortable-item'));
    const moveBefore=JSON.stringify(window.snapshot);
    const canceled=await drag(row('Move me'),destination('Across apps'),{drop:false});
    check('whole behavior rows highlight the destination and cancel without saving', canceled.marker==='true' && !window.moveCalls.length && JSON.stringify(window.snapshot)===moveBefore && !document.querySelector('[data-item-drop]'));
    await drag(handle('Move me'),destination('Source'));
    await drag(handle('Stay'),destination('Grouped'));
    check('same-profile drops and assigned-trigger conflicts cannot overwrite behaviors', !window.moveCalls.length && JSON.stringify(window.snapshot)===moveBefore && !document.querySelector('[data-item-drop]'));
    destination('Across apps').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:new DataTransfer()}));await wait();
    check('external drops cannot move a previously dragged behavior', !window.moveCalls.length);

    const blocked=await drag(row('Move me').querySelector('[aria-label="Edit"]'),destination('Across apps'));
    check('dragging an edit control does not start a row move', blocked.start.defaultPrevented && !window.moveCalls.length);

    window.deferSave=true;
    const pending=await drag(row('Move me'),destination('Across apps'),{end:false});
    check('one atomic save handles both profiles while the original stays visible', window.moveCalls.length===1 && JSON.stringify(window.snapshot)===moveBefore && get('.editor').disabled);
    await drag(row('Stay'),destination('Across apps'));
    check('pending moves prevent additional behavior drags', window.moveCalls.length===1);
    pending.from.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:pending.transfer}));await wait();
    window.finishSave(false);await wait();
    check('failed saves preserve both profiles and clear all drag feedback', JSON.stringify(window.snapshot)===moveBefore && window.errors.length===1 && !get('.editor').disabled && !document.querySelector('[data-item-drop],[data-drop],.sortable-item--dragging'));

    window.deferSave=false;
    const moving=source().hotkeys[0];
    await drag(row('Move me'),destination('Across apps'));
    check('dropping a whole behavior row moves it once across app folders', window.moveCalls.length===2 && source().hotkeys.length===2 && target().hotkeys.length===1 && JSON.stringify(target().hotkeys[0])===JSON.stringify(moving));
    check('cross-app moves carry referenced scripts states and overlays', target().scripts[0].id==='script' && target().overlay_items[0].id==='timer' && target().overlay_groups[0].id==='overlay' && window.snapshot.scopes[1].states[0].id==='state');
    check('moves retain profile activation and keep source resources available', source().armed && !target().armed && !window.snapshot.scopes[1].subfolders[0].enabled && target().subfolder_id==='off' && source().scripts.length===1 && source().overlay_items.length===1);
    const grouped=window.snapshot.scopes[0].profiles[1];
    await drag(handle('Blank copy'),destination('Grouped'));
    check('drag handles also move unassigned copies into profiles inside subfolders', source().hotkeys.length===1 && window.snapshot.scopes[0].profiles[1].hotkeys.length===2 && !window.snapshot.scopes[0].profiles[1].hotkeys[1].trigger && window.snapshot.scopes[0].profiles[1].armed===grouped.armed);
    check('a single owned behavior still supports dragging', handle('Stay').draggable && handle('Stay').closest('.sortable-item').draggable);
    await drag(row('Stay'),destination('Across apps'));
    check('the last owned behavior can move without changing inherited entries', source().hotkeys.length===0 && target().hotkeys.length===2 && !![...document.querySelectorAll('.editor .step-row')].find(element=>element.textContent.includes('Inherited')));
    get('#reload').click();await wait();
    check('moved behaviors and references survive reopening', source().hotkeys.length===0 && target().hotkeys.length===2 && target().scripts[0].id==='script' && !target().armed && !document.querySelector('[data-item-drop],[data-drop],.sortable-item--dragging'));
    document.getElementById('results').textContent=JSON.stringify({results});
  } catch(error) { document.getElementById('results').textContent=JSON.stringify({results,error:error.message,stack:error.stack}); }
}

test('behavior dragging moves between sidebar profiles atomically and preserves failed or canceled moves', {skip:!browser && 'Chrome or Edge is required'}, async t => {
  const mocks=['./api','./AppConsole','./App.css','./CloudSettings','@tauri-apps/api/event','@tauri-apps/plugin-dialog','@tauri-apps/plugin-opener','@tauri-apps/plugin-notification'];
  const bundle=browserModules(['App.tsx'],{mocks,expose:{[join(root,'src/App.tsx')]:['Library','ProfileEditor','useProfileItemDrag']}});
  const profile=(id,name,extra={})=>({id,name,kind:'hotkeys',armed:true,parent_id:null,hotkeys:[],events:[],scripts:[],states:[],overlay_items:[],overlay_groups:[],overlay_triggers:[],...extra});
  const move={name:'Move me',trigger:'f1',state_id:'state',allow_extra_modifiers:false,behavior:JSON.stringify([{type:'script',scriptId:'script'},{type:'startoverlay',itemId:'overlay'},{type:'press',key:{source:'trigger'},onRelease:true}])};
  const initial={version:8,settings:{},variables:[],scopes:[
    {id:'source-app',name:'Source app',exe:'source.exe',states:[{id:'state',name:'State'}],subfolders:[{id:'group',name:'Group',enabled:true}],profiles:[
      profile('source','Source',{parent_id:'parent',hotkeys:[move,{name:'Stay',trigger:'f2',behavior:'press(x)'},{name:'Blank copy',trigger:'',behavior:'press(y)'}],
        scripts:[{id:'script',name:'Script',trigger:'hotkey',source:'code',language:'python',code:'print(1)',enabled:true}],
        overlay_groups:[{id:'overlay',name:'Overlay'}],overlay_items:[{id:'timer',name:'Timer',type:'timer',group_id:'overlay',duration_ms:5000,state_id:'state'}]}),
      profile('grouped','Grouped',{subfolder_id:'group',hotkeys:[{name:'Conflict',trigger:'f2',behavior:'press(z)'}]}),
      profile('parent','Parent',{hotkeys:[{name:'Inherited',trigger:'f8',behavior:'press(i)'}]}),
    ]},
    {id:'target-app',name:'Target app',exe:'target.exe',states:[],subfolders:[{id:'off',name:'Disabled',enabled:false}],profiles:[profile('target','Across apps',{armed:false,subfolder_id:'off'})]},
  ]};
  const harness=`const modules={${bundle.declarations}},cache={};window.errors=[];window.moveCalls=[];window.saved=${JSON.stringify(initial)};
function load(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;
if(id==='./api'){module.exports={api:{async upsertProfile(gameId,profile){const next=structuredClone(window.snapshot),folder=next.scopes.find(scope=>scope.id===gameId);folder.profiles=folder.profiles.map(current=>current.id===profile.id?profile:current);window.saved=next;return structuredClone(next);},async moveHotkey(sourceGameId,sourceProfileId,index,hotkey,targetGameId,dependencies){window.moveCalls.push({sourceGameId,sourceProfileId,index,hotkey:structuredClone(hotkey),targetGameId,dependencies:structuredClone(dependencies)});
if(window.deferSave)await new Promise((resolve,reject)=>window.finishSave=success=>success?resolve():reject(Error('simulated persistence failure')));
const next=structuredClone(window.snapshot),from=next.scopes.find(scope=>scope.id===sourceGameId).profiles.find(profile=>profile.id===sourceProfileId),scope=next.scopes.find(scope=>scope.id===targetGameId),to=scope.profiles.find(profile=>profile.id===dependencies.id);
if(JSON.stringify(from.hotkeys[index])!==JSON.stringify(hotkey))throw Error('source changed');to.hotkeys.push(from.hotkeys.splice(index,1)[0]);
for(const part of ['scripts','overlay_items','overlay_groups'])for(const item of dependencies[part])if(!scope.profiles.some(profile=>profile[part].some(current=>current.id===item.id)))to[part].push(structuredClone(item));
for(const state of dependencies.states)if(!scope.states.some(current=>current.id===state.id))scope.states.push(structuredClone(state));window.saved=next;return structuredClone(next);}}};return module.exports;}
if(id==='./AppConsole'){module.exports={useErrorReporter:()=>error=>window.errors.push(String(error))};return module.exports;}
if(${JSON.stringify(mocks)}.includes(id))return module.exports;const [code,dependencies]=modules[id];code(module,module.exports,name=>load(dependencies[name]),{env:{NODE_ENV:'production'}});return module.exports;}
const React=load(${JSON.stringify(bundle.react)}),ReactDOM=load(${JSON.stringify(bundle.client)}),{Library,ProfileEditor,useProfileItemDrag}=load(${JSON.stringify(bundle.entry)});
function Fixture(){const [db,onDb]=React.useState(window.saved),[revision,setRevision]=React.useState(0),itemDrag=useProfileItemDrag(db,onDb);window.snapshot=db;const folder=db.scopes[0],profile=folder.profiles[0];
return React.createElement(React.Fragment,null,React.createElement('button',{id:'reload',onClick:()=>{onDb(structuredClone(window.saved));setRevision(revision+1);}},'Reload'),
React.createElement('div',{className:'main-layout'},React.createElement(Library,{key:revision,db,itemDrag,disabledProfiles:new Set(),openExes:new Set(),selection:{kind:'profile',folderId:folder.id,profileId:profile.id},query:'',collapsed:new Set(),width:320,onQuery(){},onToggleCollapse(){},onSelect(){},onToggleArmed(){},onProfileContext(){},onFolderContext(){},onDb,onModal(){}}),
React.createElement(ProfileEditor,{key:'editor'+revision,folder,profile,variables:db.variables,itemDrag,showStates:false,onContext(){},onDb,onModal(){}})));}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));(${scenario})();`;
  const logs=join(root,'logs');mkdirSync(logs,{recursive:true});
  const directory=mkdtempSync(join(logs,'hotkey-drag-ui-'));let result;
  try {
    const page=join(directory,'drag.html');
    writeFileSync(page,`<!doctype html><style>${readFileSync(join(root,'src/App.css'),'utf8')}#results{position:absolute;left:-10000px}</style><div id="root"></div><pre id="results"></pre><script>${harness.replace(/<\/script/gi,'<\\/script')}</script>`);
    const output=execFileSync(browser,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${join(directory,'profile')}`,'--window-size=1300,1000','--virtual-time-budget=10000','--dump-dom',pathToFileURL(page).href],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
    const match=output.match(/<pre id="results">([^<]+)<\/pre>/);assert.ok(match,'browser did not complete drag checks');
    result=JSON.parse(match[1].replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));
  } finally {assert.equal(dirname(directory),logs);rmSync(directory,{recursive:true,force:true});}
  for(const name of result.results)await t.test(name,()=>{});
  assert.equal(result.error,undefined,result.stack??result.error);
});
