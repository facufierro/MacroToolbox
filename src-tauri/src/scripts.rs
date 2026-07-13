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

/// Run a script: spawn the Python interpreter on either its `.py` file (source = "path") or
/// on inline code written to a file under `scripts_path` (source = "code"). Fire-and-forget —
/// the child runs independently and this returns as soon as it is spawned.
pub fn run_script(python_exe: &str, script: &Script, scripts_path: &Path) -> Result<(), String> {
    let target = if script.source == "path" {
        let path = script.path.trim();
        if path.is_empty() {
            return Err("Script has no file path set.".to_string());
        }
        std::path::PathBuf::from(path)
    } else {
        let file = scripts_path.join(format!("py-{}.py", script.id));
        std::fs::write(&file, &script.code)
            .map_err(|e| format!("Could not write the script file: {e}"))?;
        file
    };

    let mut last_err = String::new();
    for interpreter in python_candidates(python_exe) {
        let mut command = Command::new(&interpreter);
        command.arg(&target);
        // Don't pop a console window each time a hotkey/launch fires the script.
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        match command.spawn() {
            Ok(_) => return Ok(()),
            Err(e) => last_err = format!("Failed to run '{interpreter}': {e}"),
        }
    }
    Err(format!(
        "Could not start Python. {last_err}. Set the Python executable path in Settings."
    ))
}
