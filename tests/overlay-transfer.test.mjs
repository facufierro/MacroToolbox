import assert from "node:assert/strict";
import test from "node:test";
import { canMoveOverlay, prepareOverlayMove } from "../src/overlayTransfer.ts";

const profile = (id, extra = {}) => ({ id,name:id,armed:true,parent_id:null,subfolder_id:null,hotkeys:[],events:[],scripts:[],states:[],overlay_groups:[],overlay_items:[],...extra });
const group = {id:"overlay",name:"Magic",disabled:true,x:20,y:30,layout:"row",gap:6,visible_while_timer_id:"external"};
const timer = {id:"timer",name:"Saved timer name",type:"timer",group_id:"overlay",x:3,y:4,duration_ms:5000,color:"#fff",font_size:20,state_id:"state",timer_state_id:"timer-state"};
const icon = {id:"icon",name:"Saved icon name",type:"icon",group_id:"overlay",x:1,y:2,w:64,h:48,src:"data:image/png;base64,image",state_id:"state",visible_while_timer_id:"timer"};
function fixture() {
  const owner=profile("owner",{overlay_groups:[group,{id:"external-overlay",name:"Clock"}],overlay_items:[timer,icon,
    {...timer,id:"external",group_id:"external-overlay",state_id:"external-state",timer_state_id:null},
    {...icon,id:"unrelated",group_id:"external-overlay",visible_while_timer_id:null}],hotkeys:[{trigger:"f1",behavior:"startoverlay(overlay)"}]});
  const target=profile("target",{armed:false,subfolder_id:"off",overlay_groups:[{id:"existing",name:"Existing"}],overlay_items:[{...icon,id:"existing-part",group_id:"existing"}]});
  const db={version:8,variables:[],settings:{},scopes:[
    {id:"app",states:["state","timer-state","external-state"].map(id=>({id,name:id,duration_ms:null})),profiles:[owner,profile("same")]},
    {id:"other",states:[],profiles:[target]},
  ]};
  const source={kind:"overlay",gameId:"app",profileId:"owner",group,items:[timer,icon]};
  const part={kind:"overlayPart",gameId:"app",profileId:"owner",item:icon};
  return {db,owner,target,source,part};
}

test("whole-overlay moves retain every part and all overlay settings without mutating the database",()=>{
  const {db,source,owner}=fixture(),before=structuredClone(db);
  const moved=prepareOverlayMove(db,source,"app","same");
  assert.deepEqual(moved.overlay_groups,[group]);
  assert.deepEqual(moved.overlay_items.map(item=>item.id),["timer","icon"]);
  for(const item of source.items)assert.deepEqual({...moved.overlay_items.find(moved=>moved.id===item.id),name:item.name},item);
  assert.deepEqual(owner.hotkeys,before.scopes[0].profiles[0].hotkeys);
  assert.deepEqual(db,before);
});

test("cross-app overlays carry linked timers and their states without importing unrelated parts",()=>{
  const {db,source,target}=fixture();
  const moved=prepareOverlayMove(db,source,"other","target");
  assert.equal(moved.armed,false);assert.equal(moved.subfolder_id,"off");
  assert.deepEqual(moved.overlay_groups.map(group=>group.id),["existing","overlay","external-overlay"]);
  assert.deepEqual(new Set(moved.overlay_items.map(item=>item.id)),new Set(["existing-part","timer","icon","external"]));
  assert.deepEqual(new Set(moved.states.map(state=>state.id)),new Set(["state","timer-state","external-state"]));
  assert.equal(moved.overlay_groups[1].visible_while_timer_id,"external");
  assert.equal(moved.overlay_items.find(item=>item.id==="icon").src,icon.src);
  assert.deepEqual(moved.overlay_items[0],target.overlay_items[0]);
});

