import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { root, browser, browserModules } from "./browserHarness.mjs";

async function scenario() {
  const results = [];
  const wait = () => new Promise(resolve => setTimeout(resolve, 40));
  const check = (name, condition) => { if (!condition) throw Error(name); results.push(name); };
  const key = (type, value, code, modifiers = {}) => window.dispatchEvent(new KeyboardEvent(type, { key: value, code, bubbles: true, cancelable: true, ...modifiers }));
  const start = async () => { window.captures.length = 0; document.querySelector('#start').click(); await wait(); };
  const handoff = () => {
    key('keydown', 'Shift', 'ShiftLeft', { shiftKey: true });
    key('keydown', 'Unidentified', '', { shiftKey: true, keyCode: 232 });
    key('keyup', 'Unidentified', '', { shiftKey: true, keyCode: 232 });
    key('keyup', 'Shift', 'ShiftLeft');
    key('keydown', 'Control', 'ControlRight', { ctrlKey: true });
  };
  try {
    await wait();
    await start();
    key('keydown', 'Unidentified', '');
    key('keyup', 'Unidentified', '');
    await wait();
    check('unknown native events do not create a trigger or end recording', !window.captures.length && document.querySelector('#status').textContent === 'recording');
    handoff();
    check('Copilot prefix and menu-mask events do not finish recording', !window.captures.length);
    key('keyup', 'Control', 'ControlRight');
    await wait();
    check('Copilot alone records exactly Right Ctrl', window.captures.length === 1 && window.captures[0] === 'rctrl');

    await start();
    handoff();
    key('keydown', 'o', 'KeyO', { ctrlKey: true });
    key('keyup', 'o', 'KeyO', { ctrlKey: true });
    key('keyup', 'Control', 'ControlRight');
    await wait();
    check('Copilot combinations discard the chord prefix', window.captures.length === 1 && window.captures[0] === 'rctrl o');

    await start();
    handoff();
    key('keydown', 'Shift', 'ShiftLeft', { ctrlKey: true, shiftKey: true });
    key('keydown', 'O', 'KeyO', { ctrlKey: true, shiftKey: true });
    key('keyup', 'o', 'KeyO', { ctrlKey: true, shiftKey: true });
    key('keyup', 'Shift', 'ShiftLeft', { ctrlKey: true });
    key('keyup', 'Control', 'ControlRight');
    await wait();
    check('an independently held Shift remains in a Copilot shortcut', window.captures.length === 1 && window.captures[0] === 'rctrl lshift o');

    for (const [value, code, modifier] of [['Control', 'ControlRight', 'rctrl'], ['Shift', 'ShiftLeft', 'lshift'], ['Meta', 'MetaLeft', 'lwin']]) {
      await start();
      key('keydown', value, code);
      key('keyup', value, code);
      await wait();
      check(`ordinary ${modifier} still records alone`, window.captures.length === 1 && window.captures[0] === modifier);
    }

    await start();
    key('keydown', 'Control', 'ControlRight', { ctrlKey: true });
    key('keydown', 'Shift', 'ShiftLeft', { ctrlKey: true, shiftKey: true });
    key('keyup', 'Control', 'ControlRight', { shiftKey: true });
    key('keyup', 'Shift', 'ShiftLeft');
    await wait();
    check('modifier-only chords keep each independently held modifier', window.captures.length === 1 && window.captures[0] === 'rctrl lshift');

    await start();
    key('keydown', 'Control', 'ControlRight', { ctrlKey: true });
    window.dispatchEvent(new MouseEvent('mousedown', { button: 2, ctrlKey: true, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { button: 2, ctrlKey: true, bubbles: true }));
    key('keyup', 'Control', 'ControlRight');
    await wait();
    check('mouse shortcuts retain the sided modifier', window.captures.length === 1 && window.captures[0] === 'rctrl RButton');

    await start();
    key('keydown', 'Shift', 'ShiftLeft');
    key('keyup', 'Shift', 'ShiftLeft');
    document.querySelector('#stop').click();
    await wait();
    check('stopping recording cancels a pending modifier capture', !window.captures.length);

    document.querySelector('#mode').click();
    await start();
    handoff();
    check('behavior key recording also ignores the remap prefix', !window.captures.length);
    key('keydown', 'o', 'KeyO', { ctrlKey: true });
    key('keyup', 'o', 'KeyO', { ctrlKey: true });
    key('keyup', 'Control', 'ControlRight');
    await wait();
    check('behavior key recording retains Right Ctrl on its output chord', window.captures.length === 1 && window.captures[0] === 'rctrl o');

    await start();
    key('keydown', 'Control', 'ControlLeft', { ctrlKey: true });
    key('keydown', 'Alt', 'AltRight', { ctrlKey: true, altKey: true });
    key('keydown', '@', 'KeyQ', { ctrlKey: true, altKey: true });
    key('keyup', '@', 'KeyQ', { ctrlKey: true, altKey: true });
    key('keyup', 'Alt', 'AltRight', { ctrlKey: true });
    key('keyup', 'Control', 'ControlLeft');
    await wait();
    check('AltGr recording still excludes its synthesized Left Ctrl', window.captures.length === 1 && window.captures[0] === 'ralt q');
    document.querySelector('#results').textContent = JSON.stringify({ results });
  } catch (error) { document.querySelector('#results').textContent = JSON.stringify({ results, error: error.message, stack: error.stack }); }
}

test('the actual binding recorder handles the Copilot handoff without losing ordinary shortcuts', { skip: !browser && 'Chrome or Edge is required' }, async t => {
  const bundle = browserModules(['KeyInput.tsx']);
  const harness = `const modules={${bundle.declarations}},cache={};window.captures=[];
function load(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;const [code,dependencies]=modules[id];code(module,module.exports,name=>load(dependencies[name]),{env:{NODE_ENV:'production'}});return module.exports;}
const React=load(${JSON.stringify(bundle.react)}),ReactDOM=load(${JSON.stringify(bundle.client)}),{useBindingRecorder}=load(${JSON.stringify(bundle.entry)});
function App(){const [recording,setRecording]=React.useState(false),[allowChord,setAllowChord]=React.useState(true);useBindingRecorder(recording,value=>{window.captures.push(value);setRecording(false);},allowChord);return React.createElement(React.Fragment,null,React.createElement('button',{id:'start',onClick:()=>setRecording(true)},'Start'),React.createElement('button',{id:'stop',onClick:()=>setRecording(false)},'Stop'),React.createElement('button',{id:'mode',onClick:()=>setAllowChord(false)},'Behavior'),React.createElement('output',{id:'status'},recording?'recording':'idle'));}
ReactDOM.createRoot(document.querySelector('#root')).render(React.createElement(App));(${scenario})();`;
  const logs = resolve(root, 'logs');
  mkdirSync(logs, { recursive: true });
  const directory = mkdtempSync(join(logs, 'key-recorder-'));
  let result;
  try {
    const page = join(directory, 'recorder.html');
    writeFileSync(page, `<!doctype html><div id="root"></div><pre id="results"></pre><script>${harness.replace(/<\/script/gi, '<\\/script')}</script>`);
    const output = execFileSync(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(directory, 'profile')}`, '--virtual-time-budget=10000', '--dump-dom', pathToFileURL(page).href], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
    const match = output.match(/<pre id="results">([^<]+)<\/pre>/);
    assert.ok(match, 'browser did not finish the key recorder scenario');
    result = JSON.parse(match[1].replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>'));
  } finally { assert.equal(dirname(directory), logs); rmSync(directory, { recursive: true, force: true }); }
  for (const name of result.results) await t.test(name, () => {});
  assert.equal(result.error, undefined, result.stack ?? result.error);
});
