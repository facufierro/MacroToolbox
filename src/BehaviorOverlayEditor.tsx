import { useCallback, useEffect, useState } from "react";
import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { useErrorReporter } from "./AppConsole";
import { OverlayGroupPanel } from "./OverlayGroupPanel";
import { OverlayBarEditor } from "./OverlayBarEditor";
import { IconButton } from "./Icon";
import { assignOverlayBar, saveOverlayBar, updateOverlayBars } from "./overlayBars";
import { OverlayItemEditor } from "./OverlayItemEditor";
import { OverlayItemRow } from "./OverlayItemRow";
import { SortableList } from "./SortableList";
import { moveItem } from "./listOrder";
import { availableOverlayItems, duplicateOverlayGroup, findOverlayOwner, removeOverlayGroup, resolveOverlayItems, newOverlayItem, updateBehaviorOverlay } from "./overlayItems";
import type { Database, OverlayBar, OverlayGroup, OverlayItem } from "./types";

export type OverlayEditingChange = (id: string, open: boolean) => void;

export function useOverlayEditors() {
  const [editors, setEditors] = useState<string[]>([]);
  const onOverlayEditingChange = useCallback<OverlayEditingChange>((id, open) => {
    setEditors(current => open ? [...current.filter(value => value !== id), id] : current.filter(value => value !== id));
  }, []);
  return { editingOverlay: editors.length > 0, onOverlayEditingChange };
}

