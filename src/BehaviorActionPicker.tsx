import { useState } from "react";
import { IconButton, type IconName } from "./Icon";
import type { Step } from "./behaviors";

const GROUPS: { name: string; actions: [Step["type"], string, IconName][] }[] = [
  { name: "Input", actions: [["press", "Press keys", "keyboard"], ["hold", "Hold keys", "hand"], ["toggle", "Toggle keys", "toggle-on"], ["mousepress", "Mouse press", "computer-mouse"], ["repeat", "Repeat keys", "repeat"], ["send", "Type text", "font"], ["securesend", "Secure send", "lock"], ["waitfor", "Wait for", "hourglass-half"]] },
  { name: "Flow", actions: [["sleep", "Sleep", "clock"], ["sequence", "Sequence", "list-ol"], ["parallel", "Simultaneous", "code-fork"]] },
  { name: "Overlays", actions: [["startoverlay", "Start overlay", "layer-group"], ["stopoverlay", "Stop overlay", "ban"], ["bar", "Set bar", "gauge"], ["state", "State", "toggle-on"]] },
  { name: "Window", actions: [["borderless", "Borderless", "expand"], ["fit", "Fit window", "compress"], ["stretch", "Stretch window", "arrows-up-down-left-right"], ["resolution", "Resolution", "display"], ["goto", "Move cursor", "crosshairs"], ["lock", "Lock cursor", "lock"], ["savecursor", "Save cursor", "floppy-disk"], ["restorecursor", "Restore cursor", "rotate-left"], ["killprocess", "End process", "stop"]] },
  { name: "Reusable", actions: [["behavior", "Behavior variable", "layer-group"], ["script", "Run script", "code"]] },
];

export function BehaviorActionPicker({ hasTrigger, canSecureSend, onSelect, onClose }: {
  hasTrigger: boolean;
  canSecureSend: boolean;
  onSelect: (type: Step["type"]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const disabled = (type: Step["type"]) => (type === "toggle" && !hasTrigger) || (type === "securesend" && (!hasTrigger || !canSecureSend));
  const groups = GROUPS.map(group => ({ ...group, actions: group.actions.filter(([type, label]) => `${label} ${type}`.toLowerCase().includes(query.trim().toLowerCase())) })).filter(group => group.actions.length);
  return <div className="action-picker" aria-label="Actions" onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      const action = groups.flatMap(group => group.actions).find(([type]) => !disabled(type));
      if (action) onSelect(action[0]);
    }
  }}>
    <input autoFocus type="search" aria-label="Find action" placeholder="Find action" value={query} onChange={event => setQuery(event.target.value)} />
    <div className="action-picker__groups">
      {groups.map(group => <div className="action-picker__group" key={group.name}>
        <h4>{group.name}</h4>
        <div>{group.actions.map(([type, label, icon]) => <IconButton key={type} showLabel icon={icon} label={label} className="btn btn--ghost btn--sm"
          disabled={disabled(type)} onClick={() => onSelect(type)} />)}</div>
      </div>)}
      {!groups.length && <div className="steps-empty">No actions</div>}
    </div>
  </div>;
}
