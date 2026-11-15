import { useState } from "react";
import { api } from "./api";
import { useErrorReporter } from "./AppConsole";
import { IconButton } from "./Icon";
import { VariableModal } from "./VariableModal";
import { BehaviorStepsEditor } from "./BehaviorEditor";
import { availableOverlayTargets } from "./overlayItems";
import { SortableList } from "./SortableList";
import { moveItem } from "./listOrder";
import { duplicateVariable, usedVariableIds, variableValueText } from "./variables";
import type { Database, Scope, Variable } from "./types";

export function VariablesView({ folder, onDb }: { folder: Scope; onDb: (db: Database) => void }) {
  const reportError = useErrorReporter();
  const [editing, setEditing] = useState<Variable | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const profiles = folder.profiles;
  const used = usedVariableIds(profiles, folder.variables);
  const states = folder.states;
  const overlays = availableOverlayTargets(profiles.map(profile => ({ ...profile, overlay_items: profile.overlay_items ?? [] })), []);
  const scripts = profiles.flatMap(profile => profile.scripts ?? []);
  async function save(variables: Variable[]) {
    setSaving(true);
    try { onDb(await api.saveVariables(folder.id, variables)); }
    catch (error) { reportError(error); }
    finally { setSaving(false); }
  }
  return <div className="variables-view">
    <h2>{folder.name}: Variables</h2>
    <SortableList className="variables-list" items={folder.variables} itemKey={variable => variable.id} itemLabel={variable => variable.name}
      canMove={() => !saving} onReorder={(from, to, after) => save(moveItem(folder.variables, variable => variable.id, from, to, after))}>
      {variable => <div className="variable-row">
        <span className="variable-row__name">{variable.name}</span>
        <span className="variable-row__type">{variable.type === "number" ? "Number" : variable.type === "keys" ? "Keys" : variable.type === "triggers" ? "Trigger list" : variable.type === "behavior" ? "Behavior" : "Text"}</span>
        <span className="variable-row__value">{variableValueText(variable, folder.variables, id => states.find(state => state.id === id)?.name || "State", id => overlays.find(item => item.id === id)?.name || "Overlay")}</span>
        <IconButton icon="pen" label="Edit variable" className="icon-btn" disabled={saving} onClick={() => setEditing(variable)} />
        <IconButton icon="copy" label="Duplicate variable" className="icon-btn" disabled={saving} onClick={() => void save([...folder.variables, duplicateVariable(variable, folder.variables)])} />
        <IconButton icon="trash-can" label="Delete variable" className="icon-btn icon-btn--danger" disabled={saving || used.has(variable.id)} onClick={() => void save(folder.variables.filter(current => current.id !== variable.id))} />
      </div>}
    </SortableList>
    <IconButton showLabel icon="plus" label="Add variable" className="btn btn--ghost" disabled={saving} onClick={() => setEditing("new")} />
    {editing && <VariableModal folderId={folder.id} initial={editing === "new" ? undefined : editing} variables={folder.variables} lockType={editing !== "new" && used.has(editing.id)}
      renderBehavior={props => <BehaviorStepsEditor {...props} folderId={folder.id} gameExe={folder.exe} states={states} overlays={overlays} scripts={scripts} variables={folder.variables} onDb={onDb} />}
      onClose={() => setEditing(null)} onSaved={(_variable, next) => {
      onDb(next);
      setEditing(null);
    }} />}
  </div>;
}
