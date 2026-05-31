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
    let mut db = config::load_db(&state.db_path)?;
    let game = db.games.iter_mut().find(|g| g.id == game_id)
        .ok_or_else(|| "Game not found".to_string())?;
    match game.profiles.iter_mut().find(|p| p.id == profile.id) {
        Some(existing) => *existing = profile,
        None => game.profiles.push(profile),
    }
    config::save_db(&state.db_path, &db)?;
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

        ahk::generate_script(&game.exe, &game.name, profile)
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
    std::process::Command::new("tasklist")
        .args(["/FI", &format!("IMAGENAME eq {exe}"), "/NH", "/FO", "CSV"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout)
            .to_lowercase()
            .contains(&exe.to_lowercase()))
        .unwrap_or(false)
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
                            let script      = ahk::generate_script(&game.exe, &game.name, profile);
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
