import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { root, browser, browserModules } from "./browserHarness.mjs";

async function scenario() {
  const results=[], wait=()=>new Promise(resolve=>setTimeout(resolve,150));
  const check=(name,value)=>{if(!value)throw Error(name);results.push(name);};
  const extents=()=>[...document.querySelectorAll('.ov-bar-slot')].map(slot=>{
    const rects=[...slot.querySelectorAll('[data-overlay-part]')].map(part=>part.getBoundingClientRect());
    return {left:Math.min(...rects.map(rect=>rect.left)),right:Math.max(...rects.map(rect=>rect.right)),top:Math.min(...rects.map(rect=>rect.top)),bottom:Math.max(...rects.map(rect=>rect.bottom))};
  });
  const part=id=>document.querySelector(`[data-overlay-part="${id}"]`).getBoundingClientRect();
  const gaps=(layout,gap)=>{
    const bounds=extents();
    return bounds.slice(1).every((bounds,index)=>Math.abs((layout==='row'?bounds.left-extents()[index].right:bounds.top-extents()[index].bottom)-gap)<0.01);
  };
  try {
    await wait();
    check('bar members render in their saved order', [...document.querySelectorAll('.ov-bar-slot')].map(slot=>slot.querySelector('[data-overlay-part]').dataset.overlayPart).join()==='two-icon,one-icon,three-icon');
    check('horizontal bars keep the requested gap across complete differently sized overlays', gaps('row',37));
    check('whole overlays stay on one horizontal axis',part('two-icon').top===part('one-icon').top);
    check('an icon stays centered above its own wider timer',Math.abs(part('one-icon').left+part('one-icon').width/2-part('one-timer').left-part('one-timer').width/2)<0.01);
    window.snapshot.config.bars[0].gap=0;window.publish();await wait();
    check('zero gap closes exactly between the visible bounds',gaps('row',0));
    window.snapshot.runtime.hiddenItems.one=true;window.publish();await wait();
    check('hidden overlays leave no slot or gap',document.querySelectorAll('.ov-bar-slot').length===2&&!document.querySelector('[data-overlay-part="one-icon"]')&&gaps('row',0));
    delete window.snapshot.runtime.hiddenItems.one;
    window.snapshot.config.bars[0].layout='column';window.snapshot.config.bars[0].gap=19;window.publish();await wait();
    check('vertical bars preserve order and use the chosen gap after overlays return',document.querySelectorAll('.ov-bar-slot').length===3&&gaps('column',19));
    check('whole overlays stay on one vertical axis',part('two-icon').left===part('one-icon').left);
    const target=part('one-icon');window.emitFixture('overlay-right-click',[(target.left+target.width/2)*devicePixelRatio,(target.top+target.height/2)*devicePixelRatio]);await wait();
    check('right-click dismissal uses the positioned part hitboxes',window.dismissed.join()==='one-icon');
    window.snapshot.config.bars=[];window.publish();await wait();
    check('leaving a bar restores individual overlay positions',document.querySelectorAll('.ov-bar-slot').length===0&&Math.abs(part('one-icon').left-700/devicePixelRatio)<0.02&&Math.abs(part('one-icon').top-450/devicePixelRatio)<0.02);
    window.snapshot.config.bars=[window.bar];window.publish();await wait();
    check('bar rendering reports no errors',window.errors.length===0);
    document.getElementById('results').textContent=JSON.stringify({results});
  }catch(error){document.getElementById('results').textContent=JSON.stringify({results,error:String(error),stack:error.stack});}
}

