import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { root, browser, browserModules } from "./browserHarness.mjs";

async function scenario(mode) {
  const results = [];
  const wait = () => new Promise(resolve=>setTimeout(resolve,80));
  const check = (name,condition) => { if (!condition) throw Error(name); results.push(name); };
  const status = () => document.querySelector('[role="status"]')?.textContent ?? '';
  const retry = () => document.querySelector('[aria-label="Retry update"]');
  try {
    await wait(); await wait();
    if (mode === 'compatible') {
      check('compatible settings still open the normal app', !!document.querySelector('.library') && !document.querySelector('[role="status"]') && window.calls.includes('get_database'));
      check('compatible settings keep the normal manual update flow', window.installs.length === 0 && window.fetches === 1);
    } else if (mode === 'corrupt') {
      check('unrelated settings failures retain Retry and never trigger installation', !!document.querySelector('[aria-label="Retry"]') && window.installs.length === 0 && window.fetches === 0 && window.errors.length === 1);
    } else {
      check('newer settings open the recovery screen without loading or changing the database', document.querySelector('h2')?.textContent === 'Update required' && !window.calls.includes('get_database') && !window.calls.includes('set_library_width'));
      check('normal runtime polling and update prompts stay inactive during recovery', !window.calls.includes('list_open_executables') && !window.calls.includes('ask') && !window.calls.includes('notify'));
      if (mode === 'checking') {
        check('the initial check has a visible status', status() === 'Checking for an update...' && !retry() && window.installs.length === 0);
      } else if (mode === 'available') {
        check('a newer installer downloads and launches automatically', window.installs.length === 1 && window.installs[0] === 'https://example.test/setup.exe' && status() === 'Downloading and installing v6.9.0...');
      } else if (mode === 'same' || mode === 'no-release') {
        check('the latest installed version and unpublished releases do not cause reinstall loops', status() === 'No newer release is available yet.' && !!retry() && window.installs.length === 0);
      } else if (mode === 'no-installer') {
        check('a release without an installer leaves recovery available for retry', status().includes('no installer available') && !!retry() && window.installs.length === 0);
      } else {
        check('failed checks and downloads keep an actionable error screen', status().includes('Could not update') && !!retry() && window.errors.length === 1);
        window.networkFails = false; window.installFails = false;
        retry().click(); await wait(); await wait();
        check('Retry repeats the update and succeeds without reading the incompatible database', status().includes('Downloading and installing') && window.installs.length === (mode === 'download-failure' ? 2 : 1) && !window.calls.includes('get_database'));
      }
      const fetches = window.fetches, installs = window.installs.length;
      window.renderApp(); await wait();
      check('rerendering does not start another check or installer', window.fetches === fetches && window.installs.length === installs);
    }
    check('the recovery UI fits without horizontal scrolling', document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.empty-state h2,.empty-state p,.empty-state button')].every(node=>{const bounds=node.getBoundingClientRect();return bounds.left>=0 && bounds.right<=innerWidth;}));
    document.getElementById('results').textContent=JSON.stringify({results});
  } catch(error) { document.getElementById('results').textContent=JSON.stringify({results,error:error.message,stack:error.stack}); }
}

test('startup can update incompatible settings without opening the database or requiring a separate download', {skip:!browser && 'Chrome or Edge is required'},async t=>{
  const mocks=['./api','./AppConsole','./App.css','./CloudSettings','@tauri-apps/api/event','@tauri-apps/plugin-dialog','@tauri-apps/plugin-opener','@tauri-apps/plugin-notification'];
  const bundle=browserModules(['App.tsx'],{mocks});
  const logs=join(root,'logs');mkdirSync(logs,{recursive:true});
  for(const width of [1000,600]) for(const mode of ['compatible','corrupt','checking','available','same','no-release','no-installer','offline','download-failure']) await t.test(`${width}px ${mode}`,async t=>{
    const harness=`const modules={${bundle.declarations}},cache={};window.calls=[];window.installs=[];window.errors=[];window.fetches=0;window.reportError=error=>window.errors.push(String(error));
const mode=${JSON.stringify(mode)};window.networkFails=mode==='offline';window.installFails=mode==='download-failure';
window.fetch=async()=>{window.fetches++;if(mode==='checking')return new Promise(()=>{});if(window.networkFails)throw Error('offline');if(mode==='no-release')return new Response(null,{status:404});return Response.json({tag_name:mode==='same'||mode==='compatible'?'v6.8.0':'v6.9.0',html_url:'https://example.test/notes',assets:mode==='no-installer'?[]:[{name:'MacroToolbox_x64-setup.exe',browser_download_url:'https://example.test/setup.exe'}]});};
function load(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;
if(id==='./api'){module.exports={api:{async settingsRequireUpdate(){window.calls.push('settings_require_update');if(mode==='corrupt')throw Error('invalid settings JSON');return mode!=='compatible';},async getDatabase(){window.calls.push('get_database');if(mode!=='compatible')throw Error('incompatible settings must remain unopened');return {version:16,scopes:[{id:'global',name:'Global',exe:'*',variables:[],states:[],profiles:[]}],settings:{ahk_exe:'',python_exe:'',library_width:null,open_to_tray:false,close_to_tray:false,launch_on_startup:false}};},async getAppVersion(){return '6.8.0';},async downloadAndInstallUpdate(url){window.installs.push(url);if(window.installFails)throw Error('download failed');},async getDisabledProfiles(){return [];},async listOpenExecutables(){window.calls.push('list_open_executables');return [];},async setLibraryWidth(){window.calls.push('set_library_width');},async revealMainWindow(){window.calls.push('reveal');}}};return module.exports;}
if(id==='./AppConsole'){module.exports={useErrorReporter:()=>window.reportError};return module.exports;}
if(id==='@tauri-apps/api/event'){module.exports={listen:async()=>()=>{}};return module.exports;}
if(id==='@tauri-apps/plugin-dialog'){module.exports={ask:async()=>{window.calls.push('ask');return true;}};return module.exports;}
if(id==='@tauri-apps/plugin-notification'){module.exports={isPermissionGranted:async()=>true,sendNotification:()=>window.calls.push('notify')};return module.exports;}
if(${JSON.stringify(mocks)}.includes(id))return module.exports;
const [code,dependencies]=modules[id];code(module,module.exports,name=>load(dependencies[name]),{env:{NODE_ENV:'production'}});return module.exports;}
const React=load(${JSON.stringify(bundle.react)}),ReactDOM=load(${JSON.stringify(bundle.client)}),App=load(${JSON.stringify(bundle.entry)}).default;
const root=ReactDOM.createRoot(document.getElementById('root'));window.renderApp=()=>root.render(React.createElement(React.StrictMode,null,React.createElement(App)));window.renderApp();(${scenario})(mode);`;
    const directory=mkdtempSync(join(logs,'settings-update-'));let result;
    try{
      const page=join(directory,'update.html');
      writeFileSync(page,`<!doctype html><meta charset="utf-8"><style>${readFileSync(join(root,'src/App.css'),'utf8')}#root{height:100vh}#results{position:absolute;left:-10000px}</style><div id="root"></div><pre id="results"></pre><script>${harness.replace(/<\/script/gi,'<\\/script')}</script>`);
      const output=execFileSync(browser,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${join(directory,'profile')}`,`--window-size=${width},700`,'--virtual-time-budget=5000',`--screenshot=${join(logs,`settings-update-${width}-${mode}.png`)}`,'--dump-dom',pathToFileURL(page).href],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
      const match=output.match(/<pre id="results">([^<]+)<\/pre>/);assert.ok(match,'browser did not finish the update scenario');
      result=JSON.parse(match[1].replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));
    } finally {assert.equal(dirname(directory),logs);rmSync(directory,{recursive:true,force:true});}
    for(const name of result.results)await t.test(name,()=>{});
    assert.equal(result.error,undefined,result.stack??result.error);
  });
});
