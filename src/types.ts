export interface Hotkey {
  trigger: string;
  behavior: string;
}

export interface Profile {
  id: string;
  name: string;
  hotkeys: Hotkey[];
}

export interface Game {
  id: string;
  name: string;
  exe: string;
  image: string | null;
  active_profile: string | null;
  profiles: Profile[];
}

export interface Settings {
  ahk_exe: string;
}

export interface Database {
  games: Game[];
  settings: Settings;
}
