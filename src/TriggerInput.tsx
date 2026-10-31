import { useState } from "react";
import { IconButton } from "./Icon";
import { useBindingRecorder } from "./KeyInput";
import { VariableModal } from "./VariableModal";
import { isReference } from "./behaviorValues";
import { variableValueText } from "./variables";
import type { Database, Hotkey, Variable } from "./types";

export function TriggerInput({ value, variables, onChange, onDb }: {
  value: Hotkey["trigger"]; variables: Variable[]; onChange: (value: Hotkey["trigger"]) => void; onDb: (db: Database) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [recording, setRecording] = useState(false);
  const reference = isReference(value);
  const choices = variables.filter(variable => variable.type === "triggers");
  const selected = reference ? choices.find(variable => variable.id === value.variable) : undefined;
  useBindingRecorder(recording, keys => { onChange(keys); setRecording(false); }, true);
  return <div className="trigger-input">
    <select aria-label="Trigger source" title="Trigger source" value={reference ? "variable" : "value"} onChange={event => {
      if (event.target.value === "variable") {
        if (choices.length) onChange({ variable: choices[0].id });
        else setCreating(true);
      } else onChange(selected?.type === "triggers" ? selected.value[0] : "");
    }}><option value="value">Value</option><option value="variable">Variable</option></select>
    {reference ? <>
      <select aria-label="Trigger variable" title="Trigger variable" value={value.variable} onChange={event => onChange({ variable: event.target.value })}>
        <option value="">Select variable</option>
        {!!value.variable && !selected && <option value={value.variable}>Missing or incompatible variable</option>}
        {choices.map(variable => <option key={variable.id} value={variable.id}>{variable.name}</option>)}
      </select>
      {selected && <output className="value-input__resolved" aria-label="Trigger list">{variableValueText(selected)}</output>}
      <IconButton icon="plus" label="New variable" className="btn btn--ghost btn--sm" onClick={() => setCreating(true)} />
    </> : <>
      {recording ? <div className="key-recording">Hold the key/button combination, then release…</div>
        : <input aria-label="Trigger" title="Trigger" value={value as string} placeholder="Trigger" onChange={event => onChange(event.target.value)} />}
      <IconButton showLabel={recording} icon={recording ? "arrow-left" : "keyboard"} label={recording ? "Cancel recording" : "Record hotkey"}
        className="btn btn--ghost btn--sm" onClick={() => setRecording(current => !current)} />
    </>}
    {creating && <VariableModal variables={variables} fixedType="triggers" onClose={() => setCreating(false)} onSaved={(variable, db) => {
      onDb(db); onChange({ variable: variable.id }); setCreating(false);
    }} />}
  </div>;
}
