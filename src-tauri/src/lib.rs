use std::{collections::HashMap, sync::{Mutex, OnceLock}};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, State};

mod ahk;
mod behavior;
mod runtime;
mod protocol;
mod config;
mod firebase;
mod scripts;

use config::{Database, Game, Profile, Script, Settings};

const OVERLAY_PORT: u16 = 17823;
const TRAY_SHOW_ID: &str = "tray_show";
const TRAY_HIDE_ID: &str = "tray_hide";
const TRAY_QUIT_ID: &str = "tray_quit";
const GLOBAL_GAME_EXE: &str = "*";

#[cfg(target_os = "windows")]
mod display_resolution;
#[cfg(target_os = "windows")]
mod window_transform;
#[cfg(target_os = "windows")]
use window_transform::{PhysicalCoordinates, WindowTransform, WindowTransformState};

#[cfg(target_os = "windows")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct WindowClientBounds {
    left: i32,
    top: i32,
    width: i32,
    height: i32,
}

#[cfg(target_os = "windows")]
impl WindowClientBounds {
    /// Physical pixels relative to the overlay client; the webview applies its own DPI scale.
    fn overlay_origin(self, position: tauri::PhysicalPosition<i32>, minimized: bool) -> Option<(i32, i32, i32, i32)> {
        // Minimized clients can retain their size while reporting an off-screen origin.
        if minimized || self.width <= 0 || self.height <= 0 { return None; }
        Some((self.left - position.x, self.top - position.y, self.width, self.height))
    }
}

#[cfg(all(test, target_os = "windows"))]
mod overlay_position_tests {
    use super::{fit_overlay_to_desktop, get_global_viewport, get_window_client_bounds, PhysicalCoordinates, WindowClientBounds};
    use tauri::PhysicalPosition;
    use winapi::shared::windef::HWND;
    use winapi::um::winuser::*;

    struct Canvas(HWND);

    impl Canvas {
        fn new() -> Self {
            let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
            let hwnd = unsafe {
                CreateWindowExW(
                    WS_EX_NOACTIVATE | WS_EX_TRANSPARENT, class.as_ptr(), std::ptr::null(),
                    WS_POPUP, 0, 0, 800, 600, std::ptr::null_mut(), std::ptr::null_mut(),
                    std::ptr::null_mut(), std::ptr::null_mut(),
                )
            };
            assert!(!hwnd.is_null(), "Failed to create overlay test canvas");
            Self(hwnd)
        }
    }

    impl Drop for Canvas {
        fn drop(&mut self) { unsafe { DestroyWindow(self.0); } }
    }

    #[test]
    fn native_canvas_covers_new_monitors_and_recovers_from_clipping_without_taking_focus() {
        let _dpi = PhysicalCoordinates::enter().unwrap();
        let window = Canvas::new();
        let original = get_global_viewport();
        let foreground = unsafe { GetForegroundWindow() };
        for desktop in [
            original,
            WindowClientBounds { width: original.width + 1920, ..original },
            WindowClientBounds { left: original.left - 2560, top: original.top - 1440,
                width: original.width + 2560, height: original.height + 1440 },
            original,
        ] {
            assert_eq!(fit_overlay_to_desktop(window.0, desktop).unwrap(), desktop);
            assert_eq!(get_window_client_bounds(window.0).unwrap(), desktop);
            assert_eq!(fit_overlay_to_desktop(window.0, desktop).unwrap(), desktop);
            assert_eq!(unsafe { GetForegroundWindow() }, foreground);
        }
    }

    #[test]
    fn invalid_canvas_cannot_report_valid_overlay_bounds() {
        let _dpi = PhysicalCoordinates::enter().unwrap();
        assert!(fit_overlay_to_desktop(std::ptr::null_mut(), get_global_viewport()).is_err());
    }

    #[test]
    fn global_origin_is_local_to_the_overlay_on_negative_desktops() {
        for (left, top, width, height) in [
            (0, 0, 1920, 1080),
            (-1920, 0, 3840, 1080),
            (-2560, -1440, 4480, 2520),
        ] {
            let bounds = WindowClientBounds { left, top, width, height };
            assert_eq!(bounds.overlay_origin(PhysicalPosition::new(left, top), false), Some((0, 0, width, height)));
        }
    }

    #[test]
    fn app_origin_preserves_physical_pixels_relative_to_the_actual_overlay() {
        let bounds = WindowClientBounds { left: -2240, top: -1260, width: 1920, height: 1080 };
        assert_eq!(
            bounds.overlay_origin(PhysicalPosition::new(-2560, -1440), false),
            Some((320, 180, 1920, 1080)),
        );
        assert_eq!(
            bounds.overlay_origin(PhysicalPosition::new(-2400, -1300), false),
            Some((160, 40, 1920, 1080)),
        );
    }

    #[test]
    fn minimized_and_empty_clients_cannot_position_an_overlay() {
        let position = PhysicalPosition::new(0, 0);
        let minimized = WindowClientBounds { left: -32000, top: -32000, width: 1920, height: 1080 };
        assert_eq!(minimized.overlay_origin(position, true), None);
        for (width, height) in [(0, 1080), (1920, 0), (-1, 1080)] {
            let bounds = WindowClientBounds { left: 100, top: 200, width, height };
            assert_eq!(bounds.overlay_origin(position, false), None);
        }
    }
}

pub struct AppState {
    pub db_access: Mutex<()>,
    pub runtime: Mutex<runtime::Runtime>,
    pub db_path: std::path::PathBuf,
    pub scripts_path: std::path::PathBuf,
    /// The single always-on AutoHotkey process holding the Copilot remap and every armed
    /// profile's hotkeys and lifecycle events. Regenerated + relaunched
    /// whenever folders or profiles change.
    pub hotkeys_ahk: Mutex<ahk::AhkManager>,
    /// One Windows Job Object per profile (each kill-on-close) holding that profile's launched
    /// script processes. Everything in the job dies when the app process exits — even on a crash
    /// or hard-kill — and when the profile is disarmed, so scripts can never outlive the app.
    #[cfg(target_os = "windows")]
    pub script_runtime: Mutex<scripts::ScriptRuntime>,
    #[cfg(target_os = "windows")]
    window_transforms: Mutex<HashMap<String, WindowTransformState>>,
}

#[cfg(target_os = "windows")]
static DEBUG_LOG_STATE: OnceLock<Mutex<HashMap<&'static str, String>>> = OnceLock::new();

#[cfg(target_os = "windows")]
static MOUSE_HOOK_EVENTS: OnceLock<std::sync::mpsc::SyncSender<(i32, i32)>> = OnceLock::new();

#[cfg(target_os = "windows")]
fn is_physical_right_button_down(code: i32, message: u32, flags: u32) -> bool {
    const LLMHF_INJECTED_FLAG: u32 = 0x0000_0001;
    code >= 0
        && message == winapi::um::winuser::WM_RBUTTONDOWN
        && flags & LLMHF_INJECTED_FLAG == 0
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn mouse_hook_proc(
    code: i32,
    wparam: usize,
    lparam: isize,
) -> isize {
    use winapi::um::winuser::{CallNextHookEx, MSLLHOOKSTRUCT};
    if code >= 0 {
        let ms = &*(lparam as *const MSLLHOOKSTRUCT);
        if is_physical_right_button_down(code, wparam as u32, ms.flags) {
            if let Some(events) = MOUSE_HOOK_EVENTS.get() {
                // A low-level hook blocks Windows' input queue until it returns. Never call
                // WebView/Tauri APIs here; drop excess UI events instead of delaying input.
                let _ = events.try_send((ms.pt.x, ms.pt.y));
            }
        }
    }
    CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
}

#[cfg(target_os = "windows")]
fn start_mouse_hook(handle: tauri::AppHandle) {
    use winapi::um::winuser::{SetWindowsHookExW, WH_MOUSE_LL};
    let (events, pending_events) = std::sync::mpsc::sync_channel(16);
    if MOUSE_HOOK_EVENTS.set(events).is_err() {
        return;
    }
    std::thread::spawn(move || {
        while let Ok((x, y)) = pending_events.recv() {
            if let Some(overlay) = handle.get_webview_window("overlay") {
                if overlay.is_visible().unwrap_or(false) {
                    if let Ok(position) = overlay.inner_position() {
                        let _ = overlay.emit("overlay-right-click", (x - position.x, y - position.y));
                    }
                }
            }
        }
    });
    std::thread::spawn(|| unsafe {
        use winapi::um::winuser::{GetMessageW, TranslateMessage, DispatchMessageW, MSG};
        SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook_proc), std::ptr::null_mut(), 0);
        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    });
}

