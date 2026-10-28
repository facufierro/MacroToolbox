use std::path::Path;
use std::process::Command;

use crate::config::Script;

/// Interpreters to try, in order, when running a script. A configured path (from Settings)
/// wins; otherwise fall back to `python` and then the Windows `py` launcher.
fn python_candidates(configured: &str) -> Vec<String> {
    let configured = configured.trim();
    if !configured.is_empty() {
        return vec![configured.to_string()];
    }
    vec!["python".to_string(), "py".to_string()]
}

/// Run a Python or AutoHotkey script from a file (source = "path") or from inline code written
/// under `scripts_path` (source = "code"). Returns the spawned child so the caller can track it
/// and terminate it when the app quits or the owning profile is disarmed.
pub fn run_script(
    python_exe: &str,
    ahk_exe: &str,
    script: &Script,
    scripts_path: &Path,
    scope: &crate::runtime::ExecutionScope,
) -> Result<std::process::Child, String> {
    let api_path = scripts_path.join("api");
    std::fs::create_dir_all(&api_path).map_err(|e| e.to_string())?;
    std::fs::write(api_path.join("macrotoolbox.py"), include_str!("script_api.py")).map_err(|e| e.to_string())?;
    let ahk_api = format!("{}\n{}", include_str!("script_api.ahk"), include_str!("json.ahk").replace("JsonReader", "MacroToolboxJsonReader"));
    std::fs::write(api_path.join("MacroToolbox.ahk"), ahk_api).map_err(|e| e.to_string())?;
    let (extension, interpreters, interpreter_name, setting_name) = match script.language.as_str() {
        "python" => (
            "py",
            python_candidates(python_exe),
            "Python",
            "Python executable path",
        ),
        "autohotkey" => (
            "ahk",
            vec![ahk_exe.to_string()],
            "AutoHotkey",
            "AutoHotkey executable path",
        ),
        language => return Err(format!("Unsupported script language '{language}'.")),
    };

    let target = if script.source == "path" {
        let path = script.path.trim();
        if path.is_empty() {
            return Err("Script has no file path set.".to_string());
        }
        std::path::PathBuf::from(path)
    } else {
        let file = scripts_path.join(format!("{extension}-{}.{extension}", script.id));
        std::fs::write(&file, &script.code)
            .map_err(|e| format!("Could not write the script file: {e}"))?;
        file
    };

    let mut last_err = String::new();
    for interpreter in interpreters {
        let mut command = Command::new(&interpreter);
        if script.language == "autohotkey" { command.arg("/include").arg(api_path.join("MacroToolbox.ahk")); }
        command.arg(&target);
        command.env("MACROTOOLBOX_PROFILE_ID", &scope.profile).env("MACROTOOLBOX_SECTION", scope.section()).env("MACROTOOLBOX_SCRIPT_OWNER", &scope.script_owner)
            .env("MACROTOOLBOX_API_URL", "http://127.0.0.1:17823").env("MACROTOOLBOX_API_DIR", &api_path);
        let mut python_paths = vec![api_path.clone()];
        if let Some(existing) = std::env::var_os("PYTHONPATH") { python_paths.extend(std::env::split_paths(&existing)); }
        command.env("PYTHONPATH", std::env::join_paths(python_paths).map_err(|e| e.to_string())?);
        // Run from the script's own folder so relative paths in the script resolve next to it
        // (a path script → its file's directory; inline code → the scripts data folder).
        if let Some(dir) = target.parent() {
            command.current_dir(dir);
        }
        // Don't pop a console window each time a hotkey/launch fires the script.
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        match command.spawn() {
            Ok(child) => return Ok(child),
            Err(e) => last_err = format!("Failed to run '{interpreter}': {e}"),
        }
    }
    Err(format!(
        "Could not start {interpreter_name}. {last_err}. Set the {setting_name} in Settings."
    ))
}

#[cfg(target_os = "windows")]
struct ScriptProcess { scope: crate::runtime::ExecutionScope, script: String, target: String, definition: String, job: JobObject }

