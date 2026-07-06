use serde::Serialize;
use std::{collections::HashMap, sync::{Mutex, OnceLock}};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, State};

mod ahk;
mod config;

use config::{Database, Game, Profile, Settings};

const OVERLAY_PORT: u16 = 17823;
const TRAY_SHOW_ID: &str = "tray_show";
const TRAY_HIDE_ID: &str = "tray_hide";
const TRAY_QUIT_ID: &str = "tray_quit";
const GLOBAL_GAME_EXE: &str = "*";

#[cfg(target_os = "windows")]
struct BorderlessWindowState {
    style: i32,
    ex_style: i32,
    placement: winapi::um::winuser::WINDOWPLACEMENT,
}

#[cfg(target_os = "windows")]
#[derive(Clone, Copy)]
struct WindowClientBounds {
    left: i32,
    top: i32,
    width: i32,
    height: i32,
}

pub struct AppState {
    pub db_path: std::path::PathBuf,
    pub scripts_path: std::path::PathBuf,
    pub ahk_manager: Mutex<ahk::AhkManager>,
    /// Persistent AutoHotkey process that remaps the Copilot key to Right Ctrl, always on
    /// while the app runs (independent of profiles).
    pub copilot_ahk: Mutex<ahk::AhkManager>,
    pub overlay_config: Mutex<config::OverlayConfig>,
    #[cfg(target_os = "windows")]
    borderless_windows: Mutex<HashMap<String, BorderlessWindowState>>,
}

#[derive(Debug, Clone, Serialize)]
struct OverlayEventPayload {
    event: String,
    hotkey_trigger: Option<String>,
    state_id: Option<String>,
}

#[cfg(target_os = "windows")]
static DEBUG_LOG_STATE: OnceLock<Mutex<HashMap<&'static str, String>>> = OnceLock::new();

#[cfg(target_os = "windows")]
static MOUSE_HOOK_HANDLE: OnceLock<Mutex<tauri::AppHandle>> = OnceLock::new();

#[cfg(target_os = "windows")]
unsafe extern "system" fn mouse_hook_proc(
    code: i32,
    wparam: usize,
    lparam: isize,
) -> isize {
    use winapi::um::winuser::{CallNextHookEx, WM_RBUTTONDOWN, MSLLHOOKSTRUCT};
    if code >= 0 && wparam as u32 == WM_RBUTTONDOWN {
        let ms = &*(lparam as *const MSLLHOOKSTRUCT);
        let x = ms.pt.x;
        let y = ms.pt.y;
        if let Some(handle_lock) = MOUSE_HOOK_HANDLE.get() {
            if let Ok(handle) = handle_lock.lock() {
                if let Some(overlay) = handle.get_webview_window("overlay") {
                    if overlay.is_visible().unwrap_or(false) {
                        let _ = overlay.emit("overlay-right-click", (x, y));
                    }
                }
            }
        }
    }
    CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
}

#[cfg(target_os = "windows")]
fn start_mouse_hook(handle: tauri::AppHandle) {
    use winapi::um::winuser::{SetWindowsHookExW, WH_MOUSE_LL};
    let _ = MOUSE_HOOK_HANDLE.set(Mutex::new(handle));
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
    config::load_db(&state.db_path)
}

#[tauri::command]
fn debug_overlay_log(message: String) {
    eprintln!("[debug][overlay_frontend] {message}");
}

#[tauri::command]
fn upsert_game(app: tauri::AppHandle, state: State<AppState>, game: Game) -> Result<Database, String> {
    let mut db = config::load_db(&state.db_path)?;
    let game_id = game.id.clone();
    match db.games.iter_mut().find(|g| g.id == game.id) {
        Some(existing) => *existing = game,
        None => db.games.push(game),
    }

    let active_game = db.games.iter().find(|g| g.id == game_id && g.active_profile.is_some());
    if let Some(game) = active_game {
        if let Some(profile_id) = game.active_profile.as_ref() {
            if let Some(profile) = game.profiles.iter().find(|p| &p.id == profile_id) {
                let script = ahk::generate_script(
                    &game.exe,
                    !game.overlay_disabled,
                    game.toggle_hotkeys_key.as_deref(),
                    game.toggle_overlay_key.as_deref(),
                    &game.profiles,
                    profile,
                );
                let script_path = state.scripts_path.join(format!("{game_id}.ahk"));
                if std::fs::write(&script_path, &script).is_ok() {
                    let ahk_exe = db.settings.ahk_exe.clone();
                    let _ = state.ahk_manager.lock().unwrap().launch(&ahk_exe, &script_path);
                }
                if game.overlay_disabled {
                    clear_overlay(&app);
                    set_overlay_visible(&app, false);
                } else {
                    send_overlay(&app, &game.profiles, profile, true);
                }
            }
        }
    }
    config::save_db(&state.db_path, &db)?;
    Ok(db)
}

