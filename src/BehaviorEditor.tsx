import { IconButton, type IconName } from "./Icon";
import { useErrorReporter } from "./AppConsole";
import { useState } from "react";
import { api } from "./api";
import { KeyInput } from "./KeyInput";
import type { Step } from "./behaviors";
import type { OverlayTarget, ProfileState, Script } from "./types";

const ACTION_TYPES: Step["type"][] = ["borderless", "fit", "goto", "hold", "killprocess", "lock", "press", "mousepress", "repeat", "resolution", "restorecursor", "savecursor", "send", "sleep", "state", "startoverlay", "stretch", "waitfor", "sequence", "parallel", "stopoverlay", "bar", "script"];
const ACTION_ICONS: Record<Step["type"], IconName> = {
  borderless: "expand", fit: "compress", goto: "crosshairs", hold: "hand", killprocess: "stop", lock: "lock",
  press: "keyboard", mousepress: "computer-mouse", repeat: "repeat", resolution: "display", restorecursor: "rotate-left",
  savecursor: "floppy-disk", send: "font", sleep: "clock", state: "toggle-on", startoverlay: "layer-group",
  stretch: "arrows-up-down-left-right", waitfor: "hourglass-half", sequence: "list-ol", parallel: "code-fork",
  stopoverlay: "ban", bar: "gauge", script: "code", unknown: "ban",
};
const ACTION_LABELS: Record<Step["type"], string> = {
  borderless: "Borderless", fit: "Fit window", goto: "Move cursor", hold: "Hold keys", killprocess: "End process", lock: "Lock cursor",
  press: "Press keys", mousepress: "Mouse press", repeat: "Repeat keys", resolution: "Resolution", restorecursor: "Restore cursor",
  savecursor: "Save cursor", send: "Type text", sleep: "Delay", state: "State", startoverlay: "Start overlay",
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
    case "sleep": return { type, ms: "100" };
    case "goto": return { type, x: "", y: "" };
    case "resolution": return { type, width: "", height: "" };
    case "unknown": return { type, source: "" };
    default: return { type };
  }
}

export function GotoInput({ x, y, gameExe, onChange }: { x: string; y: string; gameExe: string; onChange: (x: string, y: string) => void }) {
  const reportError = useErrorReporter();
  const [picking, setPicking] = useState(false);

  async function pick() {
    setPicking(true);
    try {
      const [px, py] = await api.pickCoordinate(gameExe);
      onChange(String(px), String(py));
    } catch (e) {
      reportError(e);
    } finally {
      setPicking(false);
    }
  }

  return (
    <div className="goto-input">
      <label>X (%) <input type="number" min={0} max={100} step={0.1} value={x} onChange={e => onChange(e.target.value, y)} /></label>
      <label>Y (%) <input type="number" min={0} max={100} step={0.1} value={y} onChange={e => onChange(x, e.target.value)} /></label>
      <IconButton showLabel icon={picking ? "spinner" : "crosshairs"} label={picking ? "Click in app" : "Pick position"} spin={picking} className="btn btn--ghost btn--sm coordinate-picker" onClick={pick} disabled={picking} />
    </div>
  );
}

