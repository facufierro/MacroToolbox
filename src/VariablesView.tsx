import { useState } from "react";
import { api } from "./api";
import { useErrorReporter } from "./AppConsole";
import { IconButton } from "./Icon";
import { VariableModal } from "./VariableModal";
import { BehaviorStepsEditor } from "./BehaviorEditor";
import { availableOverlayTargets } from "./overlayItems";
import { SortableList } from "./SortableList";
import { moveItem } from "./listOrder";
import { usedVariableIds, variableValueText } from "./variables";
import type { Database, Variable } from "./types";

export function VariablesView({ db, onDb }: { db: Database; onDb: (db: Database) => void }) {
  const reportError = useErrorReporter();
  const [editing, setEditing] = useState<Variable | "new" | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const profiles = db.scopes.flatMap(scope => scope.profiles);
  const used = usedVariableIds(profiles, db.variables);
  const states = [...new Map(db.scopes.flatMap(scope => [...(scope.states ?? []), ...scope.profiles.flatMap(profile => profile.states ?? [])]).map(state => [state.id, state])).values()];
  const overlays = availableOverlayTargets(profiles.map(profile => ({ ...profile, overlay_items: profile.overlay_items ?? [] })), []);
  const scripts = profiles.flatMap(profile => profile.scripts ?? []);
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
        <span className="variable-row__type">{variable.type === "number" ? "Number" : variable.type === "keys" ? "Keys" : variable.type === "triggers" ? "Trigger list" : variable.type === "behavior" ? "Behavior" : "Text"}</span>
        <span className="variable-row__value">{variableValueText(variable, db.variables, id => states.find(state => state.id === id)?.name || "State", id => overlays.find(item => item.id === id)?.name || "Overlay")}</span>
        <IconButton icon="pen" label="Edit variable" className="icon-btn" onClick={() => setEditing(variable)} />
        <IconButton icon="trash-can" label="Delete variable" className="icon-btn icon-btn--danger" disabled={!!deleting || used.has(variable.id)} onClick={() => void remove(variable.id)} />
      </div>}
    </SortableList>
    <IconButton showLabel icon="plus" label="Add variable" className="btn btn--ghost" onClick={() => setEditing("new")} />
    {editing && <VariableModal initial={editing === "new" ? undefined : editing} variables={db.variables} lockType={editing !== "new" && used.has(editing.id)}
      renderBehavior={props => <BehaviorStepsEditor {...props} gameExe="*" states={states} overlays={overlays} scripts={scripts} variables={db.variables} onDb={onDb} />}
      onClose={() => setEditing(null)} onSaved={(_variable, next) => {
      onDb(next);
      setEditing(null);
    }} />}
  </div>;
}