test("moving one part carries its container and timer dependencies without moving its siblings",()=>{
  const {db,part}=fixture();
  const moved=prepareOverlayMove(db,part,"other","target");
  assert.deepEqual(new Set(moved.overlay_items.map(item=>item.id)),new Set(["existing-part","icon","timer","external"]));
  const noTimer={...part,item:{...icon,visible_while_timer_id:null}};
  db.scopes[0].profiles[0].overlay_items[1]=noTimer.item;
  db.scopes[0].profiles[0].overlay_groups[0]={...group,visible_while_timer_id:null};
  const only=prepareOverlayMove(db,noTimer,"other","target");
  assert.deepEqual(only.overlay_items.map(item=>item.id),["existing-part","icon"]);
  assert.equal(only.overlay_groups.find(group=>group.id==="overlay").layout,"row");
});

test("parts move directly between overlays while retaining their identity and appearance",()=>{
  const {db,part}=fixture(),before=structuredClone(db);
  const moved=prepareOverlayMove(db,part,"app","owner","external-overlay");
  assert.deepEqual(moved.overlay_groups,db.scopes[0].profiles[0].overlay_groups);
  assert.equal(moved.overlay_items.filter(item=>item.id==="icon").length,1);
  assert.deepEqual({...moved.overlay_items.find(item=>item.id==="icon"),group_id:icon.group_id,name:icon.name},icon);
  assert.equal(moved.overlay_items.find(item=>item.id==="icon").group_id,"external-overlay");
  const cross=prepareOverlayMove(db,part,"other","target","existing");
  assert.equal(cross.overlay_items.find(item=>item.id==="icon").group_id,"existing");
  assert.ok(cross.overlay_items.some(item=>item.id==="timer"));
  assert.ok(!cross.overlay_items.some(item=>item.id==="unrelated"));
  assert.deepEqual(db,before);
});

test("destination collisions and missing destinations reject drops without changing either owner",()=>{
  const {db,source,part,target}=fixture();
  for(const [game,id,groupId] of [["app","owner"],["missing","target"],["other","missing"],["other","target","missing"]]){
    assert.equal(canMoveOverlay(db,source,game,id,groupId),false);
    assert.throws(()=>prepareOverlayMove(db,source,game,id,groupId));
  }
  assert.equal(canMoveOverlay(db,part,"app","owner","overlay"),false);
  target.overlay_groups.push(group);
  assert.equal(canMoveOverlay(db,source,"other","target"),false);
  target.overlay_groups.pop();target.overlay_items.push(icon);
  assert.equal(canMoveOverlay(db,part,"other","target"),false);
  target.overlay_items.pop();target.parent_id="parent";
  db.scopes[1].profiles.push(profile("parent",{overlay_groups:[group],overlay_items:[icon]}));
  assert.equal(canMoveOverlay(db,source,"other","target"),true);
  assert.equal(canMoveOverlay(db,part,"other","target"),true);
});

test("empty overlays can move and inherited or changed entries require their current owner",()=>{
  const {db,source,part}=fixture();
  const empty={...source,group:{...group,id:"empty",name:"Empty"},items:[]};
  db.scopes[0].profiles[0].overlay_groups.push(empty.group);
  assert.deepEqual(prepareOverlayMove(db,empty,"app","same").overlay_items,[]);
  assert.throws(()=>prepareOverlayMove(db,{...source,profileId:"same"},"other","target"),/changed/);
  assert.throws(()=>prepareOverlayMove(db,{...part,item:{...icon,w:100}},"other","target"),/changed/);
  assert.throws(()=>prepareOverlayMove(db,{...source,group:{...group,x:99}},"other","target"),/changed/);
});

test("moving into a child profile creates owned entries in its inherited slots",()=>{
  const {db,source}=fixture(),child=db.scopes[0].profiles[1];
  child.parent_id="owner";
  assert.equal(canMoveOverlay(db,source,"app","same"),true);
  const moved=prepareOverlayMove(db,source,"app","same");
  assert.deepEqual(moved.overlay_groups,[group]);
  assert.deepEqual(moved.overlay_items.map(item=>item.id),["timer","icon"]);
  assert.equal(moved.parent_id,"owner");
});