#[cfg(all(test, target_os = "windows"))]
mod mouse_hook_tests {
    use super::is_physical_right_button_down;
    use winapi::um::winuser::WM_RBUTTONDOWN;

    #[test]
    fn only_physical_right_button_down_is_forwarded() {
        assert!(is_physical_right_button_down(0, WM_RBUTTONDOWN, 0));
        assert!(!is_physical_right_button_down(-1, WM_RBUTTONDOWN, 0));
        assert!(!is_physical_right_button_down(0, WM_RBUTTONDOWN, 1));
        assert!(!is_physical_right_button_down(0, WM_RBUTTONDOWN + 1, 0));
    }
}

#[cfg(target_os = "windows")]
fn debug_log_once(key: &'static str, message: String) {
    let state = DEBUG_LOG_STATE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut state = state.lock().unwrap();
    if state.get(key).map(|prev| prev == &message).unwrap_or(false) {
        return;
    }
    state.insert(key, message.clone());
    eprintln!("{message}");
}

#[cfg(target_os = "windows")]
fn get_window_title(hwnd: winapi::shared::windef::HWND) -> String {
    use winapi::um::winuser::GetWindowTextW;

    unsafe {
        let mut buf = [0u16; 260];
        let len = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        if len <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..len as usize])
    }
}

#[tauri::command]
fn get_database(state: State<AppState>) -> Result<Database, String> {
    let _lock = state.db_access.lock().unwrap();
    config::load_db(&state.db_path)
}

fn save_database(app: &tauri::AppHandle, state: &AppState, db: &mut Database) -> Result<(), String> {
    config::normalize_states(db);
    config::normalize_overlays(db);
    for game in &db.games {
        for profile in game.profiles.iter().filter(|profile| profile.armed) {
            for hotkey in profile.hotkeys.iter().filter(|_| !profile.hotkeys_disabled) { behavior::validate(&behavior::parse(&hotkey.behavior)?)?; }
            for event in profile.events.iter().filter(|_| !profile.events_disabled) { behavior::validate(&behavior::parse(&event.behavior)?)?; }
        }
    }
    config::save_db(&state.db_path, db)?;
    state.runtime.lock().unwrap().reconcile(db, runtime::now_ms());
    prune_script_jobs(state, db);
    publish_runtime(app);
    app.state::<firebase::Firebase>().mark_pending(app);
    Ok(())
}

#[tauri::command]
fn debug_overlay_log(message: String) {
    eprintln!("[debug][overlay_frontend] {message}");
}

#[tauri::command]
fn upsert_game(app: tauri::AppHandle, state: State<AppState>, game: Game) -> Result<Database, String> {
    let _lock = state.db_access.lock().unwrap();
    let mut game = game;
    if game.id == config::GLOBAL_FOLDER_ID {
        game.exe = GLOBAL_GAME_EXE.to_string();
    }
    let mut db = config::load_db(&state.db_path)?;
    match db.games.iter_mut().find(|g| g.id == game.id) {
        Some(existing) => *existing = game,
        None => db.games.push(game),
    }
    save_database(&app, &state, &mut db)?;
    sync_hotkeys(&state, &db)?;
    Ok(db)
}

#[tauri::command]
fn delete_game(app: tauri::AppHandle, state: State<AppState>, id: String) -> Result<Database, String> {
    let _lock = state.db_access.lock().unwrap();
    // The Global folder is a permanent fixture and can never be deleted.
    if id == config::GLOBAL_FOLDER_ID {
        return Err("The Global folder can't be deleted.".to_string());
    }
    let mut db = config::load_db(&state.db_path)?;
    db.games.retain(|g| g.id != id);
    save_database(&app, &state, &mut db)?;
    sync_hotkeys(&state, &db)?;
    Ok(db)
}

#[tauri::command]
fn upsert_profile(app: tauri::AppHandle, state: State<AppState>, game_id: String, profile: Profile) -> Result<Database, String> {
    let _lock = state.db_access.lock().unwrap();
    let profile_id = profile.id.clone();
    let mut db = config::load_db(&state.db_path)?;
    let game = db.games.iter_mut().find(|g| g.id == game_id)
        .ok_or_else(|| "Folder not found".to_string())?;
    match game.profiles.iter_mut().find(|p| p.id == profile_id) {
        Some(existing) => *existing = profile,
        None => game.profiles.push(profile),
    }
    save_database(&app, &state, &mut db)?;
    sync_hotkeys(&state, &db)?;
    Ok(db)
}

#[tauri::command]
fn delete_profile(app: tauri::AppHandle, state: State<AppState>, game_id: String, profile_id: String) -> Result<Database, String> {
    let _lock = state.db_access.lock().unwrap();
    let mut db = config::load_db(&state.db_path)?;
    let game = db.games.iter_mut().find(|g| g.id == game_id)
        .ok_or_else(|| "Folder not found".to_string())?;
    game.profiles.retain(|p| p.id != profile_id);
    save_database(&app, &state, &mut db)?;
    sync_hotkeys(&state, &db)?;
    Ok(db)
}

/// Arm or disarm a profile. Arming makes its hotkeys/events/scripts live automatically whenever its
/// folder's app is focused; multiple profiles can be armed at once.
#[tauri::command]
fn set_profile_armed(app: tauri::AppHandle, state: State<AppState>, profile_id: String, armed: bool) -> Result<Database, String> {
    let _lock = state.db_access.lock().unwrap();
    let mut db = config::load_db(&state.db_path)?;
    let mut found = false;
    for game in &mut db.games {
        if let Some(profile) = game.profiles.iter_mut().find(|p| p.id == profile_id) {
            profile.armed = armed;
            found = true;
            break;
        }
    }
    if !found {
        return Err("Profile not found".to_string());
    }
    save_database(&app, &state, &mut db)?;
    sync_hotkeys(&state, &db)?;
    if !armed {
        kill_profile_scripts(&state, &profile_id);

    }
    Ok(db)
}

fn publish_runtime(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let snapshot = state.runtime.lock().unwrap().snapshot();
    if let Some(window) = app.get_webview_window("overlay") { let _ = window.emit("overlay-snapshot", snapshot); }
}

#[tauri::command]
fn set_profile_part_enabled(app: tauri::AppHandle, state: State<AppState>, profile_id: String, part: String, group_id: Option<String>, enabled: bool) -> Result<Database, String> {
    let _access = state.db_access.lock().unwrap();
    let mut db = config::load_db(&state.db_path)?;
    let game = db.games.iter_mut().find(|game| game.profiles.iter().any(|profile| profile.id == profile_id)).ok_or("Profile not found.")?;
    if let Some(group_id) = group_id {
        if part != "overlay" { return Err("Groups belong to the overlay section.".into()); }
        let profile = game.profiles.iter().find(|profile| profile.id == profile_id).unwrap();
        let mut group = config::resolve_profile_overlay_groups(&game.profiles, profile).into_iter().find(|group| group.id == group_id).ok_or("Group not found.")?.clone();
        group.disabled = !enabled;
        let profile = game.profiles.iter_mut().find(|profile| profile.id == profile_id).unwrap();
        if let Some(existing) = profile.overlay_groups.iter_mut().find(|existing| existing.id == group.id) { *existing = group; }
        else { profile.overlay_groups.push(group); }
    } else if part == "states" {
        game.states_disabled = !enabled;
    } else {
        let profile = game.profiles.iter_mut().find(|profile| profile.id == profile_id).unwrap();
        match part.as_str() {
            "hotkeys" => profile.hotkeys_disabled = !enabled,
            "events" => profile.events_disabled = !enabled,
            "scripts" => profile.scripts_disabled = !enabled,
            "overlay" => profile.overlay_disabled = !enabled,
            _ => return Err("Unknown profile section.".into()),
        }
    }
    save_database(&app, &state, &mut db)?;
    sync_hotkeys(&state, &db)?;
    Ok(db)
}

#[tauri::command]
fn get_overlay_snapshot(state: State<AppState>) -> runtime::Snapshot { state.runtime.lock().unwrap().snapshot() }

#[tauri::command]
fn dismiss_overlay_item(app: tauri::AppHandle, id: String) -> Result<(), String> {
    app.state::<AppState>().runtime.lock().unwrap().dismiss(&id)?;
    publish_runtime(&app);
    Ok(())
}

fn send_overlay(app: &tauri::AppHandle, _profiles: &[Profile], profile: &Profile, enabled: bool) {
    app.state::<AppState>().runtime.lock().unwrap().select_profile(if enabled { Some(&profile.id) } else { None });
    publish_runtime(app);
}

fn clear_overlay(app: &tauri::AppHandle) {
    app.state::<AppState>().runtime.lock().unwrap().select_profile(None);
    publish_runtime(app);
}