/// A Windows Job Object configured to kill every process in it when the job handle closes. The
/// app holds the only handle, so if the app dies (quit, crash, or `taskkill`) the OS closes the
/// handle and terminates all the job's script processes and their descendants.
#[cfg(target_os = "windows")]
struct JobObject(winapi::um::winnt::HANDLE);

#[cfg(target_os = "windows")]
unsafe impl Send for JobObject {}

#[cfg(target_os = "windows")]
impl JobObject {
    fn new() -> Result<Self, String> {
        use winapi::um::jobapi2::{CreateJobObjectW, SetInformationJobObject};
        use winapi::um::winnt::{JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE};
        unsafe {
            let job = JobObject(CreateJobObjectW(std::ptr::null_mut(), std::ptr::null()));
            if job.0.is_null() { return Err(format!("Could not create script ownership: {}", std::io::Error::last_os_error())); }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(job.0, JobObjectExtendedLimitInformation, &mut info as *mut _ as *mut _, std::mem::size_of_val(&info) as u32) == 0 {
                return Err(format!("Could not configure script ownership: {}", std::io::Error::last_os_error()));
            }
            Ok(job)
        }
    }

    fn assign(&self, process: std::os::windows::io::RawHandle) -> Result<(), String> {
        if unsafe { winapi::um::jobapi2::AssignProcessToJobObject(self.0, process as winapi::um::winnt::HANDLE) } == 0 {
            return Err(format!("Could not track the script process: {}", std::io::Error::last_os_error()));
        }
        Ok(())
    }

    fn has_processes(&self) -> bool {
        use winapi::um::winnt::{JobObjectBasicAccountingInformation, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION};
        unsafe {
            let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = std::mem::zeroed();
            let result = winapi::um::jobapi2::QueryInformationJobObject(self.0, JobObjectBasicAccountingInformation,
                &mut info as *mut _ as *mut _, std::mem::size_of_val(&info) as u32, std::ptr::null_mut());
            result == 0 || info.ActiveProcesses != 0
        }
    }


}

#[cfg(target_os = "windows")]
impl Drop for JobObject {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                winapi::um::handleapi::CloseHandle(self.0);
            }
        }
    }
}


#[cfg(target_os = "windows")]
#[derive(Default)]
pub struct ScriptRuntime { jobs: std::collections::HashMap<usize, ScriptProcess> }

#[cfg(target_os = "windows")]
impl ScriptRuntime {
    pub fn launch(&mut self, settings: &crate::config::Settings, ahk_exe: &str, script: &Script, root: &Path, scope: &crate::runtime::ExecutionScope, target: &str) -> Result<(), String> {
        use std::os::windows::io::AsRawHandle;
        let job = JobObject::new()?;
        let mut child = run_script(&settings.python_exe, ahk_exe, script, root, scope)?;
        if let Err(error) = job.assign(child.as_raw_handle()) { let _ = child.kill(); let _ = child.wait(); return Err(error); }
        self.jobs.insert(job.0 as usize, ScriptProcess { scope: scope.clone(), script: script.id.clone(), target: target.trim().into(), definition: serde_json::to_string(script).map_err(|e| e.to_string())?, job });
        Ok(())
    }
    pub fn stop_profile(&mut self, profile: &str) {
        self.jobs.retain(|_, process| process.scope.script_owner != profile && process.scope.profile != profile);
    }
    pub fn reconcile(&mut self, db: &crate::config::Database) {
        self.jobs.retain(|_, process| {
            let script_enabled = db.games.iter().filter(|game| game.exe.trim().eq_ignore_ascii_case(&process.target)).flat_map(|game| &game.profiles).filter(|profile| profile.id == process.scope.script_owner).any(|profile| profile.scripts.iter().any(|script| script.id == process.script && script.enabled && serde_json::to_string(script).ok().as_deref() == Some(process.definition.as_str())));
            process.scope.is_active(db) && script_enabled
        });
    }
    pub fn reap(&mut self) { self.jobs.retain(|_, process| process.job.has_processes()); }
    pub fn clear(&mut self) { self.jobs.clear(); }
}
