export function EnableSwitch({ enabled, size, label, onChange }: {
  enabled: boolean;
  size?: "lg";
  label: string;
  onChange: (enabled: boolean) => void;
}) {
  return <label className={`scope-toggle ${size === "lg" ? "" : "scope-toggle--sm"}`}
    title={enabled ? "Enabled" : "Disabled"} onClick={event => event.stopPropagation()}>
    <input type="checkbox" aria-label={label} checked={enabled} onChange={event => onChange(event.target.checked)} />
    <span className="scope-toggle__track" aria-hidden="true" />
  </label>;
}