fn set_overlay_visible(app: &tauri::AppHandle, visible: bool) {
    if let Some(window) = app.get_webview_window("overlay") {
        let is_visible = window.is_visible().unwrap_or(false);
        if visible != is_visible {
            let _ = if visible { window.show() } else { window.hide() };
        }
    }
}

fn main_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window("main").or_else(|| {
        app.webview_windows()
            .into_iter()
            .find_map(|(label, window)| (label != "overlay").then_some(window))
    })
}

fn create_main_window(app: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    tauri::WebviewWindowBuilder::new(
        app,
        "main",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("MacroToolbox")
    .inner_size(1100.0, 700.0)
    .min_inner_size(800.0, 500.0)
    .maximized(true)
    .visible(true)
    .build()
}

fn restore_main_window(window: &tauri::WebviewWindow) {
    // Preserve the maximized state across the restore dance below: SW_RESTORE and unminimize
    // both collapse a maximized window back to its normal size, so re-apply maximize after.
    // Default to true so a freshly-created (maximized) window still comes up maximized.
    let was_maximized = window.is_maximized().unwrap_or(true);
    let _ = window.set_skip_taskbar(false);
    let _ = window.show();

    #[cfg(target_os = "windows")]
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            use winapi::um::winuser::{SetForegroundWindow, ShowWindow, SW_SHOW};

            let hwnd = hwnd.0 as winapi::shared::windef::HWND;
            ShowWindow(hwnd, SW_SHOW);
            SetForegroundWindow(hwnd);
        }
    }

    let _ = window.unminimize();
    if was_maximized {
        let _ = window.maximize();
    }
    let _ = window.set_focus();
    // WebView2 doesn't reliably fire visibilitychange for native show/hide, so tell the
    // frontend explicitly that it just became visible (it re-checks for updates on this).
    let _ = window.emit("main-window-shown", ());
}

fn hide_window_for_tray(window: &tauri::WebviewWindow) {
    let _ = window.set_skip_taskbar(true);
    let _ = window.hide();
}

fn show_main_window(app: &tauri::AppHandle) {
    eprintln!("[tray] restore requested");
    if let Some(window) = main_window(app) {
        restore_main_window(&window);
        return;
    }

    let app = app.clone();
    let main_thread_app = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = main_window(&main_thread_app) {
            restore_main_window(&window);
        } else if let Ok(window) = create_main_window(&main_thread_app) {
            restore_main_window(&window);
        } else {
            let labels = main_thread_app.webview_windows().keys().cloned().collect::<Vec<_>>();
            eprintln!("[tray] restore failed: no main window found, labels={labels:?}");
        }
    });
}

#[tauri::command]
fn reveal_main_window(app: tauri::AppHandle) {
    show_main_window(&app);
}

fn hide_main_window(app: &tauri::AppHandle) {
    eprintln!("[tray] hide requested");
    if let Some(window) = main_window(app) {
        hide_window_for_tray(&window);
    } else {
        let labels = app.webview_windows().keys().cloned().collect::<Vec<_>>();
        eprintln!("[tray] hide failed: no main window found, labels={labels:?}");
    }
}

fn quit_app(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    state.hotkeys_ahk.lock().unwrap().kill();
    kill_all_scripts(&state);
    app.exit(0);
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, TRAY_SHOW_ID, "Show MacroToolbox", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(app, TRAY_HIDE_ID, "Hide to Tray", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, TRAY_QUIT_ID, "Quit", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show_item, &hide_item, &separator, &quit_item])?;

    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("MacroToolbox")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_SHOW_ID => show_main_window(app),
            TRAY_HIDE_ID => hide_main_window(app),
            TRAY_QUIT_ID => quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            match event {
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    ..
                } | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                } => show_main_window(tray.app_handle()),
                _ => {}
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }

    tray.build(app)?;
    Ok(())
}

#[tauri::command]
fn get_overlay_config(state: State<AppState>) -> config::OverlayConfig {
    state.runtime.lock().unwrap().snapshot().config
}

fn is_global_game_exe(exe: &str) -> bool {
    exe.trim() == GLOBAL_GAME_EXE
}

/// Regenerate the combined AHK script from every armed profile and its folder target and
/// (re)launch the single always-on process. It stays alive even with no armed profiles because
/// it also owns the Copilot-key remap. Called after any profile/arming change. Note: an edit
/// the process relaunches — fine because edits happen from the manager UI, not in a game.
fn sync_hotkeys(state: &AppState, db: &Database) -> Result<(), String> {
    state.runtime.lock().unwrap().reconcile(db, runtime::now_ms());
    let mut armed: Vec<ahk::ProfileContext> = Vec::new();
    for game in &db.games {
        for profile in &game.profiles {
            armed.push(ahk::ProfileContext { siblings: &game.profiles, profile, exe: &game.exe });
        }
    }

    let mut mgr = state.hotkeys_ahk.lock().unwrap();
    let (profiles, configuration_error) = match ahk::runtime_config(&armed) {
        Ok(profiles) => (profiles, None),
        Err(error) if mgr.is_running() => return Err(error),
        Err(error) => ("[]".to_string(), Some(error)),
    };
    use std::hash::{Hash, Hasher};
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    profiles.hash(&mut hash);
    let revision = hash.finish().to_string();
    let config = serde_json::json!({"revision":revision, "profiles":serde_json::from_str::<serde_json::Value>(&profiles).map_err(|e| e.to_string())?}).to_string();
    mgr.expect_revision(revision);
    let script = ahk::input_script();
    let config_pending = state.scripts_path.join("runtime.pending.json");
    std::fs::write(&config_pending, &config).map_err(|e| format!("Could not write runtime configuration: {e}"))?;
    std::fs::rename(&config_pending, state.scripts_path.join("runtime.json")).map_err(|e| e.to_string())?;
    let script_path = state.scripts_path.join("hotkeys.ahk");
    let current = std::fs::read_to_string(&script_path).ok();
    if current.as_deref() == Some(&script) && mgr.is_running() && mgr.uses_executable(&db.settings.ahk_exe) { return Ok(()); }
    let pending = state.scripts_path.join("hotkeys.pending.ahk");
    std::fs::write(&pending, &script).map_err(|e| format!("Could not write input configuration: {e}"))?;
    mgr.validate(&db.settings.ahk_exe, &pending)?;
    std::fs::rename(&pending, &script_path).map_err(|e| format!("Could not activate input configuration: {e}"))?;
    mgr.launch(&db.settings.ahk_exe, &script_path)?;
    if let Some(error) = configuration_error {
        mgr.expect_revision("invalid configuration".into());
        return Err(error);
    }
    Ok(())
}

/// Find the profile with the given id and the sibling slice it lives in (for overlay pushes).
fn find_profile<'a>(db: &'a Database, profile_id: &str) -> Option<(&'a [Profile], &'a Profile)> {
    db.games.iter().find_map(|g| {
        g.profiles.iter().find(|p| p.id == profile_id).map(|p| (g.profiles.as_slice(), p))
    })
}

/// Push the overlay config for a just-focused profile (by id), or clear the overlay when no
/// armed overlay profile is focused. Driven by the AHK `/focus` route.
fn push_overlay_for_focus(handle: &tauri::AppHandle, profile_id: Option<String>) {
    let state = handle.state::<AppState>();
    let db = match config::load_db(&state.db_path) {
        Ok(db) => db,
        Err(_) => return,
    };
    if let Some(id) = profile_id {
        if let Some((siblings, profile)) = find_profile(&db, &id) {
            if profile.armed && config::profile_has_overlay(siblings, profile) {
                send_overlay(handle, siblings, profile, true);
                return;
            }
        }
    }
    clear_overlay(handle);
    set_overlay_visible(handle, false);
}

/// The foreground window's executable name (lowercased), used to resolve which armed profile
/// owns the overlay/viewport right now.
#[cfg(target_os = "windows")]
fn foreground_exe() -> Option<String> {
    let hwnd = unsafe { winapi::um::winuser::GetForegroundWindow() };
    if hwnd.is_null() {
        return None;
    }
    get_window_process_name(hwnd)
}

#[cfg(target_os = "windows")]
fn get_global_viewport() -> WindowClientBounds {
    let (left, top, width, height) = get_virtual_screen_bounds();
    WindowClientBounds { left, top, width, height }
}

