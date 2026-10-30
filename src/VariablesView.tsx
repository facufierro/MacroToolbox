import { useEffect, useState } from "react";
import { api } from "./api";
import { useErrorReporter } from "./AppConsole";
import { IconButton } from "./Icon";
import { profileVariableIds } from "./variables";
import type { Database } from "./types";

export function VariablesView({ db, onDb }: { db: Database; onDb: (db: Database) => void }) {
  const reportError = useErrorReporter();
  const draft = () => db.variables.map(variable => ({ ...variable, value: String(variable.value) }));
  const [variables, setVariables] = useState(draft);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setVariables(draft()); }, [db.variables]);
  const used = profileVariableIds(db.scopes.flatMap(scope => scope.profiles));
  const names = variables.map(variable => variable.name.trim().toLowerCase());
  const valid = new Set(names).size === names.length && variables.every(variable =>
    variable.name.trim() && variable.value.trim() && Number.isFinite(Number(variable.value)));
  async function save() {
    setSaving(true);
    try { onDb(await api.saveVariables(variables.map(variable => ({ ...variable, name: variable.name.trim(), value: Number(variable.value) })))); }
    catch (error) { reportError(error); }
    finally { setSaving(false); }
  }
  return <div className="settings-view">
    <h2>Variables</h2>
    <div className="steps-list">
      {variables.map((variable, index) => <div className="step-row" key={variable.id}>
        <input value={variable.name} aria-label="Variable name" placeholder="Name" disabled={saving}
          onChange={event => setVariables(variables.map((current, i) => i === index ? { ...current, name: event.target.value } : current))} />
        <input type="number" step="any" value={variable.value} aria-label="Variable value" placeholder="Value" disabled={saving}
          onChange={event => setVariables(variables.map((current, i) => i === index ? { ...current, value: event.target.value } : current))} />
        <IconButton icon="trash-can" label="Delete variable" className="icon-btn icon-btn--danger" disabled={saving || used.has(variable.id)}
          onClick={() => setVariables(variables.filter(current => current.id !== variable.id))} />
      </div>)}
    </div>
    <div className="input-row">
      <IconButton showLabel icon="plus" label="Add variable" className="btn btn--ghost" disabled={saving}
        onClick={() => setVariables([...variables, { id: crypto.randomUUID(), name: "", value: "0" }])} />
      <IconButton icon="check" label="Save" className="btn btn--primary" disabled={saving || !valid} onClick={save} />
    </div>
  </div>;
}
