import { useState } from "react";
import { api } from "./api";
import { useErrorReporter } from "./AppConsole";
import { IconButton } from "./Icon";
import { VariableModal } from "./VariableModal";
import { SortableList } from "./SortableList";
import { moveItem } from "./listOrder";
import { profileVariableIds, variableValueText } from "./variables";
import type { Database, Variable } from "./types";

export function VariablesView({ db, onDb }: { db: Database; onDb: (db: Database) => void }) {
  const reportError = useErrorReporter();
  const [editing, setEditing] = useState<Variable | "new" | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const used = profileVariableIds(db.scopes.flatMap(scope => scope.profiles));
  async function remove(id: string) {
    setDeleting(id);
    try { onDb(await api.saveVariables(db.variables.filter(variable => variable.id !== id))); }
    catch (error) { reportError(error); }
    finally { setDeleting(null); }
  }
  return <div className="variables-view">
    <h2>Variables</h2>
    <SortableList className="variables-list" items={db.variables} itemKey={variable => variable.id} itemLabel={variable => variable.name}
      onReorder={async (from, to, after) => { onDb(await api.saveVariables(moveItem(db.variables, variable => variable.id, from, to, after))); }}>
      {variable => <div className="variable-row">
        <span className="variable-row__name">{variable.name}</span>
        <span className="variable-row__type">{variable.type === "number" ? "Number" : variable.type === "keys" ? "Keys" : variable.type === "triggers" ? "Trigger list" : "Text"}</span>
        <span className="variable-row__value">{variableValueText(variable)}</span>
        <IconButton icon="pen" label="Edit variable" className="icon-btn" onClick={() => setEditing(variable)} />
        <IconButton icon="trash-can" label="Delete variable" className="icon-btn icon-btn--danger" disabled={!!deleting || used.has(variable.id)} onClick={() => void remove(variable.id)} />
      </div>}
    </SortableList>
    <IconButton showLabel icon="plus" label="Add variable" className="btn btn--ghost" onClick={() => setEditing("new")} />
    {editing && <VariableModal initial={editing === "new" ? undefined : editing} variables={db.variables} lockType={editing !== "new" && used.has(editing.id)} onClose={() => setEditing(null)} onSaved={(_variable, next) => {
      onDb(next);
      setEditing(null);
    }} />}
  </div>;
}
