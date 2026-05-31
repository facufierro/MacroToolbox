use std::sync::Mutex;
use tauri::{Manager, State};

mod ahk;
mod config;

use config::{Database, Game, Profile, Settings};

pub struct AppState {
    pub db_path: std::path::PathBuf,
    pub scripts_path: std::path::PathBuf,
    pub ahk_manager: Mutex<ahk::AhkManager>,
}

#[tauri::command]
fn get_database(state: State<AppState>) -> Result<Database, String> {
    config::load_db(&state.db_path)
}

#[tauri::command]
fn upsert_game(state: State<AppState>, game: Game) -> Result<Database, String> {
    let mut db = config::load_db(&state.db_path)?;
    match db.games.iter_mut().find(|g| g.id == game.id) {
        Some(existing) => *existing = game,
        None => db.games.push(game),
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
fn upsert_profile(state: State<AppState>, game_id: String, profile: Profile) -> Result<Database, String> {
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
            let script = ahk::generate_script(&game.exe, &game.name, &game.profiles, p);
            let script_path = state.scripts_path.join(format!("{game_id}.ahk"));
            if std::fs::write(&script_path, &script).is_ok() {
                let _ = state.ahk_manager.lock().unwrap().launch(&db.settings.ahk_exe, &script_path);
            }
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

#[tauri::command]
fn activate_profile(state: State<AppState>, game_id: String, profile_id: String) -> Result<Database, String> {
    let mut db = config::load_db(&state.db_path)?;
    let ahk_exe = db.settings.ahk_exe.clone();

    // Scoped so borrows of db.games are dropped before save_db needs &db
    let script = {
        let game = db.games.iter_mut().find(|g| g.id == game_id)
            .ok_or_else(|| "Game not found".to_string())?;
        game.active_profile = Some(profile_id.clone());

        let profile = game.profiles.iter().find(|p| p.id == profile_id)
            .ok_or_else(|| "Profile not found".to_string())?;

        ahk::generate_script(&game.exe, &game.name, &game.profiles, profile)
    };

    let script_path = state.scripts_path.join(format!("{game_id}.ahk"));
    std::fs::write(&script_path, &script).map_err(|e| e.to_string())?;
    state.ahk_manager.lock().unwrap().launch(&ahk_exe, &script_path)?;

    config::save_db(&state.db_path, &db)?;
    Ok(db)
}

#[tauri::command]
fn deactivate_ahk(state: State<AppState>, game_id: String) -> Result<Database, String> {
    state.ahk_manager.lock().unwrap().kill();
    let mut db = config::load_db(&state.db_path)?;
    if let Some(game) = db.games.iter_mut().find(|g| g.id == game_id) {
        game.active_profile = None;
    }
    config::save_db(&state.db_path, &db)?;
    Ok(db)
}

#[tauri::command]
fn get_ahk_status(state: State<AppState>) -> bool {
    state.ahk_manager.lock().unwrap().is_running()
}

#[cfg(target_os = "windows")]
fn find_window_by_exe(exe: &str) -> Option<winapi::shared::windef::HWND> {
    use winapi::shared::minwindef::{BOOL, DWORD, FALSE, LPARAM, TRUE};
    use winapi::shared::windef::HWND;
    use winapi::um::handleapi::CloseHandle;
    use winapi::um::processthreadsapi::OpenProcess;
    use winapi::um::psapi::GetModuleFileNameExW;
    use winapi::um::winnt::{PROCESS_QUERY_INFORMATION, PROCESS_VM_READ};
    use winapi::um::winuser::{EnumWindows, GetWindowThreadProcessId, IsWindowVisible};

    struct FindData { target: String, hwnd: HWND }

    unsafe extern "system" fn enum_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let data = &mut *(lparam as *mut FindData);
        if IsWindowVisible(hwnd) == 0 { return TRUE; }
        let mut pid: DWORD = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        let proc = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid);
        if proc.is_null() { return TRUE; }
        let mut buf = [0u16; 260];
        let len = GetModuleFileNameExW(proc, std::ptr::null_mut(), buf.as_mut_ptr(), buf.len() as u32);
        CloseHandle(proc);
        if len > 0 {
            let path = String::from_utf16_lossy(&buf[..len as usize]);
            let name = path.split('\\').last().unwrap_or("").to_lowercase();
            if name == data.target { data.hwnd = hwnd; return FALSE; }
        }
        TRUE
    }

    let mut data = FindData { target: exe.to_lowercase(), hwnd: std::ptr::null_mut() };
    unsafe { EnumWindows(Some(enum_cb), &mut data as *mut _ as LPARAM); }
    if data.hwnd.is_null() { None } else { Some(data.hwnd) }
}

#[cfg(target_os = "windows")]
fn focus_game_window(exe: &str) {
    if let Some(hwnd) = find_window_by_exe(exe) {
        unsafe { winapi::um::winuser::SetForegroundWindow(hwnd); }
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
fn make_borderless_fullscreen(exe: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = find_window_by_exe(&exe)
            .ok_or_else(|| format!("Game window not found for '{exe}'"))?;
        unsafe {
            use winapi::um::winuser::*;
            let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
            SetWindowLongW(hwnd, GWL_STYLE, (style & !WS_OVERLAPPEDWINDOW) as i32);
            let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            let mut mi: MONITORINFO = std::mem::zeroed();
            mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
            GetMonitorInfoW(monitor, &mut mi);
            let r = mi.rcMonitor;
            SetWindowPos(
                hwnd, HWND_TOP,
                r.left, r.top, r.right - r.left, r.bottom - r.top,
                SWP_FRAMECHANGED | SWP_NOACTIVATE,
            );
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    Err("Not supported on this platform".to_string())
}

#[tauri::command]
async fn pick_coordinate(window: tauri::WebviewWindow, exe: String) -> Result<(i32, i32), String> {
    #[cfg(target_os = "windows")]
    focus_game_window(&exe);

    window.minimize().map_err(|e| e.to_string())?;

    let result = tokio::task::spawn_blocking(|| -> Result<(i32, i32), String> {
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
                    while (GetAsyncKeyState(0x01) as u16) & 0x8000 != 0 {
                        std::thread::sleep(Duration::from_millis(15));
                    }
                    return Ok((pt.x, pt.y));
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
fn save_settings(state: State<AppState>, settings: Settings) -> Result<Database, String> {
    let mut db = config::load_db(&state.db_path)?;
    db.settings = settings;
    config::save_db(&state.db_path, &db)?;
    Ok(db)
}

fn is_process_running(exe: &str) -> bool {
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
        loop {
            std::thread::sleep(std::time::Duration::from_secs(3));
            let state = handle.state::<AppState>();

            let db = match config::load_db(&state.db_path) {
                Ok(db) => db,
                Err(_) => continue,
            };

            let active = db.games.iter().find(|g| g.active_profile.is_some());
            let mut mgr = state.ahk_manager.lock().unwrap();

            match active {
                None => { mgr.kill(); }
                Some(game) => {
                    let profile_id = game.active_profile.as_ref().unwrap();
                    let game_open   = is_process_running(&game.exe);
                    let script_live = mgr.is_running();

                    if game_open && !script_live {
                        if let Some(profile) = game.profiles.iter().find(|p| p.id == *profile_id) {
                            let script      = ahk::generate_script(&game.exe, &game.name, &game.profiles, profile);
                            let script_path = state.scripts_path.join(format!("{}.ahk", game.id));
                            if std::fs::write(&script_path, &script).is_ok() {
                                let _ = mgr.launch(&db.settings.ahk_exe, &script_path);
                            }
                        }
                    } else if !game_open && script_live {
                        mgr.kill();
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
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().state::<AppState>()
                    .ahk_manager.lock().unwrap().kill();
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

            app.manage(AppState {
                db_path,
                scripts_path: scripts_dir,
                ahk_manager: Mutex::new(ahk::AhkManager::new()),
            });

            start_watcher(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_database,
            pick_coordinate,
            kill_game,
            make_borderless_fullscreen,
            read_image_as_data_url,
            upsert_game,
            delete_game,
            upsert_profile,
            delete_profile,
            activate_profile,
            deactivate_ahk,
            get_ahk_status,
            save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
