import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { carryReferencedOverlayParts, mapOverlayActions, remapOverlayReferences, resolveOverlayItems, resolveOverlayGroups } from "../src/overlayItems.ts";
import { carryReferencedStates, mapStateActions } from "../src/profileStates.ts";
import { carryReferencedScripts, mapScriptActions } from "../src/scriptReferences.ts";
import { exportVariables, importVariables, mapVariableBehaviors } from "../src/variables.ts";
import { resolveProfileEntries } from "../src/profileEntries.ts";
import { triggerIdentity } from "../src/triggers.ts";
import { expandBehavior } from "../src/behaviors.ts";

const source = ts.createSourceFile("App.tsx",readFileSync(new URL("../src/App.tsx",import.meta.url),"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const names = new Set(["uid","hotkeyEntryKey","resolveHotkeys","resolveEvents","materializeProfile","remapProfileIds","remapBehaviorIds","carryStates","handleCopyProfile"]);
const functions = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) functions.push(node.getText(source));
  ts.forEachChild(node,visit);
}
visit(source);
assert.equal(functions.length,names.size);
const compiled = ts.transpileModule(functions.join("\n"),{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;

test("copying a profile carries its folder variables and remaps resources inside shared behaviors", async () => {
  const profile = {id:"p",name:"Profile",parent_id:null,armed:true,states:[],scripts:[],overlay_items:[],overlay_groups:[],
    hotkeys:[{trigger:"f1",state_id:"state",behavior:'[{"type":"behavior","variableId":"cast"}]'}],events:[]};
  const resources = {...profile,id:"resources",hotkeys:[],scripts:[{id:"script",name:"Script"}],
    overlay_groups:[{id:"overlay",name:"Overlay"}],overlay_items:[{id:"timer",type:"timer",group_id:"overlay",timer_state_id:"state"}]};
  const variable = {id:"cast",name:"Cast",type:"behavior",value:JSON.stringify([
    {type:"state",stateId:"state",action:"enter"},{type:"script",scriptId:"script"},{type:"startoverlay",itemIds:["overlay"]},
  ])};
  const db = {scopes:[{id:"a",states:[{id:"state",name:"State",duration_ms:null}],variables:[variable],profiles:[profile,resources]},
    {id:"b",states:[],variables:[{id:"cast",name:"Cast",type:"number",value:900}],profiles:[]}]};
  const before = structuredClone(db), errors = []; let saved;
  const context = {db,crypto,triggerIdentity,resolveProfileEntries,resolveOverlayItems,resolveOverlayGroups,
    carryReferencedOverlayParts,carryReferencedStates,carryReferencedScripts,mapStateActions,mapScriptActions,mapOverlayActions,
    remapOverlayReferences,exportVariables,importVariables,mapVariableBehaviors,
    api:{async upsertProfile(gameId,copy,variables){ saved=JSON.parse(JSON.stringify({gameId,copy,variables})); return db; }},
    handleDb(){},setModal(){},reportError:error=>errors.push(error)};
  runInNewContext(compiled,context);
  await context.handleCopyProfile("a",profile,"b","Copied profile");
  assert.deepEqual(errors,[]);
  assert.equal(saved.gameId,"b");
  assert.equal(saved.copy.name,"Copied profile");
  assert.equal(saved.copy.states[0].id,"state");
  assert.equal(saved.copy.hotkeys[0].state_id,"state");
  assert.equal(saved.variables[0].name,"Cast (2)");
  const steps=JSON.parse(expandBehavior(saved.copy.hotkeys[0].behavior,[...db.scopes[1].variables,...saved.variables]))[0].steps;
  assert.equal(steps[0].stateId,"state");
  assert.equal(steps[1].scriptId,saved.copy.scripts[0].id);
  assert.notEqual(steps[1].scriptId,"script");
  assert.equal(steps[2].itemIds[0],saved.copy.overlay_groups[0].id);
  assert.notEqual(steps[2].itemIds[0],"overlay");
  assert.deepEqual(db,before);
});
