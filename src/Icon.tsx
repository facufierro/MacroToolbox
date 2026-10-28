import type { ButtonHTMLAttributes } from "react";
import { FA_ATTRIBUTION, FA_ICONS, type IconName } from "./fontAwesomeIcons";
export type { IconName } from "./fontAwesomeIcons";

export function Icon({ name, spin }: { name: IconName; spin?: boolean }) {
  const icon = FA_ICONS[name];
  return <svg className={`fa-icon${spin ? " fa-icon--spin" : ""}`} viewBox={icon.viewBox} fill="currentColor" aria-hidden="true" focusable="false">
    <desc>{FA_ATTRIBUTION}</desc>
    {icon.paths.map((path, index) => <path key={index} d={path} />)}
  </svg>;
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "title" | "aria-label"> & {
  icon: IconName;
  label: string;
  spin?: boolean;
  showLabel?: boolean;
};

export function IconButton({ icon, label, spin, showLabel = false, className = "icon-btn", type = "button", ...props }: IconButtonProps) {
  return <button {...props} type={type} className={`${className} ${showLabel ? "action-label-btn" : "action-icon-btn"}`} title={label} aria-label={label}>
    <Icon name={icon} spin={spin} />
    {showLabel && <span>{label}</span>}
  </button>;
}