export function BehaviorOverlayEditor({ folderId, groupId, defaultProfileId, onDb, onSaved, onDeleted, onClose }: {
  folderId: string;
  groupId: string;
  defaultProfileId?: string;
  onDb: (db: Database) => void;
  onSaved: (id: string) => void;
  onDeleted: (ids: string[]) => void;
  onClose: () => void;
}) {
  const reportError = useErrorReporter();
  const [db, setDb] = useState<Database | null>(null);
  const [profileId, setProfileId] = useState(defaultProfileId ?? "");
  const [group, setGroup] = useState<OverlayGroup>(() => ({ id: crypto.randomUUID(), name: "Overlay", x: 0, y: 0, layout: "row", gap: 8 }));
  const [items, setItems] = useState<OverlayItem[]>([]);
  const [editingPart, setEditingPart] = useState<OverlayItem | null>(null);
  const [bars, setBars] = useState<OverlayBar[]>([]);
  const [editingBar, setEditingBar] = useState<OverlayBar | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api.getDatabase().then(database => {
      if (cancelled) return;
      const profiles = database.scopes.filter(scope => scope.id === folderId).flatMap(scope => scope.profiles);
      const owner = groupId ? findOverlayOwner(profiles, groupId, defaultProfileId) : profiles.find(profile => profile.id === defaultProfileId);
      if (groupId && !owner) throw new Error("Overlay not found.");
      if (owner) {
        setProfileId(owner.id);
        setBars(database.scopes.find(scope => scope.profiles.some(profile => profile.id === owner.id))?.overlay_bars ?? []);
        if (groupId) {
          setGroup(owner.overlay_groups.find(group => group.id === groupId)!);
          setItems(owner.overlay_items.filter(item => item.group_id === groupId));
        }
      }
      setDb(database);
    }).catch(error => { if (!cancelled) { setFailed(true); reportError(error); } });
    return () => { cancelled = true; };
  }, [folderId, groupId, defaultProfileId, reportError]);
  const scope = db?.scopes.find(scope => scope.profiles.some(profile => profile.id === profileId));
  const profile = scope?.profiles.find(profile => profile.id === profileId);
  const bar = bars.find(bar => bar.group_ids.includes(group.id));
  const barGroups = [...new Map([...(scope?.profiles.flatMap(profile => profile.overlay_groups) ?? []), group].map(group => [group.id, group])).values()];
  const resolvedItems = profile && scope ? resolveOverlayItems(scope.profiles, { ...profile,
    overlay_groups: [...profile.overlay_groups.filter(current => current.id !== group.id), group],
    overlay_items: [...profile.overlay_items.filter(item => item.group_id !== group.id), ...items],
  }) : [];
  const resolved = resolvedItems.filter(({ item }) => item.group_id === group.id);
  const timers = scope ? availableOverlayItems(scope.profiles, resolvedItems.map(({ item }) => item), [group]).filter(item => item.type === "timer") : [];
  const deleteOverlay = async () => {
    if (!await confirmDialog(`Delete overlay "${group.name || "Overlay"}" and its parts?`)) return;
    setSaving(true);
    try {
      const latest = await api.getDatabase();
      const folder = latest.scopes.find(scope => scope.profiles.some(profile => profile.id === profileId));
      if (!folder) throw new Error("Profile not found.");
      const owner = folder.profiles.find(profile => profile.id === profileId)!;
      const ids = [group.id, ...owner.overlay_items.filter(item => item.group_id === group.id).map(item => item.id)];
      const next = removeOverlayGroup(folder, profileId, group.id);
      onDb(await api.upsertGame(next));
      onDeleted(ids.filter(id => !next.profiles.some(profile => profile.overlay_groups.some(group => group.id === id) || profile.overlay_items.some(item => item.id === id))));
    } finally { setSaving(false); }
  };
  async function save() {
    setSaving(true);
    try {
      const latest = await api.getDatabase();
      const owner = latest.scopes.find(scope => scope.profiles.some(profile => profile.id === profileId));
      if (!owner) throw new Error("Profile not found.");
      const next = updateBehaviorOverlay(owner, profileId, { ...group, name: group.name.trim() }, items);
      onDb(await api.upsertGame(updateOverlayBars(next, scope?.overlay_bars ?? [], bars)));
      onSaved(group.id);
    } catch (error) { reportError(error); }
    finally { setSaving(false); }
  }
  function renderPartEditor() {
    return editingPart && <OverlayItemEditor embedded key={editingPart.id} initial={editingPart} gameExe={scope?.exe ?? "*"} states={scope?.states ?? []}
      groups={[group]} timers={timers} saving={saving} onClose={() => setEditingPart(null)} onSave={async item => {
        setItems(current => current.some(part => part.id === item.id) ? current.map(part => part.id === item.id ? item : part) : [...current, item]);
        setEditingPart(null);
      }} />;
  }
  return <fieldset className="behavior-overlay-editor" aria-label="Edit overlay group" disabled={saving}>
    {!db ? <div className="steps-empty">{failed ? "Could not load overlay" : "Loading overlay…"}</div> : <>
      {!defaultProfileId && !groupId && <select aria-label="Overlay profile" value={profileId} onChange={event => {
        setProfileId(event.target.value);
        const destination = db.scopes.find(scope => scope.profiles.some(profile => profile.id === event.target.value));
        if (destination?.id !== scope?.id) setBars(destination?.overlay_bars ?? []);
        setEditingBar(null);
      }}>
        <option value="">Select profile</option>
        {db.scopes.filter(scope => scope.id === folderId).map(scope => <optgroup key={scope.id} label={scope.name}>{scope.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</optgroup>)}
      </select>}
      <OverlayGroupPanel group={group} timers={timers} gameExe={scope?.exe ?? "*"} partsEditable={!editingPart && !editingBar} positioned={!bar}
        barControls={<div className="overlay-bar-controls">
          <label>Bar <select aria-label="Overlay bar" title="Line up whole overlays in a shared bar" value={bar?.id ?? ""} disabled={!profile || !!editingBar || !!editingPart}
            onChange={event => setBars(assignOverlayBar(bars, group.id, event.target.value))}>
            <option value="">None</option>{bars.map(bar => <option key={bar.id} value={bar.id}>{bar.name}</option>)}
          </select></label>
          <IconButton icon="plus" label="New bar" className="icon-btn" disabled={!profile || !!editingBar || !!editingPart} onClick={() => setEditingBar({ id: crypto.randomUUID(), name: "Bar", x: group.x ?? 0, y: group.y ?? 0, direction: "right", gap: 8, group_ids: [group.id] })} />
          {bar && <IconButton icon="pen" label="Edit bar" className="icon-btn" disabled={!!editingBar || !!editingPart} onClick={() => setEditingBar(bar)} />}
        </div>}
        onChange={setGroup} onEnabledChange={async enabled => setGroup({ ...group, disabled: !enabled })}
        onDuplicate={profile ? async () => {
          const copy = duplicateOverlayGroup({ ...profile, overlay_groups: [], overlay_items: [] }, group, resolved.map(({ source }) => source), () => crypto.randomUUID());
          if (!scope?.profiles.some(profile => profile.overlay_groups.some(current => current.id === group.id))) {
            setBars(bars.map(bar => ({ ...bar, group_ids: bar.group_ids.map(id => id === group.id ? copy.overlay_groups[0].id : id) })));
          }
          setGroup(copy.overlay_groups[0]); setItems(copy.overlay_items);
        } : undefined}
        onDelete={group.id === groupId ? deleteOverlay : undefined}
        onAdd={type => setEditingPart(newOverlayItem(type, group.id))}>
        {editingBar && <OverlayBarEditor key={editingBar.id} initial={editingBar} groups={barGroups} bars={bars} gameExe={scope?.exe ?? "*"}
          onSave={bar => { setBars(saveOverlayBar(bars, bar)); setEditingBar(null); }} onClose={() => setEditingBar(null)}
          onDelete={bars.some(bar => bar.id === editingBar.id) ? () => { setBars(bars.filter(bar => bar.id !== editingBar.id)); setEditingBar(null); } : undefined} />}
        <SortableList items={resolved} itemKey={({ item }) => item.id} itemLabel={({ item }) => item.name} canMove={({ own }) => own && !editingPart && !editingBar}
          onReorder={(from, to, after) => setItems(moveItem(items, item => item.id, from, to, after))}
          empty={<div className="steps-empty">No parts yet</div>}>
          {({ item, source, own }) => <div className="overlay-item-row">
            <OverlayItemRow item={item} groupName={group.name || "Overlay"} states={scope?.states ?? []} inherited={!own}
              selected={editingPart?.id === item.id} editing={!!editingPart || !!editingBar} onEdit={own ? () => setEditingPart(source) : undefined}
              onOverride={() => { setItems(current => [...current, source]); setEditingPart(source); }}
              onDelete={() => setItems(items.filter(current => current.id !== item.id))} />
            {editingPart?.id === item.id && renderPartEditor()}
          </div>}
        </SortableList>
        {editingPart && !resolved.some(({ item }) => item.id === editingPart.id) && renderPartEditor()}
      </OverlayGroupPanel>
    </>}
    <div className="modal__actions">
      <button type="button" className="btn btn--secondary btn--sm" onClick={onClose}>Cancel overlay</button>
      <button type="button" className="btn btn--primary btn--sm" disabled={!db || !profileId || !!editingPart || !!editingBar || !group.name.trim()
        || !Number.isFinite(group.x ?? 0) || !Number.isFinite(group.y ?? 0) || !Number.isInteger(group.gap ?? 8) || (group.gap ?? 8) < 0}
        onClick={() => void save()}>Save overlay</button>
    </div>
  </fieldset>;
}
