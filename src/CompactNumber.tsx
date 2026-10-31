import { Icon, type IconName } from "./Icon";

export function CompactNumber({ label, value, onChange, prefix, unit, icon, min, max, step, disabled }: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  prefix?: string;
  unit?: string;
  icon?: IconName;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  return <label className="compact-number" title={label}>
    {icon && <Icon name={icon} />}{prefix && <span>{prefix}</span>}
    <input aria-label={label} title={label} type="number" value={value} min={min} max={max} step={step} disabled={disabled} onChange={event => onChange(event.target.value)} />
    {unit && <span>{unit}</span>}
  </label>;
}