#[tauri::command]
fn delete_game(state: State<AppState>, id: String) -> Result<Database, String> {
    let mut db = config::load_db(&state.db_path)?;
    db.games.retain(|g| g.id != id);
    config::save_db(&state.db_path, &db)?;
    Ok(db)
}

#[tauri::command]
fn upsert_profile(app: tauri::AppHandle, state: State<AppState>, game_id: String, profile: Profile) -> Result<Database, String> {
    let profile_id = profile.id.clone();
    let mut db = config::load_db(&state.db_path)?;
    let game = db.games.iter_mut().find(|g| g.id == game_id)
        .ok_or_else(|| "Game not found".to_string())?;
    match game.profiles.iter_mut().find(|p| p.id == profile_id) {
        Some(existing) => *existing = profile,
        None => game.profiles.push(profile),
    }
    config::save_db(&state.db_path, &db)?;

    // If this profile is currently active, regenerate and reload the script
    let game = db.games.iter().find(|g| g.id == game_id).unwrap();
    if game.active_profile.as_ref() == Some(&profile_id) {
        if let Some(p) = game.profiles.iter().find(|p| p.id == profile_id) {
            let script = ahk::generate_script(
                &game.exe,
                !game.overlay_disabled,
                game.toggle_hotkeys_key.as_deref(),
                game.toggle_overlay_key.as_deref(),
                &game.profiles,
                p,
            );
            let script_path = state.scripts_path.join(format!("{game_id}.ahk"));
            if std::fs::write(&script_path, &script).is_ok() {
                let _ = state.ahk_manager.lock().unwrap().launch(&db.settings.ahk_exe, &script_path);
            }
            send_overlay(&app, &game.profiles, p, !game.overlay_disabled);
        }
    }

    Ok(db)
}

#[tauri::command]
fn delete_profile(state: State<AppState>, game_id: String, profile_id: String) -> Result<Database, String> {
    let mut db = config::load_db(&state.db_path)?;
    let game = db.games.iter_mut().find(|g| g.id == game_id)
        .ok_or_else(|| "Game not found".to_string())?;
    game.profiles.retain(|p| p.id != profile_id);
    if game.active_profile.as_deref() == Some(&profile_id) {
        game.active_profile = game.profiles.first().map(|p| p.id.clone());
    }
    config::save_db(&state.db_path, &db)?;
    Ok(db)
}

fn build_overlay_config(profiles: &[Profile], profile: &Profile) -> config::OverlayConfig {
    config::OverlayConfig {
        items: config::resolve_profile_overlay_items(profiles, profile)
            .into_iter()
            .cloned()
            .collect(),
        states: config::resolve_profile_states(profiles, profile)
            .into_iter()
            .cloned()
            .collect(),
        hotkeys: config::resolve_profile_hotkeys(profiles, profile)
            .into_iter()
            .map(|hotkey| config::OverlayHotkeyStateBinding {
                trigger: hotkey.trigger.clone(),
                state_id: hotkey.state_id.clone(),
            })
            .collect(),
    }
}

fn send_overlay(app: &tauri::AppHandle, profiles: &[Profile], profile: &Profile, enabled: bool) {
    let overlay_config = if enabled {
        build_overlay_config(profiles, profile)
    } else {
        config::OverlayConfig::default()
    };
    *app.state::<AppState>().overlay_config.lock().unwrap() = overlay_config.clone();
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.emit("overlay-config", &overlay_config);
    }
}