test('live overlay bars align complete overlays and follow visibility and hitboxes', {skip:!browser},async t=>{
  const mocks=['@tauri-apps/api/event','@tauri-apps/api/core','./overlay.css','./overlayParts.css'];
  const bundle=browserModules(['OverlayApp.tsx'],{mocks});
  const icon=(id,group_id,w=32)=>({id,group_id,type:'icon',x:0,y:0,w,h:w,src:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="48" height="48"%3E%3Crect width="48" height="48" fill="%239d7bff"/%3E%3C/svg%3E'});
  const bar={id:'buffs',name:'Buffs',x:10,y:20,layout:'row',gap:37,group_ids:['two','one','three']};
  const snapshot={revision:1,config:{profile_id:'game',hotkeys:[],states:[],bars:[bar],groups:[{id:'one',x:50,y:50,layout:'column',gap:4},{id:'two',x:70,y:30,layout:'row',gap:5},{id:'three',x:80,y:60,layout:'free'}],items:[icon('one-icon','one'),{id:'one-timer',group_id:'one',type:'timer',x:0,y:0,duration_ms:10000,color:'#fff',font_size:18,show_background:false},icon('two-icon','two',48),{id:'two-bar',group_id:'two',type:'bar',x:0,y:0,w:80,h:12,color:'#4ade80',max_value:100},{...icon('three-icon','three',24),x:2,y:3}]},runtime:{flags:{},timers:{},itemTimers:{},hiddenItems:{}}};
  const logs=join(root,'logs');mkdirSync(logs,{recursive:true});
  for (const scale of [1,1.5]) await t.test(`${scale*100}% display scaling`,async()=>{
  const directory=mkdtempSync(join(logs,'overlay-bar-layout-'));
  try{
    const harness=`const modules={${bundle.declarations}},cache={},listeners={};window.errors=[];window.dismissed=[];window.snapshot=${JSON.stringify(snapshot)};window.bar=${JSON.stringify(bar)};
function load(id){if(cache[id])return cache[id].exports;const module=cache[id]={exports:{}};
if(id==='@tauri-apps/api/event'){module.exports={async listen(name,callback){listeners[name]=callback;return()=>delete listeners[name];},async emitTo(_target,_name,error){window.errors.push(String(error));}};return module.exports;}
if(id==='@tauri-apps/api/core'){module.exports={async invoke(name,args){if(name==='get_overlay_snapshot')return structuredClone(window.snapshot);if(name==='get_overlay_origin')return [100,50,1200,800];if(name==='dismiss_overlay_item')window.dismissed.push(args.id);}};return module.exports;}
if(id.endsWith('.css'))return module.exports;const [code,dependencies]=modules[id];code(module,module.exports,name=>load(dependencies[name]),{env:{NODE_ENV:'production'}});return module.exports;}
window.emitFixture=(name,payload)=>listeners[name]({payload});window.publish=()=>{window.snapshot.revision++;window.emitFixture('overlay-snapshot',structuredClone(window.snapshot));};
const React=load(${JSON.stringify(bundle.react)}),ReactDOM=load(${JSON.stringify(bundle.client)}),{default:OverlayApp}=load(${JSON.stringify(bundle.entry)});ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(OverlayApp));(${scenario})();`;
    const page=join(directory,'layout.html');writeFileSync(page,`<!doctype html><style>${readFileSync(join(root,'src/overlayParts.css'),'utf8')}${readFileSync(join(root,'src/overlay.css'),'utf8')}body{background:#17171e;color:white;margin:0}#results{position:absolute;left:-10000px}</style><div id="root"></div><pre id="results"></pre><script>${harness.replace(/<\/script/gi,'<\\/script')}</script>`);
    const output=execFileSync(browser,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check',`--force-device-scale-factor=${scale}`,`--user-data-dir=${join(directory,'profile')}`,'--window-size=1400,1100','--virtual-time-budget=12000',`--screenshot=${join(logs,`overlay-bar-live-${scale}.png`)}`,'--dump-dom',pathToFileURL(page).href],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
    const match=output.match(/<pre id="results">([^<]+)<\/pre>/);assert.ok(match,'live bar scenario did not finish');
    const result=JSON.parse(match[1].replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));assert.equal(result.error,undefined,result.stack??result.error);
  }finally{assert.equal(dirname(directory),logs);rmSync(directory,{recursive:true,force:true});}
  });
});
