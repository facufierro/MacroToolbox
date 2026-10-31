import { IconButton, type IconName } from "./Icon";
import { useErrorReporter } from "./AppConsole";
import { useState } from "react";
import { api } from "./api";
import { ValueInput } from "./ValueInput";
import { SecureSendInput } from "./SecureSendInput";
import { SortableList } from "./SortableList";
import { moveItem } from "./listOrder";
import type { Step } from "./behaviors";
import type { Database, Variable, OverlayTarget, ProfileState, Script, SecureTextDraft } from "./types";

const ACTION_TYPES: Step["type"][] = ["borderless", "fit", "goto", "hold", "killprocess", "lock", "press", "mousepress", "repeat", "resolution", "restorecursor", "savecursor", "send", "securesend", "sleep", "state", "startoverlay", "stretch", "waitfor", "sequence", "parallel", "stopoverlay", "bar", "script"];
const ACTION_ICONS: Record<Step["type"], IconName> = {
  borderless: "expand", fit: "compress", goto: "crosshairs", hold: "hand", killprocess: "stop", lock: "lock",
  press: "keyboard", mousepress: "computer-mouse", repeat: "repeat", resolution: "display", restorecursor: "rotate-left",
  savecursor: "floppy-disk", send: "font", securesend: "lock", sleep: "clock", state: "toggle-on", startoverlay: "layer-group",
  stretch: "arrows-up-down-left-right", waitfor: "hourglass-half", sequence: "list-ol", parallel: "code-fork",
  stopoverlay: "ban", bar: "gauge", script: "code", unknown: "ban",
};
const ACTION_LABELS: Record<Step["type"], string> = {
  borderless: "Borderless", fit: "Fit window", goto: "Move cursor", hold: "Hold keys", killprocess: "End process", lock: "Lock cursor",
  press: "Press keys", mousepress: "Mouse press", repeat: "Repeat keys", resolution: "Resolution", restorecursor: "Restore cursor",
  savecursor: "Save cursor", send: "Type text", securesend: "Secure send", sleep: "Sleep", state: "State", startoverlay: "Start overlay",
  stretch: "Stretch window", waitfor: "Wait for input", sequence: "Sequence", parallel: "Simultaneous",
  stopoverlay: "Stop overlay", bar: "Set bar", script: "Run script", unknown: "Unsupported action",
};
function newStep(type: Step["type"], states: ProfileState[], overlays: OverlayTarget[], scripts: Script[]): Step {
  switch (type) {
    case "press": case "hold": case "waitfor": return { type, key: "" };
    case "mousepress": return { type, key: "LButton" };
    case "repeat": return { type, key: "", interval: "100", hold: "6" };
    case "sequence": case "parallel": return { type, steps: [{ type: "press", key: "" }] };
    case "state": return { type, stateId: states[0]?.id ?? "", action: "toggle" };
    case "startoverlay": return { type, itemId: overlays[0]?.id ?? "", restart: true };
    case "stopoverlay": return { type, itemId: overlays[0]?.id ?? "" };
    case "bar": return { type, itemId: overlays.find(item => item.type === "bar")?.id ?? "", value: "0" };
    case "script": return { type, scriptId: scripts[0]?.id ?? "" };
    case "send": return { type, text: "" };
    case "securesend": return { type, credentialId: "" };
    case "sleep": return { type, ms: "100" };
    case "goto": return { type, x: "", y: "" };
    case "resolution": return { type, width: "", height: "" };
    case "unknown": return { type, source: "" };
    default: return { type };
  }
}

function CoordinatePicker({ gameExe, onPick }: { gameExe: string; onPick: (x: string, y: string) => void }) {
  const reportError = useErrorReporter();
  const [picking, setPicking] = useState(false);
  async function pick() {
    setPicking(true);
    try {
      const [x, y] = await api.pickCoordinate(gameExe);
      onPick(String(x), String(y));
    } catch (error) { reportError(error); }
    finally { setPicking(false); }
  }
  return <IconButton showLabel icon={picking ? "spinner" : "crosshairs"} label={picking ? "Click in app" : "Pick position"}
    spin={picking} className="btn btn--ghost btn--sm coordinate-picker" onClick={pick} disabled={picking} />;
}

export function GotoInput({ x, y, gameExe, onChange }: { x: string; y: string; gameExe: string; onChange: (x: string, y: string) => void }) {
  return <div className="goto-input">
    <label>X (%) <input type="number" min={0} max={100} step={0.1} value={x} onChange={event => onChange(event.target.value, y)} /></label>
    <label>Y (%) <input type="number" min={0} max={100} step={0.1} value={y} onChange={event => onChange(x, event.target.value)} /></label>
    <CoordinatePicker gameExe={gameExe} onPick={onChange} />
  </div>;
}

