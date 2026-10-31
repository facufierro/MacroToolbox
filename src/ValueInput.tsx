import { useState } from "react";
import { KeyInput } from "./KeyInput";
import { VariableModal } from "./VariableModal";
import { isReference, isMatchedTrigger, resolveValue } from "./behaviorValues";
import type { BehaviorValue, Database, Variable, ValueType } from "./types";

export function ValueInput({ value, type = "number", variables, onChange, onDb, label, min, max, step = "any", width = 90, allowChord = true, allowMatchedTrigger = false }: {
  value: BehaviorValue;
  type?: ValueType;
  variables: Variable[];
  onChange: (value: BehaviorValue) => void;
  onDb: (db: Database) => void;
  label: string;
  min?: number;
  max?: number;
  step?: number | "any";
  width?: number;
  allowChord?: boolean;
  allowMatchedTrigger?: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const reference = isReference(value);
  const matched = isMatchedTrigger(value);
  const choices = variables.filter(variable => variable.type === type);
  const selected = reference ? choices.find(variable => variable.id === value.variable) : undefined;
  return <div className={`value-input value-input--${type}${matched ? " value-input--matched" : ""}`}>
    <select value={matched ? "trigger" : reference ? "variable" : "value"} aria-label={`${label} source`} onChange={event => {
      if (event.target.value === "trigger") onChange({ source: "trigger" });
      else if (event.target.value === "variable") {
        if (choices.length) onChange({ variable: choices[0].id });
        else setCreating(true);
      }
      else {
        try { onChange(resolveValue(value, type, variables)); }
        catch { onChange(""); }
      }
    }}><option value="value">Value</option><option value="variable">Variable</option>
      {(allowMatchedTrigger || matched) && <option value="trigger" disabled={!allowMatchedTrigger}>Matched trigger</option>}
    </select>
    {matched ? null : reference ? <select value={value.variable} aria-label={`${label} variable`} onChange={event => onChange({ variable: event.target.value })}>
      <option value="">Select variable</option>
      {!!value.variable && !selected && <option value={value.variable}>Missing or incompatible variable</option>}
      {choices.map(variable => <option key={variable.id} value={variable.id}>{variable.name}</option>)}
    </select> : type === "keys" ? <KeyInput value={value as string} onChange={onChange} allowChord={allowChord} placeholder={label} />
      : type === "text" ? <textarea value={value as string} rows={2} aria-label={label} placeholder={label} onChange={event => onChange(event.target.value)} />
      : <input type="number" value={value as string} min={min} max={max} step={step}
        aria-label={label} placeholder={label} onChange={event => onChange(event.target.value)} style={{ width }} />}
    {selected && <output className="value-input__resolved" aria-label={`${label} value`}>{String(selected.value)}</output>}
    {reference && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setCreating(true)}>New variable</button>}
    {creating && <VariableModal variables={variables} fixedType={type} onClose={() => setCreating(false)} onSaved={(variable, db) => {
      onDb(db);
      onChange({ variable: variable.id });
      setCreating(false);
    }} />}
  </div>;
}
