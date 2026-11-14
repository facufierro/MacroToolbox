import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { root, browser, browserModules } from "./browserHarness.mjs";

async function scenario(empty) {
  const results = [], wait = () => new Promise(resolve => setTimeout(resolve, 40));
  const check = (name, condition) => { if (!condition) throw Error(name); results.push(name); };
  try {
    await wait();
    const toggle = document.querySelector('.app-console__toggle');
    check('startup information stays collapsed', toggle.getAttribute('aria-expanded') === 'false');
    toggle.click(); await wait();
    if (empty) {
      check('empty console has a compact placeholder', document.querySelector('.app-console__empty').textContent === 'No messages');
      check('empty log cannot be copied or cleared', [...document.querySelectorAll('.app-console__header button')].slice(1).every(button => button.disabled));
    } else {
      // The live entry arrived before the overlapping history response.
      check('startup history and live events are merged once', document.querySelectorAll('.app-console__entry').length === 2);
      window.emit('console-entry', {id:3,at:1700000000123,level:'warn',source:'Runtime',message:'run=12; Step node:17 goto; requested=760,420; actual=500,420; viewport=100,100,1280,720; cursor lock requested; physical mouse button=up'});
      window.emit('console-entry', {id:4,at:1700000000124,level:'error',source:'Save',message:'Profile save failed at store passwords; Windows Credential Manager CredWriteW failed (Windows error 1312).'});
      await wait();
      check('severity and millisecond timestamps are visible', document.querySelector('.app-console__entry--warn .app-console__level').textContent === 'WARN' && /\.123$/.test(document.querySelector('.app-console__entry--warn time').textContent));
      document.querySelector('[aria-label="Copy"]').click(); await wait();
      check('Copy includes startup, run context and Windows failure', window.copied.includes('INFO App: Session started') && window.copied.includes('requested=760,420') && window.copied.includes('Windows error 1312'));
    }
    check('console fits the window without horizontal overflow', document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.app-console__entry pre')].every(element => element.getBoundingClientRect().right <= innerWidth));
    document.getElementById('results').textContent = JSON.stringify({results});
  } catch (error) { document.getElementById('results').textContent = JSON.stringify({results,error:String(error),stack:error.stack}); }
}

test('console history, copying and compact layouts', {skip:!browser}, async t => {
  const bundle = browserModules(['AppConsole.tsx'], {mocks:['./console.css','@tauri-apps/api/core','@tauri-apps/api/event']});
  const logs = join(root,'logs'); mkdirSync(logs,{recursive:true});
  for (const empty of [true,false]) for (const width of [1000,600]) await t.test(`${empty?'empty':'configured'} at ${width}px`, async () => {
    const directory = mkdtempSync(join(logs,'console-ui-'));
    try {
      const page = join(directory,'console.html');
      const harness = `const modules={${bundle.declarations}},cache={};window.copied='';const callbacks=new Map();window.emit=(name,payload)=>callbacks.get(name)?.({payload});
const history=${empty?'[]':JSON.stringify([{id:1,at:1700000000000,level:'info',source:'App',message:'Session started; diagnostic file=logs/diagnostics.jsonl'},{id:2,at:1700000000001,level:'info',source:'Input',message:'Input host started'}])};
Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.copied=text}});
function load(id){if(cache[id])return cache[id].exports;const module=cache[id]={exports:{}};
if(id==='./console.css')return module.exports;
if(id==='@tauri-apps/api/core')return {invoke:async()=>{await new Promise(resolve=>setTimeout(resolve,10));return history}};
if(id==='@tauri-apps/api/event')return {listen:async(name,callback)=>{callbacks.set(name,callback);if(name==='console-entry'&&history.length)callback({payload:history[1]});return ()=>callbacks.delete(name)}};
const [code,dependencies]=modules[id];code(module,module.exports,name=>load(dependencies[name]),{env:{NODE_ENV:'production'}});return module.exports;}
const React=load(${JSON.stringify(bundle.react)}),ReactDOM=load(${JSON.stringify(bundle.client)}),{AppConsole}=load(${JSON.stringify(bundle.entry)});
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AppConsole,null,React.createElement('div',null,'MacroToolbox')));(${scenario})(${empty});`;
      writeFileSync(page,`<!doctype html><style>${readFileSync(join(root,'src/App.css'),'utf8')}${readFileSync(join(root,'src/console.css'),'utf8')}#results{position:absolute;left:-10000px}</style><div id="root"></div><pre id="results"></pre><script>${harness.replace(/<\/script/gi,'<\\/script')}</script>`);
      const output = execFileSync(browser,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${join(directory,'profile')}`,`--window-size=${width},700`,'--virtual-time-budget=5000',`--screenshot=${join(logs,`console-${empty?'empty':'configured'}-${width}.png`)}`,'--dump-dom',pathToFileURL(page).href],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
      const match = output.match(/<pre id="results">([^<]+)<\/pre>/);
      assert.ok(match,'browser did not complete console scenario');
      const result = JSON.parse(match[1].replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));
      assert.equal(result.error,undefined,result.stack??result.error);
    } finally {
      assert.equal(dirname(directory),logs); rmSync(directory,{recursive:true,force:true});
    }
  });
});