#[tauri::command]
fn get_overlay_origin(window: tauri::WebviewWindow, state: State<AppState>, folder_id: String) -> Result<Option<(i32, i32, i32, i32)>, String> {
    #[cfg(target_os = "windows")]
    {
        let _dpi = PhysicalCoordinates::enter()?;
        let db = config::load_db(&state.db_path)?;
        let Some(game) = db.games.iter().find(|game| game.id == folder_id) else { return Ok(None); };
        let (bounds, minimized) = if is_global_game_exe(&game.exe) {
            (get_global_viewport(), false)
        } else {
            let Some(hwnd) = find_window_by_exe(&game.exe) else { return Ok(None); };
            (get_window_client_bounds(hwnd)?, unsafe { winapi::um::winuser::IsIconic(hwnd) != 0 })
        };
        let desktop = get_global_viewport();
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as winapi::shared::windef::HWND;
        let canvas = fit_overlay_to_desktop(hwnd, desktop)?;
        let position = tauri::PhysicalPosition::new(canvas.left, canvas.top);
        Ok(bounds.overlay_origin(position, minimized))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, state, folder_id);
        Ok(None)
    }
}

#[cfg(target_os = "windows")]
fn get_behavior_viewport(target: &str) -> Result<WindowClientBounds, String> {
    if is_global_game_exe(target) { return Ok(get_global_viewport()); }
    get_game_client_bounds(target)
}