fn clear_overlay(app: &tauri::AppHandle) {
    let overlay_config = config::OverlayConfig::default();
    *app.state::<AppState>().overlay_config.lock().unwrap() = overlay_config.clone();
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.emit("overlay-config", &overlay_config);
    }
}

fn emit_overlay_event(app: &tauri::AppHandle, event: &str, hotkey_trigger: Option<String>, state_id: Option<String>) {
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.emit(
            "overlay-event",
            OverlayEventPayload {
                event: event.to_string(),
                hotkey_trigger,
                state_id,
            },
        );
    }
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
    .title("Hotkey Manager")
    .inner_size(1100.0, 700.0)
    .min_inner_size(800.0, 500.0)
    .visible(true)
    .build()
}

fn restore_main_window(window: &tauri::WebviewWindow) {
    let _ = window.set_skip_taskbar(false);
    let _ = window.show();

    #[cfg(target_os = "windows")]
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            use winapi::um::winuser::{SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOW};

            let hwnd = hwnd.0 as winapi::shared::windef::HWND;
            ShowWindow(hwnd, SW_SHOW);
            ShowWindow(hwnd, SW_RESTORE);
            SetForegroundWindow(hwnd);
        }
    }

    let _ = window.unminimize();
    let _ = window.set_focus();
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
    state.ahk_manager.lock().unwrap().kill();
    state.copilot_ahk.lock().unwrap().kill();
    app.exit(0);
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, TRAY_SHOW_ID, "Show Hotkey Manager", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(app, TRAY_HIDE_ID, "Hide to Tray", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, TRAY_QUIT_ID, "Quit", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show_item, &hide_item, &separator, &quit_item])?;

    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("Hotkey Manager")
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
    state.overlay_config.lock().unwrap().clone()
}

fn is_global_game_exe(exe: &str) -> bool {
    exe.trim() == GLOBAL_GAME_EXE
}

fn active_game<'a>(db: &'a Database) -> Option<&'a Game> {
    db.games.iter().find(|game| game.active_profile.is_some())
}

#[cfg(target_os = "windows")]
fn get_global_overlay_origin() -> (i32, i32, i32, i32) {
    use winapi::um::winuser::GetDesktopWindow;

    let (physical_left, physical_top, physical_width, physical_height) = get_virtual_screen_bounds();
    let scale = get_window_scale_factor(unsafe { GetDesktopWindow() });
    (
        physical_to_logical(physical_left, scale),
        physical_to_logical(physical_top, scale),
        physical_to_logical(physical_width, scale),
        physical_to_logical(physical_height, scale),
    )
}

#[cfg(target_os = "windows")]
fn get_global_viewport() -> WindowClientBounds {
    let (left, top, width, height) = get_virtual_screen_bounds();
    WindowClientBounds { left, top, width, height }
}

#[tauri::command]
fn get_overlay_origin(state: State<AppState>) -> Result<(i32, i32, i32, i32), String> {
    #[cfg(target_os = "windows")]
    {
        let db = config::load_db(&state.db_path)?;
        let Some(game) = active_game(&db) else {
            return Ok((0, 0, 0, 0));
        };
        if is_global_game_exe(&game.exe) {
            return Ok(get_global_overlay_origin());
        }
        let hwnd = find_window_by_exe(&game.exe)
            .ok_or_else(|| format!("Game window not found for '{}'", game.exe))?;
        let scale = get_window_scale_factor(hwnd);
        let bounds = get_game_client_bounds(&game.exe)?;
        let (virtual_left, virtual_top, _, _) = get_virtual_screen_bounds();
        let origin = (
            physical_to_logical(bounds.left - virtual_left, scale),
            physical_to_logical(bounds.top - virtual_top, scale),
            physical_to_logical(bounds.width, scale),
            physical_to_logical(bounds.height, scale),
        );
        debug_log_once(
            "overlay_origin",
            format!(
                "[debug][overlay_origin] exe={} screen_left={} screen_top={} width={} height={} virtual_left={} virtual_top={} scale={:.3}",
                game.exe,
                origin.0,
                origin.1,
                origin.2,
                origin.3,
                virtual_left,
                virtual_top,
                scale,
            ),
        );
        Ok(origin)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = state;
        Ok((0, 0, 0, 0))
    }
}

