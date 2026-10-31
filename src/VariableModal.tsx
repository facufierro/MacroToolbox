import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api } from "./api";
import { useErrorReporter } from "./AppConsole";
import { KeyInput } from "./KeyInput";
import { readVariable, validateVariableBehaviors } from "./variables";
import { areStepsValid, parseSteps, stepsToString, type Step } from "./behaviors";
import { usedSecureTexts } from "./secureText";
import { TriggerListInput } from "./TriggerListInput";
import type { Database, Variable, VariableType, ValueType, SecureTextDraft } from "./types";

type VariableDraft = { type: "triggers"; value: string[] } | { type: ValueType | "behavior"; value: string };

export interface VariableBehaviorEditorProps {
  steps: Step[];
  onChange: (steps: Step[]) => void;
  secureTexts: SecureTextDraft[];
  onSecureTextChange: (credentialId: string, password: string) => void;
  editingVariableId: string;
}

export function VariableModal({ initial, initialBehavior, initialSecureTexts = [], variables, fixedType, lockType = false, renderBehavior, onSaved, onClose }: {
  initial?: Variable;
  initialBehavior?: Step[];
  initialSecureTexts?: SecureTextDraft[];
  variables: Variable[];
  fixedType?: VariableType;
  lockType?: boolean;
  renderBehavior?: (props: VariableBehaviorEditorProps) => ReactNode;
  onSaved: (variable: Variable, db: Database) => void;
  onClose: () => void;
}) {
  const reportError = useErrorReporter();
  const [id] = useState(() => initial?.id ?? crypto.randomUUID());
  const [name, setName] = useState(initial?.name ?? "");
  const [draft, setDraft] = useState<VariableDraft>(() => {
    const type = fixedType ?? initial?.type ?? "number";
    return type === "triggers" ? { type, value: initial?.type === "triggers" ? [...initial.value] : [""] }
      : { type, value: initial ? String(initial.value) : type === "behavior" ? stepsToString(initialBehavior ?? []) : type === "number" ? "0" : "" };
  });
  const { type, value } = draft;
  const [saving, setSaving] = useState(false);
  const [secureTexts, setSecureTexts] = useState<SecureTextDraft[]>(initialSecureTexts);
  let variable: Variable | null = null;
  try {
    if (type === "number" && !value.trim()) throw new Error("Enter a number");
    variable = readVariable({ id, name, type, value: type === "number" ? Number(value) : value });
    if (variables.some(current => current.id !== id && current.name.trim().toLowerCase() === name.trim().toLowerCase())) variable = null;
    if (variable) {
      const edited = variable;
      const candidate = variables.some(current => current.id === id) ? variables.map(current => current.id === id ? edited : current) : [...variables, edited];
      if (!validateVariableBehaviors(candidate) || (type === "behavior" && !areStepsValid(parseSteps(value), candidate, true, secureTexts, [id]))) variable = null;
    }
  } catch { variable = null; }
  async function save() {
    const saved = variable;
    if (!saved) return;
    setSaving(true);
    try {
      const next = variables.some(current => current.id === id)
        ? variables.map(current => current.id === id ? saved : current) : [...variables, saved];
      onSaved(saved, await api.saveVariables(next, saved.type === "behavior" ? usedSecureTexts(parseSteps(saved.value), secureTexts) : []));
    } catch (error) { reportError(error); }
    finally { setSaving(false); }
  }
  return createPortal(<div className="modal-overlay">
    <form className={`modal${type === "behavior" ? " modal--wide" : ""}`} onSubmit={event => { event.preventDefault(); event.stopPropagation(); void save(); }}>
      <h2>{initial ? "Edit variable" : "New variable"}</h2>
      <label>Name<input aria-label="Variable name" autoFocus value={name} disabled={saving} onChange={event => setName(event.target.value)} /></label>
      <label>Type<select aria-label="Variable type" value={type} disabled={saving || !!fixedType || lockType} onChange={event => {
        const next = event.target.value as VariableType;
        setSecureTexts([]);
        setDraft(next === "triggers" ? { type: next, value: [""] } : { type: next, value: next === "number" ? "0" : "" });
      }}><option value="number">Number</option><option value="text">Text</option><option value="keys">Keys</option><option value="triggers">Trigger list</option>{renderBehavior && <option value="behavior">Behavior</option>}</select></label>
      <div className="form-field"><span>Value</span>
        {type === "behavior" ? <fieldset className="variable-behavior-editor" disabled={saving}>{renderBehavior?.({ steps: parseSteps(value), editingVariableId: id,
          onChange: steps => setDraft({ type: "behavior", value: stepsToString(steps) }), secureTexts,
          onSecureTextChange: (credentialId, password) => setSecureTexts(current => [...current.filter(draft => draft.credentialId !== credentialId), { credentialId, password }]),
        })}</fieldset> : type === "triggers" ? <TriggerListInput value={value} disabled={saving} onChange={next => setDraft({ type: "triggers", value: next })} />
          : type === "keys" ? <KeyInput value={value} onChange={next => setDraft({ type: "keys", value: next })} allowChord />
          : type === "text" ? <textarea aria-label="Variable value" value={value} disabled={saving} rows={3} onChange={event => setDraft({ type: "text", value: event.target.value })} />
          : <input aria-label="Variable value" type="number" step="any" value={value} disabled={saving} onChange={event => setDraft({ type: "number", value: event.target.value })} />}
      </div>
      <div className="modal__actions">
        <button type="button" className="btn btn--secondary" disabled={saving} onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn--primary" disabled={saving || !variable}>{fixedType ? "Save and use" : "Save"}</button>
      </div>
    </form>
  </div>, document.body);
}
