import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { root, browser, browserModules } from "./browserHarness.mjs";

const profile = (id, name, extra = {}) => ({ id, name, kind: "hotkeys", armed: false, parent_id: null,
  hotkeys: [], events: [], states: [], scripts: [], overlay_items: [], overlay_groups: [], overlay_triggers: [],
  toggle_hotkeys_key: null, toggle_overlay_key: null, ...extra });
const initial = { version: 7, settings: {}, variables: [
  { id: "a", name: "Buff timer", type: "number", value: 5000 },
  { id: "b", name: "Tick timer", type: "number", value: 200 },
  { id: "c", name: "Other timer", type: "number", value: 300 },
], scopes: [
  { id: "global", name: "Global", exe: "*", states: [], profiles: [] },
  { id: "game", name: "Zeta", exe: "game.exe", states: [{ id: "on", name: "On", duration_ms: null }, { id: "off", name: "Off", duration_ms: null }], profiles: [
    profile("p", "Visible Alpha", { parent_id: "parent",
      hotkeys: ["First", "Second", "Third"].map((name, index) => ({ name, trigger: String(index + 1), behavior: `press(${index + 1})`, state_id: null })),
      events: [{ event: "app_started", behavior: "press(a)" }, { event: "focus_gained", behavior: "press(b)" }],
      scripts: ["one", "two"].map(id => ({ id, name: `Script ${id}`, enabled: false, trigger: "launch", hotkey: "", language: "python", source: "code", code: id, path: "" })),
      overlay_groups: [{ id: "ga", name: "Alpha overlay", layout: "row" }, { id: "gb", name: "Beta overlay", layout: "row" }],
      overlay_items: ["x", "y", "z"].map((id, index) => ({ id, type: "text", group_id: index < 2 ? "ga" : "gb", name: "", x: 0, y: 0, state_id: null, content: id, font_size: 16, color: "#ffffff" })),
    }),
    profile("hidden", "Hidden"), profile("p3", "Visible Charlie"),
    profile("parent", "Parent", { hotkeys: [{ name: "Inherited", trigger: "i", behavior: "press(i)", state_id: null }] }),
  ] },
  { id: "alpha", name: "Alpha", exe: "other.exe", states: [], profiles: [] },
] };

