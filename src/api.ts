import { invoke } from "@tauri-apps/api/core";
import type { Database, Scope, Profile, Settings } from "./types";

export const api = {
  getDatabase: () =>
    invoke<Database>("get_database"),

  readImageAsDataUrl: (path: string) =>
    invoke<string>("read_image_as_data_url", { path }),

  pickCoordinate: (exe: string) =>
    invoke<[number, number]>("pick_coordinate", { exe }),

  getOverlayItems: () =>
    invoke<import("./types").OverlayItem[]>("get_overlay_items"),

  toggleOverlay: () => {
    console.log("[overlay] toggleOverlay called");
    return invoke<void>("toggle_overlay");
  },

  killGame: (exe: string) =>
    invoke<void>("kill_game", { exe }),

  makeBorderlessFullscreen: (exe: string) =>
    invoke<boolean>("make_borderless_fullscreen", { exe }),

  upsertGame: (game: Scope) =>
    invoke<Database>("upsert_game", { game }),

  deleteGame: (id: string) =>
    invoke<Database>("delete_game", { id }),

  upsertProfile: (gameId: string, profile: Profile) =>
    invoke<Database>("upsert_profile", { gameId, profile }),

  deleteProfile: (gameId: string, profileId: string) =>
    invoke<Database>("delete_profile", { gameId, profileId }),

  activateProfile: (gameId: string, profileId: string) =>
    invoke<Database>("activate_profile", { gameId, profileId }),

  deactivateAhk: (gameId: string) =>
    invoke<Database>("deactivate_ahk", { gameId }),

  getAhkStatus: () =>
    invoke<boolean>("get_ahk_status"),

  saveSettings: (settings: Settings) =>
    invoke<Database>("save_settings", { settings }),
};
