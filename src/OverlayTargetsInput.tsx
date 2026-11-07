import { useEffect, useRef } from "react";
import { Icon, IconButton } from "./Icon";
import type { OverlayTarget } from "./types";

export function OverlayTargetsInput({ overlays, value, onChange, onEdit }: {
  overlays: OverlayTarget[];
  value: string[];
  onChange: (ids: string[]) => void;
  onEdit?: (id: string) => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const label = (id: string) => {
    const overlay = overlays.find(overlay => overlay.id === id);
    return overlay ? overlay.name || (overlay.type === "group" ? "Overlay" : overlay.type) : "Missing overlay";
  };
  const ids = [...overlays.map(overlay => overlay.id), ...value.filter(id => !overlays.some(overlay => overlay.id === id))];
  return <details ref={menu} className="overlay-targets" onKeyDown={event => {
    if (event.key === "Escape" && menu.current?.open) {
      event.preventDefault(); event.stopPropagation();
      menu.current.open = false;
      menu.current.querySelector("summary")?.focus();
    }
  }}>
    <summary aria-label="Overlays"><span>{value.length ? value.map(label).join(", ") : "Select overlays"}</span><Icon name="chevron-down" /></summary>
    <div className="overlay-targets__menu">
      {ids.map(id => <div className="overlay-targets__option" key={id}>
        <label className="checkbox-row">
          <input type="checkbox" checked={value.includes(id)} onChange={event => onChange(event.target.checked ? [...value, id] : value.filter(selected => selected !== id))} />
          <span>{label(id)}</span>
        </label>
        {onEdit && overlays.some(overlay => overlay.id === id && overlay.type === "group") &&
          <IconButton icon="pen" label={`Edit ${label(id)}`} className="icon-btn" onClick={() => { if (menu.current) menu.current.open = false; onEdit(id); }} />}
      </div>)}
      {!ids.length && <div className="steps-empty">No overlays yet</div>}
    </div>
  </details>;
}
