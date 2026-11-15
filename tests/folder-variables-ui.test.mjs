import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { root, browser, browserModules } from "./browserHarness.mjs";

async function scenario(empty) {
  const results = [];
  const wait = () => new Promise(resolve => setTimeout(resolve, 40));
  const get = selector => { const node = document.querySelector(selector); if (!node) throw Error(`Missing ${selector}`); return node; };
  const check = (name, condition) => { if (!condition) throw Error(name); results.push(name); };
  const set = async (selector, value) => {
    const node = get(selector);
    Object.getOwnPropertyDescriptor(node.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(node, value);
    node.dispatchEvent(new Event(node.tagName === 'SELECT' ? 'change' : 'input', {bubbles:true})); await wait();
  };
  const select = async name => {
    const group = [...document.querySelectorAll('.folder-group')].find(group => group.querySelector('.folder-group__name').textContent === name);
    [...group.querySelectorAll('.profile-row')].find(row => row.querySelector('.profile-row__name').textContent === 'Variables').click(); await wait();
  };
  try {
    await wait();
    check('each folder has a visible Variables entry and the global footer entry is removed', document.querySelectorAll('.folder-group .profile-row').length === 2 && !get('.library__footer').textContent.includes('Variables'));
    await select('Game A');
    check('an empty folder opens its own variable library', get('.variables-view h2').textContent === 'Game A: Variables' && !document.querySelector('.variable-row'));
    if (!empty) {
      get('[aria-label="Add variable"]').click(); await wait();
      await set('[aria-label="Variable name"]','Delay'); await set('[aria-label="Variable value"]','100');
      get('button[type="submit"]').click(); await wait();
      check('creation persists only to the selected folder', window.snapshot.scopes[0].variables[0].value === 100 && window.snapshot.scopes[1].variables.length === 0 && window.saveCalls[0] === 'a');
      await select('Game B');
      check('switching folders shows its independent empty state', !document.querySelector('.variable-row') && get('.variables-view h2').textContent.includes('Game B'));
      get('[aria-label="Add variable"]').click(); await wait();
      await set('[aria-label="Variable name"]','Delay'); await set('[aria-label="Variable value"]','900');
      get('button[type="submit"]').click(); await wait();
      check('different folders can use the same variable name with different values', window.snapshot.scopes[0].variables[0].name === 'Delay' && window.snapshot.scopes[1].variables[0].name === 'Delay' && window.snapshot.scopes[1].variables[0].value === 900);
      get('[aria-label="Edit variable"]').click(); await wait();
      await set('[aria-label="Variable value"]','950'); get('button[type="submit"]').click(); await wait();
      check('editing another folder cannot change the original value', window.snapshot.scopes[0].variables[0].value === 100 && window.snapshot.scopes[1].variables[0].value === 950);
      await select('Game A');
      get('[aria-label="Duplicate variable"]').click(); await wait();
      check('duplication stays inside the selected folder', window.snapshot.scopes[0].variables.length === 2 && window.snapshot.scopes[1].variables.length === 1 && window.snapshot.scopes[0].variables[1].name === 'Delay (copy)');
      get('#reload').click(); await wait();
      check('folder-local values survive reopening', get('.variable-row__value').textContent === '100' && window.snapshot.scopes[1].variables[0].value === 950);
    }
    const bounds = get('.detail').getBoundingClientRect();
    check('the library and variable controls fit the window', bounds.right <= innerWidth && [...document.querySelectorAll('.variables-view button,.variable-row')].every(node => { const rect = node.getBoundingClientRect(); return rect.left >= bounds.left && rect.right <= bounds.right; }));
    check('no persistence errors occurred', window.errors.length === 0);
    document.getElementById('results').textContent = JSON.stringify({results});
  } catch(error) { document.getElementById('results').textContent = JSON.stringify({results,error:error.message,stack:error.stack}); }
}

test('folder variable navigation and persistence remain isolated at normal and narrow widths', {skip:!browser && 'Chrome or Edge is required'}, async t => {
  const mocks = ['./api','./AppConsole','./App.css','./CloudSettings','@tauri-apps/api/event','@tauri-apps/plugin-dialog','@tauri-apps/plugin-opener','@tauri-apps/plugin-notification'];
  const bundle = browserModules(['App.tsx'],{mocks,expose:{[join(root,'src/App.tsx')]:['Library']}});
  const logs = join(root,'logs'); mkdirSync(logs,{recursive:true});
  for (const width of [1100,800]) for (const empty of [true,false]) await t.test(`${width}px ${empty ? 'empty' : 'configured'}`,async t => {
    const harness = `const modules={${bundle.declarations}},cache={};window.errors=[];window.saveCalls=[];
function load(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;
if(id==='./api'){module.exports={api:{async saveVariables(gameId,variables){window.saveCalls.push(gameId);window.saved={...window.snapshot,scopes:window.snapshot.scopes.map(folder=>folder.id===gameId?{...folder,variables}:folder)};return structuredClone(window.saved);}}};return module.exports;}
if(id==='./AppConsole'){module.exports={useErrorReporter:()=>error=>window.errors.push(String(error))};return module.exports;}
if(${JSON.stringify(mocks)}.includes(id))return module.exports;
const [code,dependencies]=modules[id];code(module,module.exports,name=>load(dependencies[name]),{env:{NODE_ENV:'production'}});return module.exports;}
const React=load(${JSON.stringify(bundle.react)}),ReactDOM=load(${JSON.stringify(bundle.client)}),{Library}=load(${JSON.stringify(bundle.entry)}),{VariablesView}=load(${JSON.stringify(join(root,'src/VariablesView.tsx'))});
window.saved={version:16,settings:{},scopes:['a','b'].map(id=>({id,name:'Game '+id.toUpperCase(),exe:id+'.exe',variables:[],profiles:[],states:[]}))};
function Fixture(){const [db,onDb]=React.useState(window.saved),[selection,onSelect]=React.useState({kind:'variables',folderId:'a'}),[revision,setRevision]=React.useState(0);window.snapshot=db;const folder=db.scopes.find(folder=>folder.id===selection.folderId);
return React.createElement(React.Fragment,null,React.createElement('button',{id:'reload',onClick:()=>{onDb(structuredClone(window.saved));setRevision(revision+1);}},'Reopen'),React.createElement('div',{className:'layout__body'},React.createElement(Library,{db,selection,onSelect,disabledProfiles:new Set(),openExes:new Set(),collapsed:new Set(),query:'',width:260,onQuery(){},onToggleCollapse(){},onToggleArmed(){},onProfileContext(){},onFolderContext(){},onDb,onModal(){}}),React.createElement('div',{className:'detail'},React.createElement('div',{className:'detail__scroll'},React.createElement(VariablesView,{key:folder.id+revision,folder,onDb})))));}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));(${scenario})(${empty});`;
    const directory=mkdtempSync(join(logs,'folder-variables-')); let result;
    try {
      const page=join(directory,'variables.html');
      writeFileSync(page,`<!doctype html><meta charset="utf-8"><style>${readFileSync(join(root,'src/App.css'),'utf8')}#results{position:absolute;left:-10000px}#root{height:100vh;display:flex;flex-direction:column}</style><div id="root"></div><pre id="results"></pre><script>${harness.replace(/<\/script/gi,'<\\/script')}</script>`);
      const output=execFileSync(browser,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${join(directory,'profile')}`,`--window-size=${width},900`,'--virtual-time-budget=10000',`--screenshot=${join(logs,`folder-variables-${width}-${empty?'empty':'configured'}.png`)}`,'--dump-dom',pathToFileURL(page).href],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
      const match=output.match(/<pre id="results">([^<]+)<\/pre>/); assert.ok(match,'browser did not finish the folder scenario');
      result=JSON.parse(match[1].replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));
    } finally { assert.equal(dirname(directory),logs); rmSync(directory,{recursive:true,force:true}); }
    for(const name of result.results) await t.test(name,()=>{});
    assert.equal(result.error,undefined,result.stack??result.error);
  });
});
