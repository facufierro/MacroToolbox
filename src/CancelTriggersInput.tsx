import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { TriggerListInput } from "./TriggerListInput";

export function CancelTriggersInput({ value, onChange, cancelOnOtherBehavior, onCancelOnOtherBehaviorChange, disabled }: {
  value: string[];
  onChange: (value: string[]) => void;
  cancelOnOtherBehavior: boolean;
  onCancelOnOtherBehaviorChange: (value: boolean) => void;
  disabled: boolean;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const conditions = [...(cancelOnOtherBehavior ? ["Another behavior"] : []), ...value.filter(key => key.trim())].join(", ");
  return <details ref={menu} open={open} className="overlay-targets cancel-triggers" onKeyDown={event => {
    if (event.key === "Escape" && open) {
      event.preventDefault(); event.stopPropagation();
      setOpen(false);
      menu.current?.querySelector("summary")?.focus();
    }
  }}>
    <summary aria-label="Cancel triggers" title={conditions ? `Cancel on: ${conditions}` : "Cancel triggers"}
      aria-disabled={disabled || undefined} onClick={event => { event.preventDefault(); if (!disabled) setOpen(!open); }}>
      <span className="cancel-triggers__label">Cancel on{conditions && ":"}</span>
      {conditions && <span className="cancel-triggers__keys">{conditions}</span>}<Icon name="chevron-down" />
    </summary>
    {open && <div className="overlay-targets__menu cancel-triggers__menu">
      <label className="checkbox-row" title="Cancel this running list when another behavior starts, including in other profiles.">
        <input type="checkbox" aria-label="Another behavior starts" checked={cancelOnOtherBehavior} disabled={disabled}
          onChange={event => onCancelOnOtherBehaviorChange(event.target.checked)} />
        <span>Another behavior starts</span>
      </label>
      <TriggerListInput value={value} onChange={onChange} disabled={disabled} label="Cancel trigger" compact />
    </div>}
  </details>;
}