function StepRow({ step, index, total, gameExe, states, overlays, scripts, variables, hasTrigger, secureTexts, onSecureTextChange, onDb, onChange, onDelete, onMove }: {
  step: Step;
  index: number;
  total: number;
  gameExe: string;
  states: ProfileState[];
  overlays: OverlayTarget[];
  scripts: Script[];
  variables: Variable[];
  hasTrigger: boolean;
  secureTexts: SecureTextDraft[];
  onSecureTextChange?: (credentialId: string, password: string) => void;
  onDb: (db: Database) => void;
  onChange: (s: Step) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  return (
    <div className={`step-row${step.type === "sequence" || step.type === "parallel" ? " step-row--group" : ""}`}>
      <span className="step-row__type">{step.type}</span>
      <div className="step-row__params">
        {(step.type === "press" || step.type === "hold" || step.type === "waitfor") && (
          <ValueInput type="keys" value={step.key} variables={variables} onDb={onDb} label="Keys" allowMatchedTrigger={step.type === "press" && hasTrigger}
            onChange={key => onChange({ ...step, key })} />
        )}
        {step.type === "mousepress" && (
          <>
            <ValueInput type="keys" value={step.key} variables={variables} onDb={onDb} label="Mouse button" allowChord={false}
              onChange={key => onChange({ ...step, key })} />
            <select value={step.doubleClick ? "double" : "single"} aria-label="Click type"
              onChange={e => onChange({ ...step, doubleClick: e.target.value === "double" })}>
              <option value="single">Single click</option>
              <option value="double">Double click</option>
            </select>
          </>
        )}
        {(step.type === "press" || step.type === "mousepress") && (hasTrigger || step.onRelease) && (
          <select value={step.onRelease ? "release" : "press"} aria-label="Activation"
            onChange={event => onChange({ ...step, onRelease: event.target.value === "release" })}>
            <option value="press">On press</option>
            <option value="release" disabled={!hasTrigger}>On release</option>
          </select>
        )}
        {(step.type === "sequence" || step.type === "parallel") && (
          <BehaviorStepsEditor steps={step.steps} gameExe={gameExe} states={states} overlays={overlays} scripts={scripts} variables={variables} hasTrigger={hasTrigger} secureTexts={secureTexts} onSecureTextChange={onSecureTextChange} onDb={onDb}
            onChange={steps => onChange({ ...step, steps })} />
        )}
        {step.type === "unknown" && <input value={step.source} readOnly aria-label="Unsupported action" />}
        {step.type === "repeat" && (
          <>
            <ValueInput type="keys" value={step.key} variables={variables} onDb={onDb} label="Keys"
              onChange={key => onChange({ ...step, key })} />
            <ValueInput min={1} step={1} value={step.interval} label="Interval (ms)" variables={variables} onDb={onDb}
              onChange={interval => onChange({ ...step, interval })} />
            <ValueInput min={0} step={1} value={step.hold} label="Hold (ms)" variables={variables} onDb={onDb}
              onChange={hold => onChange({ ...step, hold })} width={80} />
          </>
        )}
        {step.type === "goto" && (
          <div className="goto-input">
            <ValueInput value={step.x} variables={variables} onDb={onDb} label="X (%)" min={0} max={100} step={0.1} onChange={x => onChange({ ...step, x })} />
            <ValueInput value={step.y} variables={variables} onDb={onDb} label="Y (%)" min={0} max={100} step={0.1} onChange={y => onChange({ ...step, y })} />
            <CoordinatePicker gameExe={gameExe} onPick={(x, y) => onChange({ ...step, x, y })} />
          </div>
        )}
        {step.type === "resolution" && (
          <>
            <ValueInput min={1} step={1} value={step.width} label="Resolution width" variables={variables} onDb={onDb}
              onChange={width => onChange({ ...step, width })} />
            <ValueInput min={1} step={1} value={step.height} label="Resolution height" variables={variables} onDb={onDb}
              onChange={height => onChange({ ...step, height })} />
          </>
        )}
        {step.type === "state" && (
          <>
          <select value={step.action ?? "toggle"} aria-label="State action" onChange={e => onChange({ ...step, action: e.target.value as "toggle" | "set" | "clear" })}>
            <option value="toggle">Toggle</option><option value="set">Enter</option><option value="clear">Leave</option>
          </select>
          <select value={step.stateId} onChange={e => onChange({ ...step, stateId: e.target.value })}>
            <option value="">Select state</option>
            {states.map(state => (
              <option key={state.id} value={state.id}>{state.name}</option>
            ))}
          </select>
          </>
        )}
        {step.type === "startoverlay" && (
          <>
            <select value={step.restart ? "restart" : "start"} aria-label="Overlay action"
              onChange={e => onChange({ ...step, restart: e.target.value === "restart" })}>
              <option value="start">Start</option>
              <option value="restart">Restart</option>
            </select>
            <select value={step.itemId} onChange={e => onChange({ ...step, itemId: e.target.value })}>
              <option value="">Select overlay</option>
              {step.itemId && !overlays.some(item => item.id === step.itemId) && <option value={step.itemId}>Missing overlay</option>}
              {overlays.map(item => (
                <option key={item.id} value={item.id}>{item.name || (item.type === "group" ? "Overlay" : item.type)}</option>
              ))}
            </select>
          </>
        )}
        {(step.type === "stopoverlay" || step.type === "bar") && (
          <>
            <select value={step.itemId} onChange={e => onChange({ ...step, itemId: e.target.value })} aria-label="Overlay item">
              <option value="">Select overlay</option>
              {step.itemId && !overlays.some(item => item.id === step.itemId && (step.type !== "bar" || item.type === "bar")) && <option value={step.itemId}>Missing overlay</option>}
              {overlays.filter(item => step.type !== "bar" || item.type === "bar").map(item => <option key={item.id} value={item.id}>{item.name || (item.type === "group" ? "Overlay" : item.type)}</option>)}
            </select>
            {step.type === "bar" && <ValueInput value={step.value} variables={variables} onDb={onDb} onChange={value => onChange({ ...step, value })} label="Bar value" />}
          </>
        )}
        {step.type === "script" && <select value={step.scriptId} onChange={e => onChange({ ...step, scriptId: e.target.value })} aria-label="Script">
          <option value="">Select script</option>
          {scripts.map(script => <option key={script.id} value={script.id}>{script.name || script.language}</option>)}
        </select>}
        {step.type === "sleep" && (
          <ValueInput min={0} step={1} value={step.ms} variables={variables} onDb={onDb} label="Sleep (ms)"
            onChange={ms => onChange({ ...step, ms })} />
        )}
        {step.type === "send" && (
          <ValueInput type="text" value={step.text} variables={variables} onDb={onDb} label="Text"
            onChange={text => onChange({ ...step, text })} />
        )}
        {step.type === "securesend" && <SecureSendInput credentialId={step.credentialId} drafts={secureTexts}
          onChange={onSecureTextChange && ((credentialId, password) => { onSecureTextChange(credentialId, password); onChange({ ...step, credentialId }); })} />}
      </div>
      <div className="step-row__btns">
        <IconButton icon="arrow-up" label="Move up"  className="icon-btn" disabled={index === 0} onClick={() => onMove(-1)} />
        <IconButton icon="arrow-down" label="Move down"  className="icon-btn" disabled={index === total - 1} onClick={() => onMove(1)} />
        <IconButton icon="trash-can" label="Delete step" className="icon-btn icon-btn--danger" onClick={onDelete} />
      </div>
    </div>
  );
}

export function BehaviorStepsEditor({ steps, gameExe, states, overlays, scripts, variables = [], hasTrigger = true, secureTexts = [], onSecureTextChange, onDb, onChange }: {
  steps: Step[];
  gameExe: string;
  states: ProfileState[];
  overlays: OverlayTarget[];
  scripts: Script[];
  variables?: Variable[];
  hasTrigger?: boolean;
  secureTexts?: SecureTextDraft[];
  onSecureTextChange?: (credentialId: string, password: string) => void;
  onDb: (db: Database) => void;
  onChange: (steps: Step[]) => void;
}) {
  function addStep(step: Step) { onChange([...steps, step]); }
  function removeStep(i: number) { onChange(steps.filter((_, index) => index !== i)); }
  function updateStep(i: number, step: Step) { onChange(steps.map((current, index) => index === i ? step : current)); }
  function moveStep(i: number, direction: -1 | 1) {
    const next = [...steps];
    const target = i + direction;
    if (target < 0 || target >= next.length) return;
    [next[i], next[target]] = [next[target], next[i]];
    onChange(next);
  }

  return (
    <div className="steps-section">
      <SortableList items={steps} itemKey={(_step, index) => String(index)} itemLabel={(step, index) => `${step.type} step ${index + 1}`}
        onReorder={(from, to, after) => onChange(moveItem(steps, (_step, index) => String(index), from, to, after))}
        empty={<div className="steps-empty">No steps yet</div>}>
        {(step, i) => (
          <StepRow step={step} index={i} total={steps.length} gameExe={gameExe} states={states} overlays={overlays} scripts={scripts} variables={variables} hasTrigger={hasTrigger} secureTexts={secureTexts} onSecureTextChange={onSecureTextChange} onDb={onDb}
            onChange={next => updateStep(i, next)}
            onDelete={() => removeStep(i)}
            onMove={direction => moveStep(i, direction)} />
        )}
      </SortableList>
      <div className="step-add-btns">
        {ACTION_TYPES.map(type => (
          <IconButton showLabel icon={ACTION_ICONS[type]} label={ACTION_LABELS[type]} key={type} className="btn btn--ghost btn--sm" disabled={type === "securesend" && (!hasTrigger || !onSecureTextChange)} onClick={() => addStep(newStep(type, states, overlays, scripts))} />
        ))}
      </div>
    </div>
  );
}

