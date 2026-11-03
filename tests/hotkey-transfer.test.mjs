import assert from "node:assert/strict";
import test from "node:test";
import { canMoveHotkey, prepareHotkeyMove } from "../src/hotkeyTransfer.ts";
import { stepsToString } from "../src/behaviors.ts";

const profile = (id, overrides = {}) => ({ id, name:id, armed:true, parent_id:null, subfolder_id:null,
  hotkeys:[], events:[], scripts:[], states:[], overlay_items:[], overlay_groups:[], ...overrides });
const timer = {type:"timer",id:"timer",name:"Timer",group_id:"overlay",duration_ms:5000,state_id:"state",timer_state_id:"timer-state"};
const script = {id:"script",name:"Script",language:"python",body:"print('hello')"};
const states = ["state","timer-state","action-state","unused"].map(id => ({id,name:id,duration_ms:null}));
const variables = [{id:"nested",name:"Nested",type:"behavior",value:stepsToString([
  {type:"state",stateId:"action-state",action:"enter"}, {type:"script",scriptId:"script"},
  {type:"startoverlay",itemId:"overlay"}, {type:"securesend",credentialId:"saved-password"},
])}];
function fixture(trigger = "rctrl f1") {
  const hotkey = {name:"Move me",trigger,state_id:"state",allow_extra_modifiers:false,
    behavior:stepsToString([{type:"sequence",steps:[{type:"behavior",variableId:"nested"},{type:"press",key:{source:"trigger"},onRelease:true}]}])};
  const owner = profile("source", {hotkeys:[hotkey],scripts:[script],overlay_items:[timer],
    overlay_groups:[{id:"overlay",name:"Overlay",visible_while_timer_id:"timer"}]});
  const target = profile("target", {armed:false,subfolder_id:"off",hotkeys:[{name:"Existing",trigger:"f2",behavior:"press(x)"}]});
  const db = {version:8,settings:{},variables,scopes:[
    {id:"source-app",states,profiles:[owner,profile("sibling")]},
    {id:"target-app",states:[],subfolders:[{id:"off",name:"Off",enabled:false}],profiles:[target]},
  ]};
  return {db,hotkey,owner,target,source:{gameId:"source-app",profileId:"source",index:0,hotkey}};
}

test("moving across app folders carries nested behavior references without changing either saved profile", () => {
  const {db,hotkey,source,target} = fixture(), before = structuredClone(db);
  const result = prepareHotkeyMove(db,source,"target-app","target");
  assert.deepEqual(result.hotkeys,[...target.hotkeys,hotkey]);
  assert.equal(result.armed,false);
  assert.equal(result.subfolder_id,"off");
  assert.deepEqual(result.scripts,[script]);
  assert.deepEqual(new Set(result.states.map(state => state.id)),new Set(["state","timer-state","action-state"]));
  assert.deepEqual(result.overlay_items.map(item => item.id),["timer"]);
  assert.deepEqual(result.overlay_groups.map(group => group.id),["overlay"]);
  assert.equal(result.hotkeys[1].behavior,hotkey.behavior);
  assert.deepEqual(db,before);
});

test("same-app moves retain shared ownership without duplicating resource definitions", () => {
  const {db,source,owner} = fixture();
  const result = prepareHotkeyMove(db,source,"source-app","sibling");
  assert.deepEqual(result.hotkeys,owner.hotkeys);
  for (const part of ["scripts","states","overlay_items","overlay_groups"]) assert.deepEqual(result[part],[]);
});

test("destination resource definitions and profile settings take precedence", () => {
  const {db,source,target} = fixture();
  target.scripts = [{...script,body:"target version"}];
  target.overlay_items = [{...timer,duration_ms:2000}];
  target.overlay_groups = [{id:"overlay",name:"Target overlay"}];
  target.states = [{...states[0],name:"Target state"}];
  db.scopes[1].states = target.states;
  const result = prepareHotkeyMove(db,source,"target-app","target");
  assert.deepEqual(result.scripts,target.scripts);
  assert.equal(result.overlay_items[0].duration_ms,2000);
  assert.equal(result.overlay_groups[0].name,"Target overlay");
  assert.equal(result.states[0].name,"Target state");
});

test("assigned literal and variable triggers cannot overwrite a destination hotkey", () => {
  for (const trigger of ["rctrl f1",{variable:"shortcuts"}]) {
    const {db,source,target} = fixture(trigger);
    target.hotkeys.push({...source.hotkey,name:"Keep me"});
    const before = structuredClone(db);
    assert.equal(canMoveHotkey(db,source,"target-app","target"),false);
    assert.throws(()=>prepareHotkeyMove(db,source,"target-app","target"),/trigger/);
    assert.deepEqual(db,before);
  }
});

test("unassigned copies remain separate and inherited triggers can be overridden", () => {
  for (const trigger of [""," "]) {
    const {db,source,target} = fixture(trigger);
    target.hotkeys.push({...source.hotkey,name:"Another unassigned copy"});
    assert.equal(canMoveHotkey(db,source,"target-app","target"),true);
    assert.equal(prepareHotkeyMove(db,source,"target-app","target").hotkeys.length,3);
  }
  const {db,source,target} = fixture();
  target.parent_id = "parent";
  db.scopes[1].profiles.push(profile("parent",{hotkeys:[source.hotkey]}));
  assert.equal(canMoveHotkey(db,source,"target-app","target"),true);
});

test("missing targets, same-profile drops and stale source indices leave settings untouched", () => {
  const {db,source} = fixture(), before = structuredClone(db);
  for (const [game,id] of [["source-app","source"],["missing","target"],["target-app","missing"]]) {
    assert.equal(canMoveHotkey(db,source,game,id),false);
    assert.throws(()=>prepareHotkeyMove(db,source,game,id));
  }
  for (const change of [{index:3},{profileId:"missing"},{gameId:"missing"},
    {hotkey:{...source.hotkey,behavior:"send(changed)"}},{hotkey:{...source.hotkey,state_id:"changed"}},
    {hotkey:{...source.hotkey,allow_extra_modifiers:true}}]) {
    assert.throws(()=>prepareHotkeyMove(db,{...source,...change},"target-app","target"),/changed/);
  }
  assert.deepEqual(db,before);
});