function StepRow({ step, index, total, gameExe, states, overlays, scripts, onChange, onDelete, onMove }: {
  step: Step;
  index: number;
  total: number;
  gameExe: string;
  states: ProfileState[];
  overlays: OverlayTarget[];
  scripts: Script[];
  onChange: (s: Step) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  return (
    <div className="step-row">
      <span className="step-row__type">{step.type}</span>
      <div className="step-row__params">
        {(step.type === "press" || step.type === "hold" || step.type === "waitfor") && (
          <KeyInput
            value={step.key}
            onChange={key => onChange({ ...step, key })}
            allowChord
          />
        )}
        {step.type === "mousepress" && (
          <KeyInput value={step.key} onChange={key => onChange({ ...step, key })} placeholder="Mouse button" />
        )}
        {(step.type === "sequence" || step.type === "parallel") && (
          <BehaviorStepsEditor steps={step.steps} gameExe={gameExe} states={states} overlays={overlays} scripts={scripts}
            onChange={steps => onChange({ ...step, steps })} />
        )}
        {step.type === "unknown" && <input value={step.source} readOnly aria-label="Unsupported action" />}
        {step.type === "repeat" && (
          <>
            <KeyInput value={step.key} onChange={key => onChange({ ...step, key })} allowChord />
            <input type="number" min={1} value={step.interval} placeholder="interval ms" title="Interval between presses (ms)"
              onChange={e => onChange({ ...step, interval: e.target.value })} style={{ width: 90 }} />
            <input type="number" min={0} value={step.hold} placeholder="hold ms" title="Key-down time per press (ms). Lower it if a game fires too fast; raise it if presses don't register."
              onChange={e => onChange({ ...step, hold: e.target.value })} style={{ width: 80 }} />
          </>
        )}
        {step.type === "goto" && (
          <GotoInput x={step.x} y={step.y} gameExe={gameExe} onChange={(x, y) => onChange({ ...step, x, y })} />
        )}
        {step.type === "resolution" && (
          <>
            <input type="number" min={1} step={1} value={step.width} placeholder="width" aria-label="Resolution width"
              onChange={e => onChange({ ...step, width: e.target.value })} style={{ width: 90 }} />
            <input type="number" min={1} step={1} value={step.height} placeholder="height" aria-label="Resolution height"
              onChange={e => onChange({ ...step, height: e.target.value })} style={{ width: 90 }} />
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
            {step.type === "bar" && <input type="number" value={step.value} onChange={e => onChange({ ...step, value: e.target.value })} aria-label="Bar value" />}
          </>
        )}
        {step.type === "script" && <select value={step.scriptId} onChange={e => onChange({ ...step, scriptId: e.target.value })} aria-label="Script">
          <option value="">Select script</option>
          {scripts.map(script => <option key={script.id} value={script.id}>{script.name || script.language}</option>)}
        </select>}
        {step.type === "sleep" && (
          <input type="number" value={step.ms} placeholder="ms"
            onChange={e => onChange({ ...step, ms: e.target.value })} style={{ width: 90 }} />
        )}
        {step.type === "send" && (
          <input value={step.text} placeholder="text"
            onChange={e => onChange({ ...step, text: e.target.value })} />
        )}
      </div>
      <div className="step-row__btns">
        <IconButton icon="arrow-up" label="Move up"  className="icon-btn" disabled={index === 0} onClick={() => onMove(-1)} />
        <IconButton icon="arrow-down" label="Move down"  className="icon-btn" disabled={index === total - 1} onClick={() => onMove(1)} />
        <IconButton icon="trash-can" label="Delete step" className="icon-btn icon-btn--danger" onClick={onDelete} />
      </div>
    </div>
  );
}

export function BehaviorStepsEditor({ steps, gameExe, states, overlays, scripts, onChange }: {
  steps: Step[];
  gameExe: string;
  states: ProfileState[];
  overlays: OverlayTarget[];
  scripts: Script[];
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
      <div className="steps-list">
        {steps.map((step, i) => (
          <StepRow key={i} step={step} index={i} total={steps.length} gameExe={gameExe} states={states} overlays={overlays} scripts={scripts}
            onChange={next => updateStep(i, next)}
            onDelete={() => removeStep(i)}
            onMove={direction => moveStep(i, direction)} />
        ))}
        {steps.length === 0 && <div className="steps-empty">No steps yet</div>}
      </div>
      <div className="step-add-btns">
        {ACTION_TYPES.map(type => (
          <IconButton showLabel icon={ACTION_ICONS[type]} label={ACTION_LABELS[type]} key={type} className="btn btn--ghost btn--sm" onClick={() => addStep(newStep(type, states, overlays, scripts))} />
        ))}
      </div>
    </div>
  );
}

