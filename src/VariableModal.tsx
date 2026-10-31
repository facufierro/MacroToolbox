import { useState } from "react";
import { api } from "./api";
import { useErrorReporter } from "./AppConsole";
import { KeyInput } from "./KeyInput";
import { readVariable } from "./variables";
import { TriggerListInput } from "./TriggerListInput";
import type { Database, Variable, VariableType, ValueType } from "./types";

type VariableDraft = { type: "triggers"; value: string[] } | { type: ValueType; value: string };

export function VariableModal({ initial, variables, fixedType, lockType = false, onSaved, onClose }: {
  initial?: Variable;
  variables: Variable[];
  fixedType?: VariableType;
  lockType?: boolean;
  onSaved: (variable: Variable, db: Database) => void;
  onClose: () => void;
}) {
  const reportError = useErrorReporter();
  const [id] = useState(() => initial?.id ?? crypto.randomUUID());
  const [name, setName] = useState(initial?.name ?? "");
  const [draft, setDraft] = useState<VariableDraft>(() => {
    const type = fixedType ?? initial?.type ?? "number";
    return type === "triggers" ? { type, value: initial?.type === "triggers" ? [...initial.value] : [""] }
      : { type, value: initial ? String(initial.value) : type === "number" ? "0" : "" };
  });
  const { type, value } = draft;
  const [saving, setSaving] = useState(false);
  let variable: Variable | null = null;
  try {
    if (type === "number" && !value.trim()) throw new Error("Enter a number");
    variable = readVariable({ id, name, type, value: type === "number" ? Number(value) : value });
    if (variables.some(current => current.id !== id && current.name.trim().toLowerCase() === name.trim().toLowerCase())) variable = null;
  } catch { variable = null; }
  async function save() {
    const saved = variable;
    if (!saved) return;
    setSaving(true);
    try {
      const next = variables.some(current => current.id === id)
        ? variables.map(current => current.id === id ? saved : current) : [...variables, saved];
      onSaved(saved, await api.saveVariables(next));
    } catch (error) { reportError(error); }
    finally { setSaving(false); }
  }
  return <div className="modal-overlay">
    <form className="modal" onSubmit={event => { event.preventDefault(); void save(); }}>
      <h2>{initial ? "Edit variable" : "New variable"}</h2>
      <label>Name<input aria-label="Variable name" autoFocus value={name} disabled={saving} onChange={event => setName(event.target.value)} /></label>
      <label>Type<select aria-label="Variable type" value={type} disabled={saving || !!fixedType || lockType} onChange={event => {
        const next = event.target.value as VariableType;
        setDraft(next === "triggers" ? { type: next, value: [""] } : { type: next, value: next === "number" ? "0" : "" });
      }}><option value="number">Number</option><option value="text">Text</option><option value="keys">Keys</option><option value="triggers">Trigger list</option></select></label>
      <div className="form-field"><span>Value</span>
        {type === "triggers" ? <TriggerListInput value={value} disabled={saving} onChange={next => setDraft({ type: "triggers", value: next })} />
          : type === "keys" ? <KeyInput value={value} onChange={next => setDraft({ type: "keys", value: next })} allowChord />
          : type === "text" ? <textarea aria-label="Variable value" value={value} disabled={saving} rows={3} onChange={event => setDraft({ type: "text", value: event.target.value })} />
          : <input aria-label="Variable value" type="number" step="any" value={value} disabled={saving} onChange={event => setDraft({ type: "number", value: event.target.value })} />}
      </div>
      <div className="modal__actions">
        <button type="button" className="btn btn--secondary" disabled={saving} onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn--primary" disabled={saving || !variable}>{fixedType ? "Save and use" : "Save"}</button>
      </div>
    </form>
  </div>;
}
