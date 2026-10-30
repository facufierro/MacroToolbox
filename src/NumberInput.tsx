import type { NumberVariable } from "./types";
import { resolveNumber } from "./behaviors";

export function NumberInput({ value, variables = [], onChange, label, min, max, step = "any", width = 90 }: {
  value: string;
  variables?: NumberVariable[];
  onChange: (value: string) => void;
  label: string;
  min?: number;
  max?: number;
  step?: number | "any";
  width?: number;
}) {
  const reference = value.startsWith("$");
  return <span className="number-input">
    {!reference && <input type="number" value={value} min={min} max={max} step={step} placeholder={label} aria-label={label}
      onChange={event => onChange(event.target.value)} style={{ width }} />}
    {(variables.length > 0 || reference) && <select value={reference ? value : ""} aria-label={`${label} source`}
      onChange={event => {
        if (event.target.value) onChange(event.target.value);
        else {
          try { onChange(resolveNumber(value, variables)); }
          catch { onChange(""); }
        }
      }}>
      <option value="">Number</option>
      {reference && !variables.some(variable => `$${variable.id}` === value) && <option value={value}>Missing variable</option>}
      {variables.map(variable => <option key={variable.id} value={`$${variable.id}`}>{variable.name}</option>)}
    </select>}
  </span>;
}