fn decode_query_value(value: &str) -> String {
    let mut out = Vec::with_capacity(value.len());
    let bytes = value.as_bytes();
    let mut idx = 0;
    while idx < bytes.len() {
        match bytes[idx] {
            b'+' => {
                out.push(b' ');
                idx += 1;
            }
            b'%' if idx + 2 < bytes.len() => {
                let hex = &value[idx + 1..idx + 3];
                if let Ok(parsed) = u8::from_str_radix(hex, 16) {
                    out.push(parsed);
                    idx += 3;
                } else {
                    out.push(bytes[idx]);
                    idx += 1;
                }
            }
            byte => {
                out.push(byte);
                idx += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn get_query_param(path: &str, key: &str) -> Option<String> {
    let query = path.split_once('?')?.1;
    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find_map(|(name, value)| (name == key).then(|| decode_query_value(value)))
}

fn runtime_action(app: &tauri::AppHandle, scope: &runtime::ExecutionScope, kind: &str, id: &str, value: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    let profile = scope.profile.as_str();
    match kind {
        "enabled" => {
            if value != "0" && value != "1" { return Err("Enabled must be 0 or 1.".into()); }
            let _access = state.db_access.lock().unwrap();
            let db = config::load_db(&state.db_path)?;
            state.runtime.lock().unwrap().set_enabled(&db, profile, value == "1", runtime::now_ms())?;
            if value != "1" { kill_profile_scripts(&state, profile); }
        }
        "script" => run_script_for_profile(app, scope, id, if matches!(value, "hotkeys" | "events" | "scripts") { value } else { scope.section() })?,
        "behavior" => {
            let _access = state.db_access.lock().unwrap();
            let db = config::load_db(&state.db_path)?;
            state.runtime.lock().unwrap().enqueue(&db, scope, value)?;
        }
        "error" => { app.emit("runtime-error", value).map_err(|e| e.to_string())?; }
        _ => state.runtime.lock().unwrap().action(profile, kind, id, value, runtime::now_ms())?,
    }
    publish_runtime(app);
    Ok(())
}

fn run_script_for_profile(app: &tauri::AppHandle, source: &runtime::ExecutionScope, script_id: &str, caller_section: &str) -> Result<(), String> {
    let profile_id = source.profile.as_str();
    let state = app.state::<AppState>();
    let _access = state.db_access.lock().unwrap();
    let db = config::load_db(&state.db_path)?;
    if !source.script_owner.is_empty() && !source.is_active(&db) { return Ok(()); }
    let game = db.games.iter().find(|game| game.profiles.iter().any(|profile| profile.id == profile_id && profile.armed)).ok_or("Profile is unavailable.")?;
    if !state.runtime.lock().unwrap().enabled(profile_id) { return Err("Profile is disabled.".into()); }
    let caller_section = if matches!(caller_section, "hotkeys" | "events" | "scripts") { caller_section } else { "scripts" };
    if !game.profiles.iter().any(|profile| profile.id == profile_id && profile.section_enabled(caller_section)) { return Ok(()); }
    let (owner, script) = game.profiles.iter().filter(|profile| profile.armed).find_map(|profile| profile.scripts.iter().find(|script| script.id == script_id && script.enabled).map(|script| (profile, script))).ok_or("Script is disabled or unavailable.")?;
    if owner.scripts_disabled { return Ok(()); }
    if !state.runtime.lock().unwrap().enabled(&owner.id) { return Err("Script owner is disabled.".into()); }
    let scope = runtime::ExecutionScope { profile: profile_id.into(), section: caller_section.into(), script_owner: owner.id.clone() };
    spawn_tracked_script(&state, &db.settings, script, &scope, &game.exe)
}

fn start_overlay_listener(handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::bind(format!("127.0.0.1:{OVERLAY_PORT}")).await {
            Ok(l) => { eprintln!("[overlay] TCP listener bound on port {OVERLAY_PORT}"); l }
            Err(e) => { eprintln!("[overlay] TCP bind FAILED: {e}"); return; }
        };
        loop {
            if let Ok((mut stream, _)) = listener.accept().await {
                use tokio::io::AsyncWriteExt;
                let handle = handle.clone();
                tauri::async_runtime::spawn(async move {
                    let request = match protocol::read_request(&mut stream).await { Ok(request) => request, Err(_) => return };
                    let action = request.path.as_str();
                    let route = action.split('?').next().unwrap_or(action);
                    let (status, body) = if route == "/runtime" && !request.body.is_empty() {
                        match serde_json::from_slice::<protocol::RuntimeAction>(&request.body) {
                            Ok(command) => match runtime_action(&handle, &command.scope, &command.kind, &command.id, &command.value) {
                                Ok(()) => ("200 OK", Vec::new()), Err(error) => ("422 Unprocessable Entity", error.into_bytes()),
                            },
                            Err(error) => ("400 Bad Request", error.to_string().into_bytes()),
                        }
                    } else if route == "/activated" {
                        handle.state::<AppState>().hotkeys_ahk.lock().unwrap().activate_revision(get_query_param(action, "revision").unwrap_or_default());
                        ("200 OK", Vec::new())
                    } else if route == "/commands" {
                        let commands = handle.state::<AppState>().runtime.lock().unwrap().take_commands();
                        ("200 OK", serde_json::to_vec(&commands).unwrap_or_default())
                    } else if route == "/runtime" {
                        let profile = get_query_param(action, "profile").unwrap_or_default();
                        let kind = get_query_param(action, "kind").unwrap_or_default();
                        let id = get_query_param(action, "id").unwrap_or_default();
                        let value = get_query_param(action, "value").unwrap_or_default();
                        let scope = runtime::ExecutionScope { profile, section: get_query_param(action, "section").unwrap_or_default(), script_owner: get_query_param(action, "script_owner").unwrap_or_default() };
                        match runtime_action(&handle, &scope, &kind, &id, &value) {
                            Ok(()) => ("200 OK", Vec::new()),
                            Err(error) => ("422 Unprocessable Entity", error.into_bytes()),
                        }
                    } else if route == "/runtime-state" {
                        let profile = get_query_param(action, "profile").unwrap_or_default();
                        match handle.state::<AppState>().runtime.lock().unwrap().profile_snapshot(&profile) {
                            Some(snapshot) => ("200 OK", serde_json::to_vec(&snapshot).unwrap_or_default()),
                            None => ("404 Not Found", b"Profile is unavailable".to_vec()),
                        }
                    } else if route == "/target-blur" {
                        let exe = get_query_param(action, "exe").unwrap_or_default();
                        let state = handle.state::<AppState>();
                        if let Ok(db) = config::load_db(&state.db_path) {
                            for game in &db.games {
                                if game.exe.eq_ignore_ascii_case(&exe) {
                                    for profile in &game.profiles { kill_profile_scripts(&state, &profile.id); }
                                }
                            }
                        }
                        ("200 OK", Vec::new())
                    } else if route == "/borderless" {
                        match get_query_param(action, "exe").filter(|value| !value.is_empty()) {
                            Some(exe) => match toggle_borderless(handle.state(), exe) {
                                Ok(enabled) => ("200 OK", enabled.to_string().into_bytes()),
                                Err(err) => ("404 Not Found", err.into_bytes()),
                            },
                            None => ("400 Bad Request", b"Missing executable".to_vec()),
                        }
                    } else if route == "/fit" {
                        match get_query_param(action, "exe").filter(|value| !value.is_empty()) {
                            Some(exe) => match toggle_fit(handle.state(), exe) {
                                Ok(enabled) => ("200 OK", enabled.to_string().into_bytes()),
                                Err(err) => ("404 Not Found", err.into_bytes()),
                            },
                            None => ("400 Bad Request", b"Missing executable".to_vec()),
                        }
                    } else if route == "/stretch" {
                        match get_query_param(action, "exe").filter(|value| !value.is_empty()) {
                            Some(exe) => match toggle_stretch(handle.state(), exe) {
                                Ok(enabled) => ("200 OK", enabled.to_string().into_bytes()),
                                Err(err) => ("404 Not Found", err.into_bytes()),
                            },
                            None => ("400 Bad Request", b"Missing executable".to_vec()),
                        }
                    } else if route == "/killprocess" {
                        match get_query_param(action, "exe").filter(|value| !value.is_empty()) {
                            Some(exe) => match kill_game(exe) {
                                Ok(()) => ("200 OK", Vec::new()),
                                Err(err) => ("404 Not Found", err.into_bytes()),
                            },
                            None => ("400 Bad Request", b"Missing executable".to_vec()),
                        }
                    } else if route == "/resolution" {
                        let exe = get_query_param(action, "exe").filter(|value| !value.is_empty());
                        let dimension = |key| get_query_param(action, key)
                            .and_then(|value| value.parse::<u32>().ok())
                            .filter(|value| *value > 0);
                        match (exe, dimension("width"), dimension("height")) {
                            (Some(exe), Some(width), Some(height)) => match set_display_resolution(&exe, width, height) {
                                Ok(()) => ("200 OK", Vec::new()),
                                Err(err) => {
                                    eprintln!("[display] {err}");
                                    ("422 Unprocessable Entity", err.into_bytes())
                                }
                            },
                            _ => ("400 Bad Request", b"Missing executable or invalid resolution".to_vec()),
                        }
                    } else if route == "/focus" {
                        // The AHK script reports which armed profile's app just became focused
                        // (or none). Push that profile's overlay config, or clear it.
                        push_overlay_for_focus(&handle, get_query_param(action, "id").filter(|v| !v.is_empty()));
                        ("200 OK", Vec::new())
                    } else {
                        match route {
                            "/show" => {
                                set_overlay_visible(&handle, true);
                                ("200 OK", Vec::new())
                            }
                            "/hide" => {
                                set_overlay_visible(&handle, false);
                                ("200 OK", Vec::new())
                            }
                            "/viewport" => {
                                #[cfg(target_os = "windows")]
                                {
                                    match get_query_param(action, "exe").or_else(foreground_exe).ok_or_else(|| "No target window".to_string()).and_then(|target| get_behavior_viewport(&target)) {
                                        Ok(bounds) => (
                                            "200 OK",
                                            format!("{},{},{},{}", bounds.left, bounds.top, bounds.width, bounds.height).into_bytes(),
                                        ),
                                        Err(err) => ("404 Not Found", err.into_bytes()),
                                    }
                                }

                                #[cfg(not(target_os = "windows"))]
                                {
                                    ("501 Not Implemented", b"Not supported on this platform".to_vec())
                                }
                            }
                            _ => ("404 Not Found", b"Unknown runtime endpoint".to_vec()),
                        }
                    };

                    let headers = format!(
                        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    let _ = stream.write_all(headers.as_bytes()).await;
                    if !body.is_empty() {
                        let _ = stream.write_all(&body).await;
                    }
                });
            }
        }
    });
}

#[tauri::command]
fn get_ahk_status(state: State<AppState>) -> bool {
    state.hotkeys_ahk.lock().unwrap().is_active()
}

#[cfg(target_os = "windows")]
fn get_window_process_name(hwnd: winapi::shared::windef::HWND) -> Option<String> {
    use winapi::shared::minwindef::DWORD;
    use winapi::um::handleapi::CloseHandle;
    use winapi::um::processthreadsapi::OpenProcess;
    use winapi::um::psapi::GetModuleFileNameExW;
    use winapi::um::winnt::{PROCESS_QUERY_INFORMATION, PROCESS_VM_READ};
    use winapi::um::winuser::GetWindowThreadProcessId;

    unsafe {
        let mut pid: DWORD = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 {
            return None;
        }

        let proc = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid);
        if proc.is_null() {
            return None;
        }

        let mut buf = [0u16; 260];
        let len = GetModuleFileNameExW(proc, std::ptr::null_mut(), buf.as_mut_ptr(), buf.len() as u32);
        CloseHandle(proc);
        if len == 0 {
            return None;
        }

        let path = String::from_utf16_lossy(&buf[..len as usize]);
        Some(path.split('\\').last().unwrap_or("").to_lowercase())
    }
}

/// Executable names of currently-open apps — visible, titled, top-level windows — for the
/// scope editor's dropdown. Deduped and sorted (BTreeSet).
#[cfg(target_os = "windows")]
#[tauri::command]
fn list_open_executables() -> Vec<String> {
    use std::collections::BTreeSet;
    use winapi::shared::minwindef::{BOOL, LPARAM, TRUE};
    use winapi::shared::windef::HWND;
    use winapi::um::winuser::{EnumWindows, GetWindow, GetWindowTextLengthW, IsWindowVisible, GW_OWNER};

    unsafe extern "system" fn enum_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let set = &mut *(lparam as *mut BTreeSet<String>);
        // Only real, foreground-able app windows: visible, no owner, with a title bar text.
        if IsWindowVisible(hwnd) == 0 { return TRUE; }
        if !GetWindow(hwnd, GW_OWNER).is_null() { return TRUE; }
        if GetWindowTextLengthW(hwnd) == 0 { return TRUE; }
        if let Some(name) = get_window_process_name(hwnd) {
            if !name.is_empty() {
                set.insert(name);
            }
        }
        TRUE
    }

    let mut set: BTreeSet<String> = BTreeSet::new();
    unsafe { EnumWindows(Some(enum_cb), &mut set as *mut _ as LPARAM); }
    set.into_iter().collect()
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn list_open_executables() -> Vec<String> {
    Vec::new()
}

#[cfg(target_os = "windows")]
fn get_window_client_area(hwnd: winapi::shared::windef::HWND) -> i64 {
    use winapi::shared::windef::RECT;
    use winapi::um::winuser::GetClientRect;

    unsafe {
        let mut rect: RECT = std::mem::zeroed();
        if GetClientRect(hwnd, &mut rect) == 0 {
            return 0;
        }

        let width = (rect.right - rect.left).max(0);
        let height = (rect.bottom - rect.top).max(0);
        i64::from(width) * i64::from(height)
    }
}

#[cfg(target_os = "windows")]
fn find_window_by_exe(exe: &str) -> Option<winapi::shared::windef::HWND> {
    use winapi::shared::minwindef::{BOOL, LPARAM, TRUE};
    use winapi::shared::windef::HWND;
    use winapi::um::winuser::{EnumWindows, GetForegroundWindow, IsWindowVisible};

    struct FindData {
        target: String,
        hwnd: HWND,
        area: i64,
    }

    unsafe {
        let foreground = GetForegroundWindow();
        if !foreground.is_null()
            && IsWindowVisible(foreground) != 0
            && get_window_process_name(foreground).as_deref() == Some(&exe.to_lowercase())
        {
            debug_log_once(
                "selected_window",
                format!(
                    "[debug][window] source=foreground exe={} hwnd=0x{:X} title={:?} area={}",
                    exe,
                    foreground as usize,
                    get_window_title(foreground),
                    get_window_client_area(foreground),
                ),
            );
            return Some(foreground);
        }
    }

    unsafe extern "system" fn enum_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let data = &mut *(lparam as *mut FindData);
        if IsWindowVisible(hwnd) == 0 { return TRUE; }
        if get_window_process_name(hwnd).as_deref() == Some(&data.target) {
            let area = get_window_client_area(hwnd);
            if area > data.area {
                data.hwnd = hwnd;
                data.area = area;
            }
        }
        TRUE
    }

    let mut data = FindData {
        target: exe.to_lowercase(),
        hwnd: std::ptr::null_mut(),
        area: 0,
    };
    unsafe { EnumWindows(Some(enum_cb), &mut data as *mut _ as LPARAM); }
    if data.hwnd.is_null() {
        debug_log_once(
            "selected_window",
            format!("[debug][window] source=enum exe={} hwnd=<none>", exe),
        );
        None
    } else {
        debug_log_once(
            "selected_window",
            format!(
                "[debug][window] source=largest exe={} hwnd=0x{:X} title={:?} area={}",
                exe,
                data.hwnd as usize,
                get_window_title(data.hwnd),
                data.area,
            ),
        );
        Some(data.hwnd)
    }
}

#[cfg(target_os = "windows")]
fn focus_game_window(exe: &str) {
    if let Some(hwnd) = find_window_by_exe(exe) {
        unsafe { winapi::um::winuser::SetForegroundWindow(hwnd); }
    }
}

#[cfg(target_os = "windows")]
fn get_window_client_bounds(hwnd: winapi::shared::windef::HWND) -> Result<WindowClientBounds, String> {
    let _dpi = PhysicalCoordinates::enter()?;
    use winapi::shared::windef::{POINT, RECT};
    use winapi::um::winuser::{ClientToScreen, GetClientRect};

    unsafe {
        let mut rect: RECT = std::mem::zeroed();
        if GetClientRect(hwnd, &mut rect) == 0 {
            return Err("Failed to read game client area".to_string());
        }

        let mut top_left = POINT { x: rect.left, y: rect.top };
        if ClientToScreen(hwnd, &mut top_left) == 0 {
            return Err("Failed to convert game client origin".to_string());
        }

        let bounds = WindowClientBounds {
            left: top_left.x,
            top: top_left.y,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
        };
        debug_log_once(
            "client_bounds",
            format!(
                "[debug][client_bounds] hwnd=0x{:X} title={:?} left={} top={} width={} height={}",
                hwnd as usize,
                get_window_title(hwnd),
                bounds.left,
                bounds.top,
                bounds.width,
                bounds.height,
            ),
        );
        Ok(bounds)
    }
}

#[cfg(target_os = "windows")]
fn get_game_client_bounds(exe: &str) -> Result<WindowClientBounds, String> {
    let hwnd = find_window_by_exe(exe)
        .ok_or_else(|| format!("Game window not found for '{exe}'"))?;
    let bounds = get_window_client_bounds(hwnd)?;
    debug_log_once(
        "game_bounds",
        format!(
            "[debug][game_bounds] exe={} hwnd=0x{:X} left={} top={} width={} height={}",
            exe, hwnd as usize, bounds.left, bounds.top, bounds.width, bounds.height,
        ),
    );
    Ok(bounds)
}

#[cfg(target_os = "windows")]
fn get_virtual_screen_bounds() -> (i32, i32, i32, i32) {
    use winapi::um::winuser::{
        GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
        SM_YVIRTUALSCREEN,
    };

    unsafe {
        (
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
            GetSystemMetrics(SM_CXVIRTUALSCREEN),
            GetSystemMetrics(SM_CYVIRTUALSCREEN),
        )
    }
}

#[cfg(target_os = "windows")]
fn fit_overlay_to_desktop(
    hwnd: winapi::shared::windef::HWND,
    desktop: WindowClientBounds,
) -> Result<WindowClientBounds, String> {
    use winapi::um::winuser::{SetWindowPos, SWP_NOACTIVATE, SWP_NOSENDCHANGING, SWP_NOZORDER};

    let _dpi = PhysicalCoordinates::enter()?;
    let current = get_window_client_bounds(hwnd)?;
    if current == desktop { return Ok(current); }

    // The transparent canvas spans every monitor. Apply its physical rectangle together,
    // bypassing normal window tracking limits that can clip it to a single monitor.
    if unsafe {
        SetWindowPos(
            hwnd, std::ptr::null_mut(), desktop.left, desktop.top, desktop.width, desktop.height,
            SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOSENDCHANGING,
        )
    } == 0 {
        return Err(format!("Failed to resize overlay: {}", std::io::Error::last_os_error()));
    }
    let canvas = get_window_client_bounds(hwnd)?;
    if canvas != desktop {
        return Err("Overlay window does not cover the virtual desktop".into());
    }
    Ok(canvas)
}

#[tauri::command]
fn kill_game(exe: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use winapi::shared::minwindef::{FALSE};
        use winapi::um::handleapi::{CloseHandle, INVALID_HANDLE_VALUE};
        use winapi::um::processthreadsapi::{OpenProcess, TerminateProcess};
        use winapi::um::tlhelp32::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
        use winapi::um::winnt::PROCESS_TERMINATE;

        let exe_lower = exe.to_lowercase();
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap == INVALID_HANDLE_VALUE { return Err("Failed to snapshot processes".to_string()); }
            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            let mut killed = false;
            if Process32FirstW(snap, &mut entry) != FALSE {
                loop {
                    let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                    let name = String::from_utf16_lossy(&entry.szExeFile[..len]).to_lowercase();
                    if name == exe_lower {
                        let proc = OpenProcess(PROCESS_TERMINATE, FALSE, entry.th32ProcessID);
                        if !proc.is_null() {
                            TerminateProcess(proc, 1);
                            CloseHandle(proc);
                            killed = true;
                        }
                    }
                    if Process32NextW(snap, &mut entry) == FALSE { break; }
                }
            }
            CloseHandle(snap);
            if killed { Ok(()) } else { Err(format!("Process '{}' not found", exe)) }
        }
    }
    #[cfg(not(target_os = "windows"))]
    Err("Not supported on this platform".to_string())
}