async function scenario() {
  const results = [];
  const wait = () => new Promise(resolve => setTimeout(resolve, 30));
  const get = selector => { const element = document.querySelector(selector); if (!element) throw Error(`Missing ${selector}`); return element; };
  const handle = label => get(`.drag-handle[aria-label="Move ${label}"]`);
  const check = (name, condition) => { if (!condition) throw Error(name); results.push(name); };
  const ids = values => values.map(value => value.id).join(",");
  const current = () => window.snapshot.db.scopes.find(scope => scope.id === "game");
  const own = () => current().profiles.find(profile => profile.id === "p");
  const click = async selector => { get(selector).click(); await wait(); };
  async function drag(from, to, { after = false, drop = true } = {}) {
    const source = typeof from === "string" ? handle(from) : from;
    const destination = (typeof to === "string" ? handle(to) : to).closest(".sortable-item");
    const transfer = new DataTransfer();
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer })); await wait();
    window.lastDragTypes = [...transfer.types];
    const bounds = destination.getBoundingClientRect();
    const clientY = after ? bounds.bottom - 1 : bounds.top + 1;
    destination.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer, clientY })); await wait();
    const marker = destination.dataset.drop;
    if (drop) destination.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer, clientY }));
    source.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: transfer })); await wait();
    return marker;
  }
  try {
    await wait();
    check("folders use their saved order instead of forced alphabetical sorting", [...document.querySelectorAll('.folder-group__name')].map(node => node.textContent).join(",") === "Global,Zeta,Alpha");
    const marker = await drag("Alpha", "Global");
    check("dragging folders shows an insertion line and saves their order", marker === "before" && ids(window.snapshot.db.scopes) === "alpha,global,game");
    check("internal drags cannot insert item IDs as text into unrelated inputs", window.lastDragTypes.includes("application/x-macrotoolbox-sort") && !window.lastDragTypes.includes("text/plain"));
    await drag("Visible Charlie", "Visible Alpha");
    check("profiles reorder within their folder without changing selection or contents", ids(current().profiles) === "p3,p,hidden,parent" && own().hotkeys[0].behavior === "press(1)");
    const search = get('.library__search');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(search, "visible");
    search.dispatchEvent(new Event("input", { bubbles: true })); await wait();
    await drag("Visible Alpha", "Visible Charlie");
    check("filtered profile dragging preserves profiles hidden by search", ids(current().profiles) === "p,p3,hidden,parent");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(search, "");
    search.dispatchEvent(new Event("input", { bubbles: true })); await wait();
    check("inherited hotkeys have no drag handle in the consuming profile", !document.querySelector('.drag-handle[aria-label="Move Inherited"]'));
    await drag("Third", "First");
    check("hotkey dragging saves the new order with behaviors and triggers intact", own().hotkeys.map(hotkey => hotkey.trigger).join(",") === "3,1,2" && own().hotkeys[0].behavior === "press(3)");
    handle("Third").closest('.sortable-item').querySelector('button[aria-label="Edit"]').click(); await wait();
    check("editing a reordered hotkey targets its current saved index", window.modal.index === 0 && window.modal.hotkey.trigger === "3");
    await drag("Focus gained", "App started");
    check("events keep their behavior when reordered", own().events[0].event === "focus_gained" && own().events[0].behavior === "press(b)");
    await drag("Beta overlay", "Alpha overlay");
    check("overlay dragging preserves each overlay's membership", ids(own().overlay_groups) === "gb,ga" && own().overlay_items.find(item => item.id === "x").group_id === "ga");
    await drag("Alpha overlay Text 1", "Alpha overlay Text 0");
    check("dragging parts only reorders their own overlay and preserves identities", ids(own().overlay_items) === "y,x,z" && own().overlay_items[0].content === "y" && ids(own().overlay_groups) === "gb,ga");
    [...document.querySelectorAll('.section-toggle')].find(button => button.querySelector('h3')?.textContent === "Scripts").click(); await wait();
    await drag("Script two", "Script one");
    check("scripts reorder without changing code or enabled state", ids(own().scripts) === "two,one" && own().scripts[0].code === "two" && !own().scripts[0].enabled);
    await drag("Off", "On");
    check("shared states save their order on the folder", ids(current().states) === "off,on");
    const calls = window.saveCalls.length;
    await drag("First", "Second");
    check("dropping into the current position does not save or restart anything", window.saveCalls.length === calls);
    await drag("First", "Second", { after: true, drop: false });
    check("canceling a drag makes no persistence call or order change", window.saveCalls.length === calls && own().hotkeys.map(hotkey => hotkey.trigger).join(",") === "3,1,2" && !document.querySelector('[data-drop]'));
    await drag("First", "Off");
    check("cross-list drops are rejected without moving or copying data", window.saveCalls.length === calls && current().states.length === 2 && own().hotkeys.length === 3);
    const externalTarget = handle("First").closest('.sortable-item');
    externalTarget.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })); await wait();
    check("external text and file drops cannot reorder app lists", window.saveCalls.length === calls);
    await click('#reload');
    check("folder, profile, hotkey and overlay order survives a fresh render of persisted data", ids(window.snapshot.db.scopes) === "alpha,global,game" && ids(current().profiles) === "p,p3,hidden,parent" && own().hotkeys[0].trigger === "3" && ids(own().overlay_items) === "y,x,z");
    await click('#variables');
    await drag("Other timer", "Buff timer", { after: true });
    check("variables save a drop-after order without changing IDs or values", ids(window.snapshot.db.variables) === "a,c,b" && window.snapshot.db.variables[1].value === 300);
    window.failSave = true;
    await drag("Tick timer", "Buff timer");
    check("failed saves retain the original order and report the persistence error", ids(window.snapshot.db.variables) === "a,c,b" && window.errors.length === 1 && !get('.variables-list').hasAttribute('data-drop'));
    window.failSave = false;
    handle("Tick timer").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })); await wait();
    check("drag handles also support keyboard reordering after a failed save", ids(window.snapshot.db.variables) === "a,b,c");
    await click('#steps');
    await drag("send step 2", "sleep step 1");
    check("behavior steps drag into execution order while retaining literal values", window.snapshot.steps[0].type === "send" && window.snapshot.steps[0].text === "message" && window.snapshot.steps[1].ms === "100");
    const nested = get('.step-row--group .steps-section');
    const nestedHandles = nested.querySelectorAll('.drag-handle');
    const beforeNestedDrop = JSON.stringify(window.snapshot.steps);
    await drag(handle("sleep step 2"), nestedHandles[0]);
    check("drops across nested lists cannot reorder a parent sequence accidentally", JSON.stringify(window.snapshot.steps) === beforeNestedDrop);
    await drag(nestedHandles[1], nestedHandles[0]);
    check("nested behavior steps reorder within their own sequence", window.snapshot.steps[2].steps[0].ms === "300" && window.snapshot.steps[0].type === "send" && window.snapshot.steps.length === 3);
    const serialized = JSON.stringify(window.snapshot.steps);
    await click('#save-steps');
    check("saving and reopening behavior steps preserves the dragged order", JSON.stringify(window.snapshot.steps) === serialized);
    await click('#profile');
    check("saved row controls stay within the editor width", [...document.querySelectorAll('.editor .step-row,.editor .drag-handle')].filter(element => element.getClientRects().length).every(element => {
      const rect = element.getBoundingClientRect(), frame = get('.editor').getBoundingClientRect();
      return rect.left >= frame.left && rect.right <= frame.right;
    }));
    document.getElementById('results').textContent = JSON.stringify({ results });
  } catch (error) { document.getElementById('results').textContent = JSON.stringify({ results, error: error.message, stack: error.stack }); }
}

