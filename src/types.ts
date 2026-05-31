export interface Hotkey {
  trigger: string;
  behavior: string;
}

export type OverlayItem =
  | { type: "timer"; id: string; x: number; y: number; duration_ms: number; label: string }
  | { type: "icon";  id: string; x: number; y: number; w: number; h: number; src: string | null }
  | { type: "bar";   id: string; x: number; y: number; w: number; h: number; color: string; max_value: number }
  | { type: "text";  id: string; x: number; y: number; font_size: number; color: string; content: string };

export interface Profile {
  id: string;
  name: string;
  parent_id: string | null;
  hotkeys: Hotkey[];
  overlay_items: OverlayItem[];
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
