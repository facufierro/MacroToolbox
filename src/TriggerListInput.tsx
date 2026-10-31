import { IconButton } from "./Icon";
import { KeyInput } from "./KeyInput";
import { SortableList } from "./SortableList";
import { moveItem } from "./listOrder";

export function TriggerListInput({ value, onChange, disabled }: { value: string[]; onChange: (value: string[]) => void; disabled: boolean }) {
  return <fieldset className="trigger-list" disabled={disabled}>
    <SortableList items={value} itemKey={(_trigger, index) => String(index)} itemLabel={(_trigger, index) => `trigger ${index + 1}`}
      onReorder={(from, to, after) => onChange(moveItem(value, (_trigger, index) => String(index), from, to, after))}>
      {(trigger, index) => <div className="input-row">
        <KeyInput value={trigger} placeholder={`Trigger ${index + 1}`} allowChord onChange={next => onChange(value.map((current, position) => position === index ? next : current))} />
        <IconButton icon="trash-can" label="Delete trigger" className="icon-btn icon-btn--danger" onClick={() => onChange(value.filter((_current, position) => position !== index))} />
      </div>}
    </SortableList>
    <IconButton showLabel icon="plus" label="Add trigger" className="btn btn--ghost btn--sm" onClick={() => onChange([...value, ""])} />
  </fieldset>;
}