#[tauri::command]
fn toggle_borderless(state: State<AppState>, exe: String) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    return toggle_window_transform(&state, &exe, WindowTransform::Borderless);
    #[cfg(not(target_os = "windows"))]
    Err("Not supported on this platform".to_string())
}

#[tauri::command]
fn toggle_stretch(state: State<AppState>, exe: String) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    return toggle_window_transform(&state, &exe, WindowTransform::Stretch);
    #[cfg(not(target_os = "windows"))]
    Err("Not supported on this platform".to_string())
}

#[tauri::command]
fn toggle_fit(state: State<AppState>, exe: String) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    return toggle_window_transform(&state, &exe, WindowTransform::Fit);
    #[cfg(not(target_os = "windows"))]
    Err("Not supported on this platform".to_string())
}

#[cfg(target_os = "windows")]
fn toggle_window_transform(
    state: &AppState,
    exe: &str,
    transform: WindowTransform,
) -> Result<bool, String> {
    let key = exe.to_lowercase();
    let mut transforms = state.window_transforms.lock().unwrap();
    if transforms.get(&key).is_some_and(|saved| !saved.is_current()) {
        transforms.remove(&key);
    }
    // Keep the selected window for the whole transform session; a foreground dialog belonging
    // to the same executable must not replace its parent's original size and placement.
    if !transforms.contains_key(&key) {
        let hwnd = find_window_by_exe(exe)
            .ok_or_else(|| format!("Game window not found for '{exe}'"))?;
        transforms.insert(key.clone(), WindowTransformState::capture(hwnd)?);
    }
    let saved = transforms.get_mut(&key).unwrap();
    let enabled = saved.toggle(transform)?;
    if !saved.is_active() {
        transforms.remove(&key);
    }
    Ok(enabled)
}

#[cfg(target_os = "windows")]
fn restore_window_transforms(state: &AppState) {
    for (_, mut saved) in state.window_transforms.lock().unwrap().drain() {
        if let Err(error) = saved.restore() {
            eprintln!("[window] {error}");
        }
    }
}

fn set_display_resolution(exe: &str, width: u32, height: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = find_window_by_exe(exe)
            .ok_or_else(|| format!("Window not found for '{exe}'"))?;
        display_resolution::set_resolution(hwnd, width, height)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (exe, width, height);
        Err("Not supported on this platform".to_string())
    }
}

#[tauri::command]
async fn pick_coordinate(window: tauri::WebviewWindow, exe: String) -> Result<(f64, f64), String> {
    #[cfg(target_os = "windows")]
    if !is_global_game_exe(&exe) {
        focus_game_window(&exe);
    }

    window.minimize().map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    let exe_for_pick = exe.clone();

    let result = tokio::task::spawn_blocking(move || -> Result<(f64, f64), String> {
        use std::time::{Duration, Instant};
        std::thread::sleep(Duration::from_millis(400));

        #[cfg(target_os = "windows")]
        unsafe {
            let _dpi = PhysicalCoordinates::enter()?;
            use winapi::um::winuser::{GetAsyncKeyState, GetCursorPos};
            use winapi::shared::windef::POINT;

            while (GetAsyncKeyState(0x01) as u16) & 0x8000 != 0 {
                std::thread::sleep(Duration::from_millis(15));
            }

            let deadline = Instant::now() + Duration::from_secs(30);
            loop {
                if Instant::now() > deadline {
                    return Err("Timed out waiting for click".to_string());
                }
                std::thread::sleep(Duration::from_millis(15));
                if (GetAsyncKeyState(0x01) as u16) & 0x8000 != 0 {
                    let mut pt = POINT { x: 0, y: 0 };
                    GetCursorPos(&mut pt);
                    let bounds = if is_global_game_exe(&exe_for_pick) {
                        get_global_viewport()
                    } else {
                        get_game_client_bounds(&exe_for_pick)?
                    };
                    while (GetAsyncKeyState(0x01) as u16) & 0x8000 != 0 {
                        std::thread::sleep(Duration::from_millis(15));
                    }
                    let rel_x = pt.x - bounds.left;
                    let rel_y = pt.y - bounds.top;
                    let x = if bounds.width <= 0 {
                        0.0
                    } else {
                        (((rel_x as f64 / bounds.width as f64) * 1000.0).round() / 10.0)
                            .clamp(0.0, 100.0)
                    };
                    let y = if bounds.height <= 0 {
                        0.0
                    } else {
                        (((rel_y as f64 / bounds.height as f64) * 1000.0).round() / 10.0)
                            .clamp(0.0, 100.0)
                    };
                    eprintln!(
                        "[debug][pick] exe={} click_screen=({}, {}) bounds=({}, {}, {}, {}) rel=({}, {}) percent=({:.1}, {:.1})",
                        exe_for_pick,
                        pt.x,
                        pt.y,
                        bounds.left,
                        bounds.top,
                        bounds.width,
                        bounds.height,
                        rel_x,
                        rel_y,
                        x,
                        y,
                    );
                    return Ok((x, y));
                }
            }
        }

        #[cfg(not(target_os = "windows"))]
        Err("Not supported on this platform".to_string())
    })
    .await
    .map_err(|e| e.to_string())?;

    let _ = window.unminimize();
    let _ = window.set_focus();
    result
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_image_as_data_url(path: String) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let mime = match std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "gif"          => "image/gif",
        "webp"         => "image/webp",
        "ico"          => "image/x-icon",
        _              => "image/png",
    };
    Ok(format!("data:{};base64,{}", mime, STANDARD.encode(&bytes)))
}

