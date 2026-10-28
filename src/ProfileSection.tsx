import { useEffect, useState, type ReactNode } from "react";
import { EnableSwitch } from "./EnableSwitch";
import { Icon } from "./Icon";

export function ProfileSection({ title, enabled, onChange, actions, defaultExpanded = false, reveal, children }: {
  title: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  actions: ReactNode;
  defaultExpanded?: boolean;
  reveal?: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded || !!reveal);
  useEffect(() => { if (reveal) setExpanded(true); }, [reveal]);
  return <section className={`setup-section${enabled ? "" : " setup-section--disabled"}`}>
    <div className="section-head">
      <button type="button" className="section-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        <span><Icon name={expanded ? "chevron-down" : "chevron-right"} /></span><h3>{title}</h3>
      </button>
      <div className="section-head__actions">
        {actions}
        <EnableSwitch enabled={enabled} label={`${title} enabled`} onChange={onChange} />
      </div>
    </div>
    {expanded && <div className="setup-section__body">{children}</div>}
  </section>;
}