#[cfg(target_os = "windows")]
fn get_active_game_viewport(handle: &tauri::AppHandle) -> Result<WindowClientBounds, String> {
    let state = handle.state::<AppState>();
    let db = config::load_db(&state.db_path)?;
    let game = active_game(&db)
        .ok_or_else(|| "No active game".to_string())?;
    if is_global_game_exe(&game.exe) {
        return Ok(get_global_viewport());
    }
    let bounds = get_game_client_bounds(&game.exe)?;
    debug_log_once(
        "active_viewport",
        format!(
            "[debug][viewport] exe={} left={} top={} width={} height={}",
            game.exe, bounds.left, bounds.top, bounds.width, bounds.height,
        ),
    );
    Ok(bounds)
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

fn start_overlay_listener(handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::bind(format!("127.0.0.1:{OVERLAY_PORT}")).await {
            Ok(l) => { eprintln!("[overlay] TCP listener bound on port {OVERLAY_PORT}"); l }
            Err(e) => { eprintln!("[overlay] TCP bind FAILED: {e}"); return; }
        };
        loop {
            if let Ok((mut stream, _)) = listener.accept().await {
                use tokio::io::{AsyncReadExt, AsyncWriteExt};
                let handle = handle.clone();
                tauri::async_runtime::spawn(async move {
                    let mut buffer = [0u8; 1024];
                    let read = stream.read(&mut buffer).await.unwrap_or(0);
                    let request = String::from_utf8_lossy(&buffer[..read]);
                    let action = request
                        .lines()
                        .next()
                        .and_then(|line| line.split_whitespace().nth(1))
                        .unwrap_or("/");
                    let route = action.split('?').next().unwrap_or(action);
                    let (status, body) = if route == "/event" {
                        let event = get_query_param(action, "type")
                            .filter(|value| !value.is_empty())
                            .unwrap_or_else(|| "hotkey_triggered".to_string());
                        let hotkey_trigger = get_query_param(action, "hotkey_trigger")
                            .filter(|value| !value.is_empty());
                        let state_id = get_query_param(action, "state_id")
                            .filter(|value| !value.is_empty());
                        emit_overlay_event(&handle, &event, hotkey_trigger, state_id);
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
                                    match get_active_game_viewport(&handle) {
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
                            _ => {
                                if let Some(window) = handle.get_webview_window("overlay") {
                                    let visible = window.is_visible().unwrap_or(false);
                                    set_overlay_visible(&handle, !visible);
                                }
                                ("200 OK", Vec::new())
                            }
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
fn activate_profile(app: tauri::AppHandle, state: State<AppState>, game_id: String, profile_id: String) -> Result<Database, String> {
    let mut db = config::load_db(&state.db_path)?;
    let ahk_exe = db.settings.ahk_exe.clone();

    for game in &mut db.games {
        if game.id != game_id {
            game.active_profile = None;
        }
    }

    let script = {
        let game = db.games.iter_mut().find(|g| g.id == game_id)
            .ok_or_else(|| "Game not found".to_string())?;
        game.active_profile = Some(profile_id.clone());
        let profile = game.profiles.iter().find(|p| p.id == profile_id)
            .ok_or_else(|| "Profile not found".to_string())?;
        ahk::generate_script(
            &game.exe,
            !game.overlay_disabled,
            game.toggle_hotkeys_key.as_deref(),
            game.toggle_overlay_key.as_deref(),
            &game.profiles,
            profile,
        )
    };

    let script_path = state.scripts_path.join(format!("{game_id}.ahk"));
    std::fs::write(&script_path, &script).map_err(|e| e.to_string())?;
    state.ahk_manager.lock().unwrap().launch(&ahk_exe, &script_path)?;
    config::save_db(&state.db_path, &db)?;

    let game = db.games.iter().find(|g| g.id == game_id).unwrap();
    if let Some(profile) = game.profiles.iter().find(|p| p.id == profile_id) {
        send_overlay(&app, &game.profiles, profile, !game.overlay_disabled);
        emit_overlay_event(&app, "profile_activated", None, None);
    }

    Ok(db)
}

#[tauri::command]
fn deactivate_ahk(app: tauri::AppHandle, state: State<AppState>, game_id: String) -> Result<Database, String> {
    state.ahk_manager.lock().unwrap().kill();
    let mut db = config::load_db(&state.db_path)?;
    for game in &mut db.games {
        if game.id == game_id || game.active_profile.is_some() {
            game.active_profile = None;
        }
    }
    config::save_db(&state.db_path, &db)?;
    emit_overlay_event(&app, "profile_deactivated", None, None);
    clear_overlay(&app);
    set_overlay_visible(&app, false);
    Ok(db)
}

#[tauri::command]
fn get_ahk_status(state: State<AppState>) -> bool {
    state.ahk_manager.lock().unwrap().is_running()
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
fn get_window_scale_factor(hwnd: winapi::shared::windef::HWND) -> f64 {
    use winapi::um::winuser::GetDpiForWindow;

    unsafe {
        let dpi = GetDpiForWindow(hwnd);
        if dpi == 0 {
            1.0
        } else {
            dpi as f64 / 96.0
        }
    }
}

#[cfg(target_os = "windows")]
fn physical_to_logical(value: i32, scale: f64) -> i32 {
    ((value as f64) / scale).round() as i32
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
fn make_borderless_fullscreen(state: State<AppState>, exe: String) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let key = exe.to_lowercase();
        let hwnd = find_window_by_exe(&exe)
            .ok_or_else(|| format!("Game window not found for '{exe}'"))?;

        unsafe {
            use winapi::um::winuser::*;

            let mut borderless_windows = state.borderless_windows.lock().unwrap();
            if let Some(saved) = borderless_windows.remove(&key) {
                let mut placement = saved.placement;
                placement.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;

                SetWindowLongW(hwnd, GWL_STYLE, saved.style);
                SetWindowLongW(hwnd, GWL_EXSTYLE, saved.ex_style);

                if SetWindowPlacement(hwnd, &placement) == 0 {
                    return Err("Failed to restore previous window placement".to_string());
                }

                if SetWindowPos(
                    hwnd,
                    std::ptr::null_mut(),
                    0,
                    0,
                    0,
                    0,
                    SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOMOVE | SWP_NOSIZE,
                ) == 0 {
                    return Err("Failed to restore previous window frame".to_string());
                }

                return Ok(false);
            }

            let style = GetWindowLongW(hwnd, GWL_STYLE);
            let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
            let mut placement: WINDOWPLACEMENT = std::mem::zeroed();
            placement.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
            if GetWindowPlacement(hwnd, &mut placement) == 0 {
                return Err("Failed to read current window placement".to_string());
            }

            let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            let mut mi: MONITORINFO = std::mem::zeroed();
            mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
            if GetMonitorInfoW(monitor, &mut mi) == 0 {
                return Err("Failed to read monitor bounds".to_string());
            }

            SetWindowLongW(hwnd, GWL_STYLE, style & !(WS_OVERLAPPEDWINDOW as i32));
            SetWindowLongW(
                hwnd,
                GWL_EXSTYLE,
                ex_style & !((WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE | WS_EX_DLGMODALFRAME | WS_EX_STATICEDGE) as i32),
            );

            let r = mi.rcMonitor;
            if SetWindowPos(
                hwnd, HWND_TOP,
                r.left, r.top, r.right - r.left, r.bottom - r.top,
                SWP_FRAMECHANGED | SWP_NOACTIVATE,
            ) == 0 {
                SetWindowLongW(hwnd, GWL_STYLE, style);
                SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style);
                return Err("Failed to enable borderless fullscreen".to_string());
            }

            borderless_windows.insert(
                key,
                BorderlessWindowState {
                    style,
                    ex_style,
                    placement,
                },
            );
        }
        Ok(true)
    }
    #[cfg(not(target_os = "windows"))]
    Err("Not supported on this platform".to_string())
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

/// Register or unregister the app in the Windows login list (the HKCU `Run` registry
/// key), pointing at the current executable so the entry stays valid across updates and
/// moves. Written directly with `reg` so the stored value is exactly the quoted path we
/// control.
#[cfg(target_os = "windows")]
fn sync_autostart(_app: &tauri::AppHandle, enabled: bool) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    const VALUE_NAME: &str = "Hotkey Manager";

    let mut cmd = std::process::Command::new("reg");
    cmd.creation_flags(CREATE_NO_WINDOW);
    if enabled {
        let exe = match std::env::current_exe() {
            Ok(path) => path,
            Err(_) => return,
        };
        cmd.args([
            "add", RUN_KEY, "/v", VALUE_NAME, "/t", "REG_SZ",
            "/d", &format!("\"{}\"", exe.display()), "/f",
        ]);
    } else {
        cmd.args(["delete", RUN_KEY, "/v", VALUE_NAME, "/f"]);
    }
    let _ = cmd.status();
}

#[cfg(not(target_os = "windows"))]
fn sync_autostart(_app: &tauri::AppHandle, _enabled: bool) {}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, state: State<AppState>, settings: Settings) -> Result<Database, String> {
    let mut db = config::load_db(&state.db_path)?;
    db.settings = settings;
    config::save_db(&state.db_path, &db)?;
    sync_autostart(&app, db.settings.launch_on_startup);
    Ok(db)
}

/// Download the given release installer and launch it, then quit so the installer can
/// replace the running executable. Downloading in the backend avoids the browser's
/// download-redirect handling and any webview CORS restrictions.
#[tauri::command]
async fn download_and_install_update(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("HotkeyManager")
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
    installer_path.push("HotkeyManager-update-setup.exe");
    std::fs::write(&installer_path, &bytes)
        .map_err(|e| format!("Could not save the installer: {e}"))?;

    // Launch the installer as an independent process (it keeps running after we exit),
    // then quit so the running executable is unlocked and can be replaced.
    std::process::Command::new(&installer_path)
        .spawn()
        .map_err(|e| format!("Could not launch the installer: {e}"))?;

    quit_app(&app);
    Ok(())
}

fn is_process_running(exe: &str) -> bool {
    if is_global_game_exe(exe) {
        return true;
    }
    #[cfg(target_os = "windows")]
    {
        use winapi::shared::minwindef::FALSE;
        use winapi::um::handleapi::{CloseHandle, INVALID_HANDLE_VALUE};
        use winapi::um::tlhelp32::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW,
            PROCESSENTRY32W, TH32CS_SNAPPROCESS,
        };
        let exe_lower = exe.to_lowercase();
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap == INVALID_HANDLE_VALUE { return false; }
            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            let mut found = false;
            if Process32FirstW(snap, &mut entry) != FALSE {
                loop {
                    let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                    let name = String::from_utf16_lossy(&entry.szExeFile[..len]).to_lowercase();
                    if name == exe_lower { found = true; break; }
                    if Process32NextW(snap, &mut entry) == FALSE { break; }
                }
            }
            CloseHandle(snap);
            found
        }
    }
    #[cfg(not(target_os = "windows"))]
    false
}

fn start_watcher(handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut last_tick = std::time::SystemTime::now();
        loop {
            std::thread::sleep(std::time::Duration::from_secs(3));

            // A wall-clock jump across a 3s sleep means the machine was suspended.
            // The AHK process survives suspend but Windows may have dropped its
            // keyboard hook, so kill it and let the logic below relaunch it fresh.
            let now = std::time::SystemTime::now();
            let resumed = now
                .duration_since(last_tick)
                .map(|gap| gap > std::time::Duration::from_secs(30))
                .unwrap_or(false);
            last_tick = now;

            let state = handle.state::<AppState>();

            let db = match config::load_db(&state.db_path) {
                Ok(db) => db,
                Err(_) => continue,
            };

            let active = active_game(&db);
            let mut mgr = state.ahk_manager.lock().unwrap();
            if resumed {
                mgr.kill();
            }

            match active {
                None => { mgr.kill(); }
                Some(game) => {
                    let profile_id = game.active_profile.as_ref().unwrap();
                    let game_open   = is_process_running(&game.exe);
                    let script_live = mgr.is_running();

                    if game_open && !script_live {
                        if let Some(profile) = game.profiles.iter().find(|p| p.id == *profile_id) {
                            let script      = ahk::generate_script(
                                &game.exe,
                                !game.overlay_disabled,
                                game.toggle_hotkeys_key.as_deref(),
                                game.toggle_overlay_key.as_deref(),
                                &game.profiles,
                                profile,
                            );
                            let script_path = state.scripts_path.join(format!("{}.ahk", game.id));
                            if std::fs::write(&script_path, &script).is_ok() {
                                let _ = mgr.launch(&db.settings.ahk_exe, &script_path);
                            }
                            send_overlay(&handle, &game.profiles, profile, !game.overlay_disabled);
                            emit_overlay_event(&handle, "profile_activated", None, None);
                        }
                    } else if !game_open && script_live {
                        mgr.kill();
                        emit_overlay_event(&handle, "profile_deactivated", None, None);
                        clear_overlay(&handle);
                        set_overlay_visible(&handle, false);
                    }
                }
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
                        state.ahk_manager.lock().unwrap().kill();
                        state.copilot_ahk.lock().unwrap().kill();
                    }
                }
                _ => {}
            }
        })
        .setup(|app| {
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
                db_path: db_path.clone(),
                scripts_path: scripts_dir,
                ahk_manager: Mutex::new(ahk::AhkManager::new(resource_dir.clone())),
                copilot_ahk: Mutex::new(ahk::AhkManager::new(resource_dir)),
                overlay_config: Mutex::new(config::OverlayConfig::default()),
                #[cfg(target_os = "windows")]
                borderless_windows: Mutex::new(HashMap::new()),
            });

            // Launch the always-on Copilot-key -> Right Ctrl remap as its own AHK process.
            {
                let state = app.state::<AppState>();
                let copilot_path = state.scripts_path.join("copilot-fix.ahk");
                if std::fs::write(&copilot_path, ahk::COPILOT_FIX_SCRIPT).is_ok() {
                    let _ = state
                        .copilot_ahk
                        .lock()
                        .unwrap()
                        .launch(&startup_settings.ahk_exe, &copilot_path);
                }
            }

            build_tray(app)?;
            // Re-apply the login registration on every launch so the registered path
            // tracks the current executable across updates and moves.
            sync_autostart(app.handle(), startup_settings.launch_on_startup);
            if startup_settings.open_to_tray {
                hide_main_window(app.handle());
            } else {
                show_main_window(app.handle());
            }

            #[cfg(target_os = "windows")]
            let (overlay_left, overlay_top, overlay_width, overlay_height) = {
                use winapi::um::winuser::GetDesktopWindow;

                let (physical_left, physical_top, physical_width, physical_height) = get_virtual_screen_bounds();
                let scale = get_window_scale_factor(unsafe { GetDesktopWindow() });
                (
                    physical_to_logical(physical_left, scale),
                    physical_to_logical(physical_top, scale),
                    physical_to_logical(physical_width, scale),
                    physical_to_logical(physical_height, scale),
                )
            };

            #[cfg(not(target_os = "windows"))]
            let (overlay_left, overlay_top, overlay_width, overlay_height) = (0, 0, 3840, 2160);

            eprintln!(
                "[debug][overlay_window] left={} top={} width={} height={}",
                overlay_left, overlay_top, overlay_width, overlay_height,
            );

            let overlay = tauri::WebviewWindowBuilder::new(
                app,
                "overlay",
                tauri::WebviewUrl::App("index.html?window=overlay".into()),
            )
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .inner_size(overlay_width as f64, overlay_height as f64)
            .position(overlay_left as f64, overlay_top as f64)
            .visible(false)
            .build()
            .expect("failed to create overlay window");

            let _ = overlay.set_ignore_cursor_events(true);

            // Pre-populate overlay items from any already-active profile
            if let Ok(db) = config::load_db(&app.state::<AppState>().db_path) {
                if let Some(game) = db.games.iter().find(|g| g.active_profile.is_some()) {
                    if let Some(profile) = game.profiles.iter().find(|p| Some(&p.id) == game.active_profile.as_ref()) {
                        send_overlay(app.handle(), &game.profiles, profile, !game.overlay_disabled);
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
            get_overlay_origin,
            toggle_overlay,
            set_overlay_passthrough,
            pick_coordinate,
            kill_game,
            make_borderless_fullscreen,
            write_text_file,
            read_text_file,
            read_image_as_data_url,
            upsert_game,
            delete_game,
            upsert_profile,
            delete_profile,
            activate_profile,
            deactivate_ahk,
            get_ahk_status,
            save_settings,
            get_app_version,
            download_and_install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
