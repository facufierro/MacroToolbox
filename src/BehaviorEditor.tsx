import { Icon, IconButton } from "./Icon";
import { useErrorReporter } from "./AppConsole";
import { useRef, useState } from "react";
import { BehaviorActionPicker } from "./BehaviorActionPicker";
import { CompactNumber } from "./CompactNumber";
import { api } from "./api";
import { ValueInput } from "./ValueInput";
import { VariableModal } from "./VariableModal";
import { SecureSendInput } from "./SecureSendInput";
import { OverlayTargetsInput } from "./OverlayTargetsInput";
import { SortableList } from "./SortableList";
import { moveItem } from "./listOrder";
import { areStepsValid, type Step } from "./behaviors";
import type { Database, Variable, OverlayTarget, ProfileState, Script, SecureTextDraft } from "./types";

function newStep(type: Step["type"], states: ProfileState[], overlays: OverlayTarget[], scripts: Script[]): Step {
  switch (type) {
    case "press": case "hold": case "toggle": return { type, key: "" };
    case "waitfor": return { type };
    case "mousepress": return { type, key: "LButton" };
    case "repeat": return { type, key: "", interval: "100", hold: "6" };
    case "sequence": case "parallel": return { type, steps: [{ type: "press", key: "" }] };
    case "state": return { type, stateId: states[0]?.id ?? "", action: "toggle" };
    case "startoverlay": return { type, itemIds: overlays.length ? [overlays[0].id] : [], restart: true };
    case "stopoverlay": return { type, itemIds: overlays.length ? [overlays[0].id] : [] };
    case "bar": return { type, itemId: overlays.find(item => item.type === "bar")?.id ?? "", value: "0" };
    case "script": return { type, scriptId: scripts[0]?.id ?? "" };
    case "send": return { type, text: "" };
    case "securesend": return { type, credentialId: "" };
    case "behavior": return { type, variableId: "" };
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
  return <IconButton showLabel={picking} icon={picking ? "spinner" : "crosshairs"} label={picking ? "Click in app" : "Pick position"}
    spin={picking} className="btn btn--ghost btn--sm coordinate-picker" onClick={pick} disabled={picking} />;
}

export function GotoInput({ x, y, gameExe, onChange }: { x: string; y: string; gameExe: string; onChange: (x: string, y: string) => void }) {
  return <div className="goto-input">
    <CompactNumber label="X (%)" prefix="X" unit="%" min={0} max={100} step={0.1} value={x} onChange={value => onChange(value, y)} />
    <CompactNumber label="Y (%)" prefix="Y" unit="%" min={0} max={100} step={0.1} value={y} onChange={value => onChange(x, value)} />
    <CoordinatePicker gameExe={gameExe} onPick={onChange} />
  </div>;
}

function StepRow({ step, index, total, gameExe, states, overlays, scripts, variables, hasTrigger, secureTexts, editingVariableId, onSecureTextChange, onDb, onChange, onDelete, onMove }: {
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
  editingVariableId?: string;
  onSecureTextChange?: (credentialId: string, password: string) => void;
  onDb: (db: Database) => void;
  onChange: (s: Step) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [editingBehavior, setEditingBehavior] = useState<Variable | "new" | null>(null);
  const behaviorChoices = variables.filter(variable => variable.type === "behavior" && variable.id !== editingVariableId);
  return (
    <div className={`step-row${step.type === "sequence" || step.type === "parallel" ? " step-row--group" : ""}`}>
      <span className="step-row__type">{step.type}</span>
      <div className="step-row__params">
        {step.type === "behavior" && <>
          <select aria-label="Behavior variable" value={step.variableId} onChange={event => onChange({ ...step, variableId: event.target.value })}>
            <option value="">Select variable</option>
            {step.variableId && !behaviorChoices.some(variable => variable.id === step.variableId) && <option value={step.variableId}>Missing or incompatible variable</option>}
            {behaviorChoices.map(variable => <option key={variable.id} value={variable.id}>{variable.name}</option>)}
          </select>
          {behaviorChoices.some(variable => variable.id === step.variableId) && <IconButton icon="pen" label="Edit variable" className="icon-btn" onClick={() => setEditingBehavior(behaviorChoices.find(variable => variable.id === step.variableId)!)} />}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditingBehavior("new")}>New variable</button>
        </>}
        {(step.type === "press" || step.type === "hold" || step.type === "toggle") && (
          <ValueInput type="keys" value={step.key} variables={variables} onDb={onDb} label="Keys" allowMatchedTrigger={step.type === "press" && hasTrigger}
            onChange={key => onChange({ ...step, key })} />
        )}
        {step.type === "mousepress" && (
          <>
            <ValueInput type="keys" value={step.key} variables={variables} onDb={onDb} label="Mouse button" allowChord={false}
              onChange={key => onChange({ ...step, key })} />
            <select value={step.doubleClick ? "double" : "single"} aria-label="Click type" title="Single or double mouse click"
              onChange={e => onChange({ ...step, doubleClick: e.target.value === "double" })}>
              <option value="single">Single click</option>
              <option value="double">Double click</option>
            </select>
          </>
        )}
        {(step.type === "press" || step.type === "mousepress") && (hasTrigger || step.onRelease) && (
          <select value={step.onRelease ? "release" : "press"} aria-label="Activation" title="Run when the hotkey is pressed or released"
            onChange={event => onChange({ ...step, onRelease: event.target.value === "release" })}>
            <option value="press">On press</option>
            <option value="release" disabled={!hasTrigger}>On release</option>
          </select>
        )}
        {(step.type === "sequence" || step.type === "parallel") && (
          <BehaviorStepsEditor steps={step.steps} gameExe={gameExe} states={states} overlays={overlays} scripts={scripts} variables={variables} hasTrigger={hasTrigger} secureTexts={secureTexts} editingVariableId={editingVariableId} onSecureTextChange={onSecureTextChange} onDb={onDb}
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
          </>
        )}
        {(step.type === "startoverlay" || step.type === "stopoverlay") && <OverlayTargetsInput overlays={overlays} value={step.itemIds}
          onChange={itemIds => onChange({ ...step, itemIds })} />}
        {step.type === "bar" && (
          <>
            <select value={step.itemId} onChange={e => onChange({ ...step, itemId: e.target.value })} aria-label="Overlay item">
              <option value="">Select overlay</option>
              {step.itemId && !overlays.some(item => item.id === step.itemId && item.type === "bar") && <option value={step.itemId}>Missing overlay</option>}
              {overlays.filter(item => item.type === "bar").map(item => <option key={item.id} value={item.id}>{item.name || item.type}</option>)}
            </select>
            <ValueInput value={step.value} variables={variables} onDb={onDb} onChange={value => onChange({ ...step, value })} label="Bar value" />
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
      {editingBehavior && <VariableModal initial={editingBehavior === "new" ? undefined : editingBehavior} variables={variables} fixedType="behavior"
        renderBehavior={props => <BehaviorStepsEditor {...props} gameExe={gameExe} states={states} overlays={overlays} scripts={scripts} variables={variables} onDb={onDb} />}
        onClose={() => setEditingBehavior(null)} onSaved={(variable, db) => {
          onDb(db);
          if (step.type === "behavior") onChange({ ...step, variableId: variable.id });
          setEditingBehavior(null);
        }} />}
    </div>
  );
}

export function BehaviorStepsEditor({ steps, gameExe, states, overlays, scripts, variables = [], hasTrigger = true, secureTexts = [], editingVariableId, onSecureTextChange, onDb, onChange }: {
  steps: Step[];
  gameExe: string;
  states: ProfileState[];
  overlays: OverlayTarget[];
  scripts: Script[];
  variables?: Variable[];
  hasTrigger?: boolean;
  secureTexts?: SecureTextDraft[];
  editingVariableId?: string;
  onSecureTextChange?: (credentialId: string, password: string) => void;
  onDb: (db: Database) => void;
  onChange: (steps: Step[]) => void;
}) {
  const [savingAsVariable, setSavingAsVariable] = useState(false);
  const [addingAction, setAddingAction] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  function closeActions() { setAddingAction(false); addButton.current?.focus(); }
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
          <StepRow step={step} index={i} total={steps.length} gameExe={gameExe} states={states} overlays={overlays} scripts={scripts} variables={variables} hasTrigger={hasTrigger} secureTexts={secureTexts} editingVariableId={editingVariableId} onSecureTextChange={onSecureTextChange} onDb={onDb}
            onChange={next => updateStep(i, next)}
            onDelete={() => removeStep(i)}
            onMove={direction => moveStep(i, direction)} />
        )}
      </SortableList>
      <div className="step-add-btns">
        <button ref={addButton} type="button" className="btn btn--ghost btn--sm action-label-btn" aria-label="Add action" aria-expanded={addingAction} onClick={() => setAddingAction(!addingAction)}><Icon name="plus" /><span>Add action</span></button>
        {!!steps.length && <IconButton icon="floppy-disk" label="Save as variable" className="btn btn--ghost btn--sm"
          disabled={!areStepsValid(steps, variables, hasTrigger, secureTexts)} onClick={() => setSavingAsVariable(true)} />}
      </div>
      {addingAction && <BehaviorActionPicker hasTrigger={hasTrigger} canSecureSend={!!onSecureTextChange}
        onClose={closeActions} onSelect={type => { addStep(newStep(type, states, overlays, scripts)); closeActions(); }} />}
      {savingAsVariable && <VariableModal variables={variables} fixedType="behavior" initialBehavior={steps} initialSecureTexts={secureTexts}
        renderBehavior={props => <BehaviorStepsEditor {...props} gameExe={gameExe} states={states} overlays={overlays} scripts={scripts} variables={variables} onDb={onDb} />}
        onClose={() => setSavingAsVariable(false)} onSaved={(variable, db) => {
          onDb(db);
          onChange([{ type: "behavior", variableId: variable.id }]);
          setSavingAsVariable(false);
        }} />}
    </div>
  );
}

