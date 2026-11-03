import assert from "node:assert/strict";
import test from "node:test";
import { areStepsValid, describeBehavior, expandBehavior, parseSteps, stepsToString } from "../src/behaviors.ts";
import { removeOverlayGroup } from "../src/overlayItems.ts";
import { removeScriptReferences } from "../src/scriptReferences.ts";

test("Wait for uses the next action without adding a separate value or changing its settings",()=>{
  for(const action of [
    {type:"mousepress",key:"rctrl LButton",onRelease:true,doubleClick:true},
    {type:"startoverlay",itemIds:["timer"],restart:true},
    {type:"stopoverlay",itemIds:["timer"]}, {type:"sleep",ms:"25"},
    {type:"script",scriptId:"script"}, {type:"state",stateId:"state",action:"set"},
    {type:"sequence",steps:[{type:"sleep",ms:"20"},{type:"send",text:"done"}]},
    {type:"parallel",steps:[{type:"press",key:"x"},{type:"press",key:"y"}]},
  ]){
    const steps=[{type:"waitfor"},action];
    assert.deepEqual(parseSteps(stepsToString(steps)),steps);
    assert.equal(areStepsValid(steps),true);
    assert.match(describeBehavior(stepsToString(steps),id=>id,id=>id),/^waitfor\(next action\)/);
  }
});

test("a Wait for without a following action is invalid in every list scope",()=>{
  for(const steps of [[{type:"waitfor"}],[{type:"send",text:"prefix"},{type:"waitfor"}],
    [{type:"sequence",steps:[{type:"waitfor"}]},{type:"press",key:"x"}],
    [{type:"parallel",steps:[{type:"press",key:"x"},{type:"waitfor"}]}]])assert.equal(areStepsValid(steps),false);
  assert.equal(areStepsValid([{type:"waitfor"},{type:"waitfor"},{type:"press",key:"x"}]),true);
});

test("following actions retain their variables and trigger requirements",()=>{
  const variables=[{id:"keys",name:"Keys",type:"keys",value:"rctrl LButton"},
    {id:"cast",name:"Cast",type:"behavior",value:stepsToString([{type:"waitfor"},{type:"mousepress",key:{variable:"keys"},onRelease:true}])}];
  const steps=[{type:"waitfor"},{type:"behavior",variableId:"cast"}];
  assert.equal(areStepsValid(steps,variables),true);
  assert.equal(areStepsValid(steps,variables,false),false);
  const expanded=parseSteps(expandBehavior(stepsToString(steps),variables));
  assert.deepEqual(expanded,[{type:"waitfor"},{type:"sequence",steps:parseSteps(variables[1].value)}]);
  assert.equal(areStepsValid(expanded,variables),true);
});

test("saved input waits become plain waits followed by their input action",()=>{
  const expected=[{type:"waitfor"},{type:"mousepress",key:"LButton"}];
  assert.deepEqual(parseSteps("waitfor(LButton)"),expected);
  assert.deepEqual(parseSteps(JSON.stringify([{type:"waitfor",key:"LButton"}])),expected);
  assert.equal(areStepsValid(expected),true);
  assert.equal(areStepsValid(parseSteps("waitfor()")),false);
  const variables=[{id:"keys",name:"Keys",type:"keys",value:"LButton"}];
  const referenced=parseSteps(JSON.stringify([{type:"waitfor",key:{variable:"keys"}}]));
  assert.deepEqual(referenced,[{type:"waitfor"},{type:"press",key:{variable:"keys"}}]);
  assert.equal(areStepsValid(referenced,variables),true);
  assert.deepEqual(parseSteps(JSON.stringify([{type:"parallel",steps:[{type:"waitfor",key:"rctrl x"}]}])),
    [{type:"parallel",steps:[{type:"waitfor"},{type:"press",key:"rctrl x"}]}]);
});

test("deleting a referenced next action does not leave an invalid trailing wait",()=>{
  const profile={id:"profile",overlay_groups:[{id:"overlay",name:"Overlay"}],overlay_items:[],events:[],
    hotkeys:[{behavior:stepsToString([{type:"send",text:"keep"},{type:"waitfor"},{type:"startoverlay",itemIds:["overlay"],restart:true}])}]};
  const after=removeOverlayGroup({profiles:[profile]},profile.id,"overlay");
  assert.deepEqual(parseSteps(after.profiles[0].hotkeys[0].behavior),[{type:"send",text:"keep"}]);
  profile.hotkeys[0].behavior=stepsToString([{type:"sequence",steps:[{type:"waitfor"},{type:"waitfor"},{type:"script",scriptId:"script"}]}]);
  assert.equal(removeScriptReferences({profiles:[profile]},"script").profiles[0].hotkeys[0].behavior,"");
});

test("unsupported fields on keyless waits remain visible and cannot disappear on save",()=>{
  const source=JSON.stringify([{type:"waitfor",future:"value"},{type:"press",key:"x"}]);
  const steps=parseSteps(source);
  assert.equal(steps[0].type,"unknown");
  assert.equal(areStepsValid(steps),false);
  assert.match(steps[0].source,/future/);
});
