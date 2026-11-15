import assert from "node:assert/strict";
import test from "node:test";
import { findUpdate, semverGt } from "../src/updates.ts";

test("update comparisons require a newer release and cannot reinstall the same version", () => {
  for (const [available,current,newer] of [["v6.9.0","6.8.0",true],["v6.10.0","6.9.0",true],
    ["v7.0.0","6.99.99",true],["v6.8.1","6.8.0",true],["v6.8.0","6.8.0",false],
    ["v6.7.0","6.8.0",false],["missing","6.8.0",false],["v6.9.0","invalid",false]]) {
    assert.equal(semverGt(available,current),newer,`${available} vs ${current}`);
  }
});

test("release checks prefer the setup installer and keep release notes available", async () => {
  let requested;
  const available = await findUpdate("6.8.0",async url => {
    requested = url;
    return Response.json({tag_name:"v6.9.0",html_url:"https://example.test/notes",assets:[
      {name:"MacroToolbox.exe",browser_download_url:"https://example.test/portable.exe"},
      {name:"MacroToolbox_x64-setup.exe",browser_download_url:"https://example.test/setup.exe"},
    ]});
  });
  assert.equal(requested,"https://api.github.com/repos/facufierro/MacroToolbox/releases/latest");
  assert.deepEqual(available,{version:"v6.9.0",downloadUrl:"https://example.test/setup.exe",notesUrl:"https://example.test/notes"});
});

test("missing releases, same-version releases, and releases without installers stay distinct", async () => {
  assert.equal(await findUpdate("6.8.0",async()=>new Response(null,{status:404})),null);
  assert.equal(await findUpdate("6.8.0",async()=>Response.json({tag_name:"v6.8.0"})),null);
  assert.equal(await findUpdate("6.8.0",async()=>Response.json({tag_name:"v6.9.0",assets:[]})).then(update=>update.downloadUrl),null);
});

test("HTTP, network, and malformed release failures are surfaced for retry", async () => {
  await assert.rejects(findUpdate("6.8.0",async()=>new Response(null,{status:403})),/HTTP 403/);
  await assert.rejects(findUpdate("6.8.0",async()=>{throw Error("offline");}),/offline/);
  await assert.rejects(findUpdate("6.8.0",async()=>new Response("invalid JSON")),SyntaxError);
});