#[tauri::command]
fn set_overlay_passthrough(app: tauri::AppHandle, passthrough: bool) {
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.set_ignore_cursor_events(passthrough);
    }
}

#[tauri::command]
fn toggle_overlay(app: tauri::AppHandle) {
    eprintln!("[overlay] toggle_overlay command called");
    match app.get_webview_window("overlay") {
        None => eprintln!("[overlay] window not found in toggle_overlay"),
        Some(w) => {
            let visible = w.is_visible().unwrap_or(false);
            eprintln!("[overlay] visible={visible}, toggling");
            let result = if visible { w.hide() } else { w.show() };
            eprintln!("[overlay] toggle result: {result:?}");
        }
    }
}

#[tauri::command]
fn get_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Register or unregister the app to launch at login. Re-applied on every launch so the
/// registration tracks the current executable across updates and moves.
///
/// On Windows the app runs elevated (`requireAdministrator`, see build.rs). Windows refuses to
/// auto-launch an elevated app from the HKCU `Run` key at logon — it can't show a UAC prompt
/// during logon, so the entry is silently skipped and the app never starts. The autostart
/// plugin only knows the Run key, so on Windows we register a Scheduled Task with highest
/// privileges triggered at logon instead — the only supported way to start an admin app at
/// logon without a prompt. (Creating the task itself needs elevation, which we already have.)
/// Other platforms use the plugin as normal.
fn sync_autostart(app: &tauri::AppHandle, enabled: bool) {
    #[cfg(not(target_os = "windows"))]
    {
        use tauri_plugin_autostart::ManagerExt;
        let manager = app.autolaunch();
        let _ = if enabled { manager.enable() } else { manager.disable() };
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const TASK_NAME: &str = "MacroToolbox";

        // Drop the dead Run-key entry and Startup-folder shortcut earlier versions created:
        // neither can launch an elevated app at logon, yet they show as "enabled" in Task
        // Manager's Startup tab while never actually starting.
        let app_name = app
            .config()
            .product_name
            .clone()
            .unwrap_or_else(|| app.package_info().name.clone());
        {
            use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
            use winreg::RegKey;
            if let Ok(run) = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(
                r"Software\Microsoft\Windows\CurrentVersion\Run",
                KEY_SET_VALUE,
            ) {
                let _ = run.delete_value(&app_name);
            }
        }
        if let Ok(appdata) = std::env::var("APPDATA") {
            let _ = std::fs::remove_file(format!(
                r"{appdata}\Microsoft\Windows\Start Menu\Programs\Startup\Hotkey Manager.lnk"
            ));
        }

        if enabled {
            if let Ok(exe) = std::env::current_exe() {
                let _ = std::process::Command::new("schtasks")
                    .args([
                        "/Create",
                        "/F",
                        "/TN",
                        TASK_NAME,
                        "/TR",
                        &format!("\"{}\"", exe.display()),
                        "/SC",
                        "ONLOGON",
                        "/RL",
                        "HIGHEST",
                    ])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output();
            }
        } else {
            let _ = std::process::Command::new("schtasks")
                .args(["/Delete", "/F", "/TN", TASK_NAME])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
        }
    }
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, state: State<AppState>, mut settings: Settings) -> Result<Database, String> {
    let _lock = state.db_access.lock().unwrap();
    let mut db = config::load_db(&state.db_path)?;
    settings.library_width = db.settings.library_width;
    db.settings = settings;
    save_database(&app, &state, &mut db)?;
    sync_hotkeys(&state, &db)?;
    sync_autostart(&app, db.settings.launch_on_startup);
    Ok(db)
}

#[tauri::command]
fn set_library_width(app: tauri::AppHandle, state: State<AppState>, width: u16) -> Result<(), String> {
    if !(240..=520).contains(&width) { return Err("Invalid sidebar width.".into()); }
    let _lock = state.db_access.lock().unwrap();
    let mut db = config::load_db(&state.db_path)?;
    db.settings.library_width = Some(width);
    save_database(&app, &state, &mut db)
}

