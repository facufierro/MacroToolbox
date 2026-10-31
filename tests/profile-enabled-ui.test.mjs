import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { root, browser, browserModules } from "./browserHarness.mjs";

async function scenario() {
  const results = [], wait = () => new Promise(resolve => setTimeout(resolve, 40));
  const check = (name, value) => { if (!value) throw Error(name); results.push(name); };
  const switches = () => [...document.querySelectorAll('input[aria-label="Profile enabled"]')];
  try {
    await wait();
    check('sidebar and editor show the enabled profile', switches().length === 2 && switches().every(input => input.checked));
    window.receiveDisabled(['profile']); await wait();
    check('shortcut disable updates both profile switches', switches().every(input => !input.checked));
    check('shortcut disable updates the sidebar status indicator', document.querySelector('.profile-row .status-dot--off') && !document.querySelector('.profile-row--armed'));
    check('runtime status does not rewrite the configured profile', window.snapshot.scopes[0].profiles[0].armed && !window.calls.length);
    document.querySelector('.profile-row input').click(); await wait();
    check('the sidebar switch resumes a shortcut-disabled profile', window.calls.length === 1 && window.calls[0].armed && switches().every(input => input.checked));
    window.receiveDisabled(['profile']); await wait();
    document.querySelector('.editor__header input').click(); await wait();
    check('the editor switch resumes the same profile', window.calls.length === 2 && window.calls[1].armed && switches().every(input => input.checked));
    window.configureArmed(false); window.receiveDisabled([]); await wait();
    check('an unarmed profile remains off after runtime status changes', switches().every(input => !input.checked));
    document.getElementById('results').textContent = JSON.stringify({ results });
  } catch (error) {
    document.getElementById('results').textContent = JSON.stringify({ results, error: error.message, stack: error.stack });
  }
}

test('profile switches display live shortcut status and can resume a paused profile', { skip: !browser && 'Chrome or Edge is required' }, async t => {
  const mocks = ['./api', './AppConsole', './App.css', './CloudSettings', '@tauri-apps/api/event', '@tauri-apps/plugin-dialog', '@tauri-apps/plugin-opener', '@tauri-apps/plugin-notification'];
  const bundle = browserModules(['App.tsx'], { mocks, expose: { [join(root, 'src/App.tsx')]: ['Library', 'ProfileEditor'] } });
  const profile = { id: 'profile', name: 'Main', kind: 'hotkeys', armed: true, parent_id: null, hotkeys: [], events: [], states: [], scripts: [], overlay_items: [], overlay_groups: [], overlay_triggers: [] };
  const initial = { version: 7, settings: {}, variables: [], scopes: [{ id: 'game', name: 'Game', exe: 'game.exe', states: [], profiles: [profile] }] };
  const harness = `const modules={${bundle.declarations}},cache={};window.calls=[];
function load(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;
if(id==='./api'){module.exports={api:{async setProfileArmed(id,armed){window.calls.push({id,armed});window.receiveDisabled([]);return {...window.snapshot,scopes:window.snapshot.scopes.map(scope=>({...scope,profiles:scope.profiles.map(profile=>profile.id===id?{...profile,armed}:profile)}))};}}};return module.exports;}
if(id==='./AppConsole'){module.exports={useErrorReporter:()=>error=>{throw error;}};return module.exports;}
if(${JSON.stringify(mocks)}.includes(id))return module.exports;
const [code,dependencies]=modules[id];code(module,module.exports,name=>load(dependencies[name]),{env:{NODE_ENV:'production'}});return module.exports;}
const React=load(${JSON.stringify(bundle.react)}),ReactDOM=load(${JSON.stringify(bundle.client)}),{Library,ProfileEditor}=load(${JSON.stringify(bundle.entry)}),{api}=load('./api');
function Fixture(){const [db,onDb]=React.useState(${JSON.stringify(initial)}),[disabled,setDisabled]=React.useState(new Set());window.snapshot=db;window.receiveDisabled=ids=>setDisabled(new Set(ids));window.configureArmed=armed=>onDb({...db,scopes:db.scopes.map(scope=>({...scope,profiles:scope.profiles.map(profile=>({...profile,armed}))}))});
const folder=db.scopes[0],profile=folder.profiles[0],onToggleArmed=async(id,armed)=>onDb(await api.setProfileArmed(id,armed)),noop=()=>{};
return React.createElement(React.Fragment,null,React.createElement(Library,{db,disabledProfiles:disabled,openExes:new Set(['game.exe']),selection:{kind:'profile',folderId:'game',profileId:'profile'},query:'',collapsed:new Set(),width:300,onToggleArmed,onDb,onQuery:noop,onToggleCollapse:noop,onSelect:noop,onProfileContext:noop,onFolderContext:noop,onModal:noop}),React.createElement(ProfileEditor,{folder,profile,enabled:profile.armed&&!disabled.has(profile.id),variables:[],showStates:false,onContext:noop,onDb,onModal:noop}));}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));(${scenario})();`;
  const logs = resolve(root, 'logs'); mkdirSync(logs, { recursive: true });
  const directory = mkdtempSync(join(logs, 'profile-enabled-ui-'));
  let result;
  try {
    const page = join(directory, 'status.html');
    writeFileSync(page, `<!doctype html><style>${readFileSync(join(root, 'src/App.css'), 'utf8')}</style><div id="root"></div><pre id="results"></pre><script>${harness.replace(/<\/script/gi, '<\\/script')}</script>`);
    const output = execFileSync(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(directory, 'profile')}`, '--virtual-time-budget=5000', '--dump-dom', pathToFileURL(page).href], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
    const match = output.match(/<pre id="results">([^<]+)<\/pre>/); assert.ok(match, 'browser did not complete profile status checks');
    result = JSON.parse(match[1].replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>'));
  } finally {
    assert.equal(dirname(directory), logs); rmSync(directory, { recursive: true, force: true });
  }
  for (const name of result.results) await t.test(name, () => {});
  assert.equal(result.error, undefined, result.stack ?? result.error);
});
