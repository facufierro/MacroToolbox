import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { areStepsValid, describeBehavior, mapBehavior, parseSteps, stepsToString } from "../src/behaviors.ts";
import { isCredentialId, isPasswordValid } from "../src/behaviorValues.ts";
import { secureTextIds, usedSecureTexts } from "../src/secureText.ts";
import { exportVariables, importVariables } from "../src/variables.ts";

const id = "b8483943-e86c-41aa-a593-7388833369cd";
const other = "25e65241-265c-49bc-bd01-dbf2a6b147df";
const secret = "fixture only: +!^{Enter};ø🚀";
const steps = [{type:"sequence",steps:[{type:"press",key:"Tab"},{type:"securesend",credentialId:id}]}];

test("Secure send persists references and exposes no password in behavior summaries or portable profiles", () => {
  const source = stepsToString(steps);
  assert.deepEqual(parseSteps(source), steps);
  assert.equal(areStepsValid(steps), true);
  assert.equal(areStepsValid(steps, [], false), false);
  assert.deepEqual([...secureTextIds(steps)], [id]);
  assert.equal(describeBehavior(source, value=>value, value=>value), "sequence(press(Tab); Secure send)");
  const profile = {hotkeys:[{trigger:"f1",behavior:source}],events:[]};
  assert.deepEqual(exportVariables([profile], []), []);
  const imported = importVariables([profile], [], []);
  assert.equal(imported.profiles[0].hotkeys[0].behavior, source);
  assert.equal(mapBehavior(source, step=>step), source);
  assert.ok(!JSON.stringify(profile).includes(secret));
  assert.deepEqual(Object.keys(JSON.parse(source)[0].steps[1]), ["type","credentialId"]);
});

test("password drafts validate Windows storage boundaries without entering action trees", () => {
  assert.equal(isCredentialId(id), true);
  for (const value of ["", "../credential", "someone else's credential", id.toUpperCase(), id+"x"]) assert.equal(isCredentialId(value), false);
  for (const [password, valid] of [["",false],[secret,true],["x".repeat(1280),true],["x".repeat(1281),false],["🚀".repeat(640),true],["🚀".repeat(641),false],["nul\0byte",false]]) {
    assert.equal(isPasswordValid(password), valid);
    assert.equal(areStepsValid(steps, [], true, [{credentialId:id,password}]), valid);
  }
  assert.equal(areStepsValid([{type:"securesend",credentialId:""}]), false);
  assert.equal(areStepsValid([{type:"securesend",credentialId:other}], [], true, [{credentialId:id,password:""}]), true);
  const drafts = [{credentialId:id,password:secret},{credentialId:other,password:"removed draft"}];
  assert.deepEqual(usedSecureTexts(steps,drafts), [drafts[0]]);
  assert.deepEqual(usedSecureTexts([],drafts), []);
  assert.equal(steps[0].steps[1].password, undefined);
});

test("sensitive transport errors are replaced before the app console can receive request data", async () => {
  const require = createRequire(import.meta.url);
  const exports = {};
  const calls = [];
  const compiled = ts.transpileModule(readFileSync(new URL('../src/api.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  runInNewContext(compiled,{exports,require(name){
    if(name==='@tauri-apps/api/core')return {invoke(command,args){calls.push({command,args});return Promise.reject(new Error('transport accidentally echoed '+secret));}};
    return require(name);
  }});
  const profile = {hotkeys:[{trigger:'f1',behavior:stepsToString(steps)}],events:[]};
  await assert.rejects(exports.api.upsertProfile('game',profile,[],[{credentialId:id,password:secret}]), error=>{
    assert.equal(error.message,"Could not save the hotkey's password.");
    assert.ok(!String(error.stack).includes(secret));
    return true;
  });
  assert.equal(calls[0].args.secureTexts[0].password,secret);
  assert.ok(!JSON.stringify(calls[0].args.profile).includes(secret));
  await assert.rejects(exports.api.upsertProfile('game',profile), error=>error.message.includes('transport accidentally echoed'));
});