/// Download the given release installer and launch it, then quit so the installer can
/// replace the running executable. Downloading in the backend avoids the browser's
/// download-redirect handling and any webview CORS restrictions.
#[tauri::command]
async fn download_and_install_update(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("MacroToolbox")
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("Could not start the download: {e}"))?;
    let bytes = client
        .get(&url)
        .send()
        .await
        .and_then(|response| response.error_for_status())
        .map_err(|e| format!("Download failed: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;

    let mut installer_path = std::env::temp_dir();
    installer_path.push("MacroToolbox-update-setup.exe");
    std::fs::write(&installer_path, &bytes)
        .map_err(|e| format!("Could not save the installer: {e}"))?;

    // Launch the installer in passive mode so an update just applies instead of prompting:
    // /P passive (progress bar, no delete-data prompt or shortcut checkbox), /R relaunch the
    // app when done, /NS don't (re)create shortcuts. It keeps running after we exit, so we
    // then quit to unlock the running executable and let it be replaced.
    std::process::Command::new(&installer_path)
        .args(["/P", "/R", "/NS"])
        .spawn()
        .map_err(|e| format!("Could not launch the installer: {e}"))?;

    quit_app(&app);
    Ok(())
}

fn spawn_tracked_script(state: &AppState, settings: &Settings, script: &Script, scope: &runtime::ExecutionScope, target: &str) -> Result<(), String> {
    let ahk_exe = state.hotkeys_ahk.lock().unwrap().executable_path(&settings.ahk_exe);
    #[cfg(target_os = "windows")]
    return state.script_runtime.lock().unwrap().launch(settings, &ahk_exe, script, &state.scripts_path, scope, target);
    #[cfg(not(target_os = "windows"))]
    {
        let _ = target;
        scripts::run_script(&settings.python_exe, &ahk_exe, script, &state.scripts_path, scope).map(|_| ())
    }
}

fn prune_script_jobs(state: &AppState, db: &Database) {
    #[cfg(target_os = "windows")]
    state.script_runtime.lock().unwrap().reconcile(db);
    let _ = (state, db);
}

fn kill_profile_scripts(state: &AppState, profile_id: &str) {
    #[cfg(target_os = "windows")]
    state.script_runtime.lock().unwrap().stop_profile(profile_id);
    let _ = (state, profile_id);
}

fn kill_all_scripts(state: &AppState) {
    #[cfg(target_os = "windows")]
    state.script_runtime.lock().unwrap().clear();
    let _ = state;
}

fn start_watcher(handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut last_tick = std::time::SystemTime::now();
        let mut first_tick = true;
        loop {
            // Establish the process baseline immediately. Sleeping before the first observation
            // could miss an app launched during those first three seconds: it would appear as
            // already running instead of as a not-running -> running transition.
            if first_tick {
                first_tick = false;
            } else {
                std::thread::sleep(std::time::Duration::from_secs(3));
            }

            // A wall-clock jump across a 3s sleep means the machine was suspended. Windows may
            // have dropped the AHK hooks, so relaunch the hotkeys script fresh below.
            let now = std::time::SystemTime::now();
            let resumed = now
                .duration_since(last_tick)
                .map(|gap| gap > std::time::Duration::from_secs(30))
                .unwrap_or(false);
            last_tick = now;

            let state = handle.state::<AppState>();
            #[cfg(target_os = "windows")]
            state.script_runtime.lock().unwrap().reap();

            let db = match config::load_db(&state.db_path) {
                Ok(db) => db,
                Err(_) => continue,
            };

            // Keep the single hotkey/Copilot script alive and relaunch it after suspend. #HotIf
            // handles profile focus gating; the Copilot remap remains active with no profiles.
            if resumed {
                state.hotkeys_ahk.lock().unwrap().kill();
            }
            let running = state.hotkeys_ahk.lock().unwrap().is_running();
            if !running {
                if let Err(error) = sync_hotkeys(&state, &db) { eprintln!("[runtime] {error}"); }
            }

            // Re-assert that the app and its AutoHotkey process stay out of Windows Efficiency
            // Mode: the one-shot opt-out at launch doesn't hold once the app drops to the tray, so
            // Windows re-throttles the tree and the hotkey hook goes dead after idle. Re-applying
            // it every tick keeps the tree exempt for as long as the app runs.
            #[cfg(target_os = "windows")]
            {
                ahk::disable_power_throttling(unsafe {
                    winapi::um::processthreadsapi::GetCurrentProcess()
                });
                state.hotkeys_ahk.lock().unwrap().keep_responsive();
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be the first plugin: a second launch hands off to the running instance,
        // which just brings its window to the front instead of opening another copy.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                    let app = window.app_handle();
                    let state = app.state::<AppState>();
                    let close_to_tray = config::load_db(&state.db_path)
                        .map(|db| db.settings.close_to_tray)
                        .unwrap_or(false);

                    if close_to_tray {
                        api.prevent_close();
                        hide_main_window(&app);
                    }
                }
                tauri::WindowEvent::Destroyed if window.label() == "main" => {
                    let app = window.app_handle();
                    let state = app.state::<AppState>();
                    let close_to_tray = config::load_db(&state.db_path)
                        .map(|db| db.settings.close_to_tray)
                        .unwrap_or(false);

                    if !close_to_tray {
                        state.hotkeys_ahk.lock().unwrap().kill();
                        kill_all_scripts(&state);
                    }
                }
                _ => {}
            }
        })
        .setup(|app| {
            // Keep the app (and thus its child AutoHotkey process tree) out of Windows
            // Efficiency Mode while it lives in the tray, so hotkeys don't go dead after idle.
            #[cfg(target_os = "windows")]
            unsafe {
                ahk::disable_power_throttling(winapi::um::processthreadsapi::GetCurrentProcess());
            }

            let data_dir = app.path().app_data_dir()
                .expect("failed to resolve app data dir");
            let scripts_dir = data_dir.join("scripts");
            std::fs::create_dir_all(&scripts_dir)
                .expect("failed to create scripts dir");

            let db_path = data_dir.join("db.json");
            if !db_path.exists() {
                config::save_db(&db_path, &Database::default())
                    .expect("failed to write initial db");
            }
            let startup_settings = config::load_db(&db_path)
                .map(|db| db.settings)
                .unwrap_or_default();
            let resource_dir = app.path().resource_dir().ok();

            app.manage(AppState {
                db_access: Mutex::new(()),
                runtime: Mutex::new(runtime::Runtime::default()),
                db_path: db_path.clone(),
                scripts_path: scripts_dir,
                hotkeys_ahk: Mutex::new(ahk::AhkManager::new(resource_dir)),
                #[cfg(target_os = "windows")]
                script_runtime: Mutex::new(scripts::ScriptRuntime::default()),
                #[cfg(target_os = "windows")]
                window_transforms: Mutex::new(HashMap::new()),
            });
            app.manage(firebase::Firebase::new(data_dir).map_err(std::io::Error::other)?);
            firebase::Firebase::start(app.handle().clone());

            // Launch the combined Copilot remap and profile hotkeys script at startup.
            {
                let state = app.state::<AppState>();
                if let Ok(db) = config::load_db(&state.db_path) {
                    if let Err(error) = sync_hotkeys(&state, &db) { eprintln!("[runtime] {error}"); }
                }
            }

            // The tray/taskbar is often not ready yet when the app is auto-launched at
            // Windows login, which makes tray creation fail. Retry instead of letting the
            // error bubble up and exit the app — with open-to-tray the tray is the only UI,
            // so a hard failure here looks exactly like "the app didn't start".
            {
                let mut built = false;
                for attempt in 0..10u32 {
                    match build_tray(app) {
                        Ok(()) => { built = true; break; }
                        Err(e) => {
                            eprintln!("[tray] build attempt {} failed: {e}", attempt + 1);
                            std::thread::sleep(std::time::Duration::from_millis(500));
                        }
                    }
                }
                if !built {
                    eprintln!("[tray] could not create the tray icon; continuing without it");
                }
            }
            // Re-apply the login registration on every launch so the registered path
            // tracks the current executable across updates and moves.
            sync_autostart(app.handle(), startup_settings.launch_on_startup);
            if startup_settings.open_to_tray {
                hide_main_window(app.handle());
            } else {
                show_main_window(app.handle());
                if let Some(window) = main_window(app.handle()) {
                    let _ = window.maximize();
                }
            }

            #[cfg(target_os = "windows")]
            let (overlay_left, overlay_top, overlay_width, overlay_height) = get_virtual_screen_bounds();

            #[cfg(not(target_os = "windows"))]
            let (overlay_left, overlay_top, overlay_width, overlay_height) = (0, 0, 3840, 2160);

            eprintln!(
                "[debug][overlay_window] left={} top={} width={} height={}",
                overlay_left, overlay_top, overlay_width, overlay_height,
            );

            // Non-fatal: a transparent webview window can fail to build in the early login
            // environment; the app (tray + hotkeys) must still start without the overlay.
            match tauri::WebviewWindowBuilder::new(
                app,
                "overlay",
                tauri::WebviewUrl::App("index.html?window=overlay".into()),
            )
            .decorations(false)
            .shadow(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .build()
            {
                Ok(overlay) => {
                    #[cfg(target_os = "windows")]
                    let result = (|| -> Result<(), String> {
                        let _dpi = PhysicalCoordinates::enter()?;
                        let hwnd = overlay.hwnd().map_err(|e| e.to_string())?.0 as winapi::shared::windef::HWND;
                        fit_overlay_to_desktop(hwnd, get_global_viewport()).map(|_| ())
                    })();
                    #[cfg(not(target_os = "windows"))]
                    let result = overlay.set_position(tauri::PhysicalPosition::new(overlay_left, overlay_top))
                        .and_then(|()| overlay.set_size(tauri::PhysicalSize::new(overlay_width as u32, overlay_height as u32)))
                        .map_err(|e| e.to_string());
                    let result = result.and_then(|()| overlay.set_ignore_cursor_events(true).map_err(|e| e.to_string()));
                    if let Err(e) = result {
                        eprintln!("[overlay] failed to configure overlay window: {e}");
                        let _ = overlay.close();
                    }
                }
                Err(e) => eprintln!("[overlay] failed to create overlay window: {e}"),
            }

            // Pre-populate overlay items from the first armed overlay profile; the AHK /focus
            // path swaps to the right one once an app is focused.
            if let Ok(db) = config::load_db(&app.state::<AppState>().db_path) {
                if let Some(game) = db.games.iter().find(|g| g.profiles.iter().any(|p| p.armed && config::profile_has_overlay(&g.profiles, p))) {
                    if let Some(profile) = game.profiles.iter().find(|p| p.armed && config::profile_has_overlay(&game.profiles, p)) {
                        send_overlay(app.handle(), &game.profiles, profile, true);
                    }
                }
            }

            start_overlay_listener(app.handle().clone());
            start_watcher(app.handle().clone());
            #[cfg(target_os = "windows")]
            start_mouse_hook(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_database,
            debug_overlay_log,
            get_overlay_config,
            get_overlay_snapshot,
            dismiss_overlay_item,
            get_overlay_origin,
            toggle_overlay,
            set_overlay_passthrough,
            pick_coordinate,
            kill_game,
            list_open_executables,
            toggle_borderless,
            toggle_stretch,
            toggle_fit,
            write_text_file,
            read_text_file,
            read_image_as_data_url,
            upsert_game,
            delete_game,
            upsert_profile,
            delete_profile,
            set_profile_armed,
            set_profile_part_enabled,
            get_ahk_status,
            save_settings,
            set_library_width,
            firebase::firebase_status,
            firebase::firebase_configure,
            firebase::firebase_export_config,
            firebase::firebase_login,
            firebase::firebase_cancel_login,
            firebase::firebase_logout,
            firebase::firebase_sync,
            get_app_version,
            reveal_main_window,
            download_and_install_update,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                #[cfg(target_os = "windows")]
                restore_window_transforms(&app.state::<AppState>());
            }
        });
}
