import { Icon, IconButton } from "./Icon";
import { useEffect, useId, useRef, useState } from "react";
import { BehaviorActionPicker } from "./BehaviorActionPicker";
import { CoordinatePicker } from "./GotoInput";
import { ValueInput } from "./ValueInput";
import { VariableModal } from "./VariableModal";
import { SecureSendInput } from "./SecureSendInput";
import { OverlayTargetsInput } from "./OverlayTargetsInput";
import { BehaviorOverlayEditor, type OverlayEditingChange } from "./BehaviorOverlayEditor";
import { SortableList } from "./SortableList";
import { moveItem } from "./listOrder";
import { areStepsValid, parseSteps, stepsToString, type Step } from "./behaviors";
import { mapOverlayActions } from "./overlayItems";
import type { Database, Variable, OverlayTarget, ProfileState, Script, SecureTextDraft } from "./types";

function newStep(type: Step["type"], states: ProfileState[], overlays: OverlayTarget[], scripts: Script[]): Step {
  switch (type) {
    case "press": case "hold": case "toggle": return { type, key: "" };
    case "waitfor": return { type };
    case "mousepress": return { type, key: "LButton" };
    case "repeat": return { type, key: "", interval: "100", hold: "6" };
    case "sequence": case "parallel": return { type, steps: [{ type: "press", key: "" }] };
    case "state": return { type, stateId: states[0]?.id ?? "", action: "toggle" };
    case "startoverlay": return { type, itemIds: [], restart: true };
    case "stopoverlay": return { type, itemIds: [] };
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

function StepRow({ step, index, total, gameExe, states, overlays, scripts, variables, hasTrigger, secureTexts, editingVariableId, overlayProfileId, editingOverlay = false, onOverlayEditingChange, onOverlayRemoved, onSecureTextChange, onDb, onChange, onDelete, onMove }: {
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
  overlayProfileId?: string;
  editingOverlay?: boolean;
  onOverlayEditingChange?: OverlayEditingChange;
  onOverlayRemoved: (ids: string[]) => void;
  onSecureTextChange?: (credentialId: string, password: string) => void;
  onDb: (db: Database) => void;
  onChange: (s: Step) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [editingBehavior, setEditingBehavior] = useState<Variable | "new" | null>(null);
  const [overlayEditor, setOverlayEditor] = useState<string | null>(() =>
    (step.type === "startoverlay" || step.type === "stopoverlay") && !step.itemIds.length ? "" : null);
  const overlayEditorId = useId();
  useEffect(() => {
    if (overlayEditor === null) return;
    onOverlayEditingChange?.(overlayEditorId, true);
    return () => onOverlayEditingChange?.(overlayEditorId, false);
  }, [overlayEditor, overlayEditorId, onOverlayEditingChange]);
  const behaviorChoices = variables.filter(variable => variable.type === "behavior" && variable.id !== editingVariableId);
  return (
    <div className={`step-row${step.type === "startoverlay" || step.type === "stopoverlay" ? " step-row--overlay" : ""}${step.type === "sequence" || step.type === "parallel" ? " step-row--group" : ""}`}>
      <span className="step-row__type">{step.type === "startoverlay" || step.type === "stopoverlay" ? "overlay" : step.type}</span>
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
          <BehaviorStepsEditor steps={step.steps} gameExe={gameExe} states={states} overlays={overlays} scripts={scripts} variables={variables} hasTrigger={hasTrigger} secureTexts={secureTexts} editingVariableId={editingVariableId} overlayProfileId={overlayProfileId} editingOverlay={editingOverlay} onOverlayEditingChange={onOverlayEditingChange} onOverlayRemoved={onOverlayRemoved} onSecureTextChange={onSecureTextChange} onDb={onDb}
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
        {(step.type === "startoverlay" || step.type === "stopoverlay") && <>
          <select value={step.type === "stopoverlay" ? "stop" : step.restart ? "restart" : "start"} aria-label="Overlay action"
            title="Start keeps running timers; Restart resets them; Stop hides the selected overlays"
            onChange={event => onChange(event.target.value === "stop"
              ? { type: "stopoverlay", itemIds: step.itemIds }
              : { type: "startoverlay", itemIds: step.itemIds, restart: event.target.value === "restart" })}>
            <option value="start">Start</option>
            <option value="restart">Restart</option>
            <option value="stop">Stop</option>
          </select>
          {(overlays.length > 0 || step.itemIds.length > 0) && <OverlayTargetsInput overlays={overlays} value={step.itemIds} onChange={itemIds => {
            onChange({ ...step, itemIds });
            setOverlayEditor(itemIds.length ? null : "");
          }} onEdit={editingOverlay ? undefined : setOverlayEditor} />}
          {step.itemIds.length === 1 && overlays.some(overlay => overlay.id === step.itemIds[0] && overlay.type === "group") &&
            <IconButton icon="pen" label="Edit overlay" className="icon-btn" disabled={editingOverlay} onClick={() => setOverlayEditor(step.itemIds[0])} />}
        </>}
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
        <IconButton icon="arrow-up" label="Move up"  className="icon-btn" disabled={editingOverlay || index === 0} onClick={() => onMove(-1)} />
        <IconButton icon="arrow-down" label="Move down"  className="icon-btn" disabled={editingOverlay || index === total - 1} onClick={() => onMove(1)} />
        <IconButton icon="trash-can" label="Delete step" className="icon-btn icon-btn--danger" disabled={editingOverlay} onClick={onDelete} />
      </div>
      {overlayEditor !== null && (step.type === "startoverlay" || step.type === "stopoverlay") && <div className="step-row__overlay">
        <BehaviorOverlayEditor groupId={overlayEditor} defaultProfileId={overlayProfileId} onDb={onDb} onClose={() => {
          if (overlayEditor === "" && !step.itemIds.length) onDelete();
          else setOverlayEditor(null);
        }}
          onSaved={id => { if (overlayEditor !== id) onChange({ ...step, itemIds: [id] }); setOverlayEditor(null); }}
          onDeleted={ids => { onOverlayRemoved(ids); setOverlayEditor(null); }} />
      </div>}
      {editingBehavior && <VariableModal initial={editingBehavior === "new" ? undefined : editingBehavior} variables={variables} fixedType="behavior"
        renderBehavior={props => <BehaviorStepsEditor {...props} gameExe={gameExe} states={states} overlays={overlays} scripts={scripts} variables={variables} overlayProfileId={overlayProfileId} onDb={onDb} />}
        onClose={() => setEditingBehavior(null)} onSaved={(variable, db) => {
          onDb(db);
          if (step.type === "behavior") onChange({ ...step, variableId: variable.id });
          setEditingBehavior(null);
        }} />}
    </div>
  );
}

export function BehaviorStepsEditor({ steps, gameExe, states, overlays, scripts, variables = [], hasTrigger = true, secureTexts = [], editingVariableId, overlayProfileId, editingOverlay = false, onOverlayEditingChange, onOverlayRemoved, onSecureTextChange, onDb, onChange }: {
  steps: Step[];
  gameExe: string;
  states: ProfileState[];
  overlays: OverlayTarget[];
  scripts: Script[];
  variables?: Variable[];
  hasTrigger?: boolean;
  secureTexts?: SecureTextDraft[];
  editingVariableId?: string;
  overlayProfileId?: string;
  editingOverlay?: boolean;
  onOverlayEditingChange?: OverlayEditingChange;
  onOverlayRemoved?: (ids: string[]) => void;
  onSecureTextChange?: (credentialId: string, password: string) => void;
  onDb: (db: Database) => void;
  onChange: (steps: Step[]) => void;
}) {
  const [savingAsVariable, setSavingAsVariable] = useState(false);
  const [addingAction, setAddingAction] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const removeOverlayTargets = onOverlayRemoved ?? (ids => onChange(parseSteps(mapOverlayActions(stepsToString(steps), id => ids.includes(id) ? null : id))));
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
        canMove={() => !editingOverlay} onReorder={(from, to, after) => onChange(moveItem(steps, (_step, index) => String(index), from, to, after))}
        empty={<div className="steps-empty">No steps yet</div>}>
        {(step, i) => (
          <StepRow step={step} index={i} total={steps.length} gameExe={gameExe} states={states} overlays={overlays} scripts={scripts} variables={variables} hasTrigger={hasTrigger} secureTexts={secureTexts} editingVariableId={editingVariableId} overlayProfileId={overlayProfileId} editingOverlay={editingOverlay} onOverlayEditingChange={onOverlayEditingChange} onOverlayRemoved={removeOverlayTargets} onSecureTextChange={onSecureTextChange} onDb={onDb}
            onChange={next => updateStep(i, next)}
            onDelete={() => removeStep(i)}
            onMove={direction => moveStep(i, direction)} />
        )}
      </SortableList>
      <div className="step-add-btns">
        <button ref={addButton} type="button" className="btn btn--ghost btn--sm action-label-btn" aria-label="Add action" disabled={editingOverlay} aria-expanded={addingAction} onClick={() => setAddingAction(!addingAction)}><Icon name="plus" /><span>Add action</span></button>
        {!!steps.length && <IconButton icon="floppy-disk" label="Save as variable" className="btn btn--ghost btn--sm"
          disabled={editingOverlay || !areStepsValid(steps, variables, hasTrigger, secureTexts)} onClick={() => setSavingAsVariable(true)} />}
      </div>
      {addingAction && <BehaviorActionPicker hasTrigger={hasTrigger} canSecureSend={!!onSecureTextChange}
        onClose={closeActions} onSelect={type => { addStep(newStep(type, states, overlays, scripts)); closeActions(); }} />}
      {savingAsVariable && <VariableModal variables={variables} fixedType="behavior" initialBehavior={steps} initialSecureTexts={secureTexts}
        renderBehavior={props => <BehaviorStepsEditor {...props} gameExe={gameExe} states={states} overlays={overlays} scripts={scripts} variables={variables} overlayProfileId={overlayProfileId} onDb={onDb} />}
        onClose={() => setSavingAsVariable(false)} onSaved={(variable, db) => {
          onDb(db);
          onChange([{ type: "behavior", variableId: variable.id }]);
          setSavingAsVariable(false);
        }} />}
    </div>
  );
}