test("drag-and-drop list ordering works through real React controls and persistence boundaries", { skip: !browser && "Chrome or Edge is required" }, async t => {
  const mocks = ["./api", "./AppConsole", "./App.css", "./CloudSettings", "@tauri-apps/api/event", "@tauri-apps/plugin-dialog", "@tauri-apps/plugin-opener", "@tauri-apps/plugin-notification"];
  const bundle = browserModules(["App.tsx"], { mocks, expose: { [join(root, "src/App.tsx")]: ["Library", "ProfileEditor"] } });
  const harness = `const modules={${bundle.declarations}},cache={};window.saved=${JSON.stringify(initial)};window.errors=[];window.saveCalls=[];
async function save(db){if(window.failSave)throw Error('simulated persistence failure');window.saveCalls.push(structuredClone(db));window.saved=structuredClone(db);return structuredClone(db);}
function load(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;
if(id==='./api'){module.exports={api:{
upsertGame:scope=>save({...window.saved,scopes:window.saved.scopes.map(current=>current.id===scope.id?scope:current)}),
upsertProfile:(id,profile)=>save({...window.saved,scopes:window.saved.scopes.map(scope=>scope.id===id?{...scope,profiles:scope.profiles.map(current=>current.id===profile.id?profile:current)}:scope)}),
saveVariables:variables=>save({...window.saved,variables}),reorderFolders:ids=>save({...window.saved,scopes:ids.map(id=>window.saved.scopes.find(scope=>scope.id===id))})}};return module.exports;}
if(id==='./AppConsole'){module.exports={useErrorReporter:()=>error=>window.errors.push(String(error))};return module.exports;}
if(${JSON.stringify(mocks)}.includes(id))return module.exports;
const [code,dependencies]=modules[id];code(module,module.exports,name=>load(dependencies[name]),{env:{NODE_ENV:'production'}});return module.exports;}
const React=load(${JSON.stringify(bundle.react)}),ReactDOM=load(${JSON.stringify(bundle.client)}),{Library,ProfileEditor}=load(${JSON.stringify(bundle.entry)}),{VariablesView}=load(${JSON.stringify(join(root, "src/VariablesView.tsx"))}),{BehaviorStepsEditor}=load(${JSON.stringify(join(root, "src/BehaviorEditor.tsx"))});
function App(){const [db,onDb]=React.useState(window.saved),[query,onQuery]=React.useState(''),[view,setView]=React.useState('profile'),[revision,setRevision]=React.useState(0),[steps,onChange]=React.useState([{type:'sleep',ms:'100'},{type:'send',text:'message'},{type:'sequence',steps:[{type:'sleep',ms:'200'},{type:'sleep',ms:'300'}]}]);window.snapshot={db,steps};
const folder=db.scopes.find(scope=>scope.id==='game'),profile=folder.profiles.find(profile=>profile.id==='p');return React.createElement(React.Fragment,null,
React.createElement('nav',null,...['profile','variables','steps'].map(name=>React.createElement('button',{key:name,id:name,onClick:()=>setView(name)},name)),React.createElement('button',{id:'reload',onClick:()=>{onDb(structuredClone(window.saved));setRevision(revision+1);}},'Reload')),
React.createElement('div',{className:'layout__body',key:revision},React.createElement(Library,{db,query,onQuery,width:300,collapsed:new Set(),openExes:new Set(),selection:{kind:'profile',folderId:'game',profileId:'p'},onToggleCollapse(){},onSelect(){},onToggleArmed(){},onProfileContext(){},onFolderContext(){},onModal:modal=>window.modal=modal,onDb}),
view==='profile'?React.createElement(ProfileEditor,{folder,profile,variables:db.variables,showStates:true,onContext(){},onModal:modal=>window.modal=modal,onDb}):React.createElement('main',{className:'test-main'},view==='variables'?React.createElement(VariablesView,{db,onDb}):React.createElement('div',{className:'modal modal--wide'},React.createElement(BehaviorStepsEditor,{steps,onChange,onDb,variables:db.variables,gameExe:'',states:[],scripts:[],overlays:[]}),React.createElement('button',{id:'save-steps',onClick:()=>onChange(JSON.parse(JSON.stringify(steps)))},'Save steps')))));}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));(${scenario})();`;
  const logs = resolve(root, "logs"); mkdirSync(logs, { recursive: true });
  const directory = mkdtempSync(join(logs, "list-order-ui-"));
  let result;
  try {
    const page = join(directory, "lists.html");
    writeFileSync(page, `<!doctype html><style>${readFileSync(join(root, "src/App.css"), "utf8")}#root{display:flex;flex-direction:column}nav{display:flex;gap:8px;padding:8px}.test-main{flex:1;min-width:0;padding:20px;overflow:auto}#results{position:absolute;left:-10000px}</style><div id="root"></div><pre id="results"></pre><script>${harness.replace(/<\/script/gi, "<\\/script")}</script>`);
    const output = execFileSync(browser, ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${join(directory, "profile")}`,
      "--window-size=1200,1500", "--virtual-time-budget=15000", ...(process.env.LIST_ORDER_SCREENSHOT ? [`--screenshot=${resolve(logs, "list-order-preview.png")}`] : []), "--dump-dom", pathToFileURL(page).href], { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] });
    const match = output.match(/<pre id="results">([^<]+)<\/pre>/);
    assert.ok(match, "browser did not complete the drag-and-drop scenario");
    result = JSON.parse(match[1].replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">"));
  } finally {
    assert.equal(dirname(directory), logs);
    rmSync(directory, { recursive: true, force: true });
  }
  for (const name of result.results) await t.test(name, () => {});
  assert.equal(result.error, undefined, result.stack ?? result.error);
  assert.ok(result.results.length >= 20);
});
