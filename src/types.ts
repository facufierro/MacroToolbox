export interface Hotkey {
  trigger: string;
  behavior: string;
}

export type OverlayTriggerEvent = "profile_activated" | "profile_deactivated" | "hotkey_triggered";

export type OverlayTriggerAction = "set_flag" | "clear_flag" | "toggle_flag" | "start_timer" | "stop_timer";

export interface OverlayTrigger {
  id: string;
  event: OverlayTriggerEvent;
  hotkey_trigger: string | null;
  action: OverlayTriggerAction;
  state_key: string;
  duration_ms: number | null;
}

export interface OverlayConfig {
  items: OverlayItem[];
  triggers: OverlayTrigger[];
}

interface OverlayItemBase {
  id: string;
  x: number;
  y: number;
  visible_when: string | null;
}

export type OverlayItem =
  | (OverlayItemBase & { type: "timer"; duration_ms: number; label: string; timer_key: string | null })
  | (OverlayItemBase & { type: "icon"; w: number; h: number; src: string | null })
  | (OverlayItemBase & { type: "bar"; w: number; h: number; color: string; max_value: number })
  | (OverlayItemBase & { type: "text"; font_size: number; color: string; content: string });

export interface Profile {
  id: string;
  name: string;
  parent_id: string | null;
  hotkeys: Hotkey[];
  overlay_items: OverlayItem[];
  overlay_triggers: OverlayTrigger[];
}

export interface Game {
  id: string;
  name: string;
  exe: string;
  image: string | null;
  active_profile: string | null;
  profiles: Profile[];
  toggle_hotkeys_key: string | null;
  toggle_overlay_key: string | null;
}

export interface Settings {
  ahk_exe: string;
}

export interface Database {
  games: Game[];
  settings: Settings;
}
