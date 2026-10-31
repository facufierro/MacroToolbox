use std::ffi::OsString;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use winapi::um::handleapi::{CloseHandle, INVALID_HANDLE_VALUE};
use winapi::um::processthreadsapi::OpenProcess;
use winapi::um::synchapi::WaitForSingleObject;
use winapi::um::winnt::{HANDLE, PROCESS_QUERY_LIMITED_INFORMATION, SYNCHRONIZE};
use winapi::um::winuser::{FindWindowW, GetWindowThreadProcessId, PostThreadMessageW, WM_QUIT};

struct Process(HANDLE);

impl Process {
    fn open(pid: u32) -> Result<Option<Self>, String> {
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, 0, pid) };
        if handle.is_null() {
            let error = std::io::Error::last_os_error();
            // A process may finish between discovering its window/child entry
            // and opening it. There is nothing left to retire in that case.
            if error.raw_os_error() == Some(87) { return Ok(None); }
            return Err(error.to_string());
        }
        Ok(Some(Self(handle)))
    }

    fn wait(&self) -> Result<(), String> {
        match unsafe { WaitForSingleObject(self.0, 5000) } {
            0 => Ok(()),
            258 => Err("The previous MacroToolbox instance did not finish closing.".into()),
            _ => Err(std::io::Error::last_os_error().to_string()),
        }
    }

    fn executable(&self) -> Result<PathBuf, String> {
        let mut buffer = vec![0u16; 32768];
        let mut length = buffer.len() as u32;
        if unsafe { winapi::um::winbase::QueryFullProcessImageNameW(self.0, 0, buffer.as_mut_ptr(), &mut length) } == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(OsString::from_wide(&buffer[..length as usize]).into())
    }
}

impl Drop for Process {
    fn drop(&mut self) { unsafe { CloseHandle(self.0); } }
}

#[derive(Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Build {
    version: [u16; 4],
    modified: SystemTime,
}

fn wide(value: &std::ffi::OsStr) -> Vec<u16> {
    value.encode_wide().chain(Some(0)).collect()
}

fn executable_build(path: &Path) -> Result<Build, String> {
    use winapi::um::winver::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};

    // Fixed layout of the Windows VS_FIXEDFILEINFO resource.
    #[repr(C)]
    struct VersionInfo {
        signature: u32,
        structure_version: u32,
        file_version: [u32; 2],
        product_version: [u32; 2],
        flags_and_target: [u32; 7],
    }

    let filename = wide(path.as_os_str());
    let mut unused = 0;
    let size = unsafe { GetFileVersionInfoSizeW(filename.as_ptr(), &mut unused) };
    if size == 0 { return Err(format!("Could not read the app version: {}", path.display())); }
    let mut buffer = vec![0u32; (size as usize + 3) / 4];
    let mut value = std::ptr::null_mut();
    let mut length = 0;
    let root = [b'\\' as u16, 0];
    unsafe {
        if GetFileVersionInfoW(filename.as_ptr(), 0, size, buffer.as_mut_ptr().cast()) == 0
            || VerQueryValueW(buffer.as_ptr().cast(), root.as_ptr(), &mut value, &mut length) == 0
            || length < std::mem::size_of::<VersionInfo>() as u32 || value.is_null() {
            return Err(format!("Could not read the app version: {}", path.display()));
        }
        let info = &*value.cast::<VersionInfo>();
        if info.signature != 0xFEEF04BD { return Err("Invalid app version resource.".into()); }
        let [major_minor, patch_build] = info.product_version;
        Ok(Build {
            version: [(major_minor >> 16) as u16, major_minor as u16, (patch_build >> 16) as u16, patch_build as u16],
            modified: std::fs::metadata(path).and_then(|metadata| metadata.modified()).map_err(|error| error.to_string())?,
        })
    }
}

fn close_legacy_input_hosts(parent: u32) -> Result<(), String> {
    use winapi::um::tlhelp32::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};

    // Older app versions do not clean up the input host when their event loop exits.
    // Close only their own AutoHotkey children first so OnExit can release held input.
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE { return Err(std::io::Error::last_os_error().to_string()); }
    let snapshot = Process(snapshot);
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut present = unsafe { Process32FirstW(snapshot.0, &mut entry) } != 0;
    while present {
        let end = entry.szExeFile.iter().position(|&character| character == 0).unwrap_or(entry.szExeFile.len());
        let name = String::from_utf16_lossy(&entry.szExeFile[..end]);
        if entry.th32ParentProcessID == parent && name.to_ascii_lowercase().starts_with("autohotkey") {
            if let Some(process) = Process::open(entry.th32ProcessID)? {
                if !crate::ahk::request_graceful_exit(entry.th32ProcessID) {
                    // It may also have exited after the handle was opened.
                    if unsafe { WaitForSingleObject(process.0, 0) } != 0 {
                        return Err("Could not close the previous app's input host.".into());
                    }
                }
                process.wait()?;
            }
        }
        present = unsafe { Process32NextW(snapshot.0, &mut entry) } != 0;
    }
    Ok(())
}

fn request_exit(thread: u32) -> Result<(), String> {
    if unsafe { PostThreadMessageW(thread, WM_QUIT, 0, 0) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

/// Run before Tauri's single-instance plugin, which otherwise discards the new
/// executable and shows the old one without ever reaching settings migration.
pub fn retire_older_instance(identifier: &str) -> Result<(), String> {
    let class = wide(std::ffi::OsStr::new(&format!("{identifier}-sic")));
    let title = wide(std::ffi::OsStr::new(&format!("{identifier}-siw")));
    let window = unsafe { FindWindowW(class.as_ptr(), title.as_ptr()) };
    if window.is_null() { return Ok(()); }
    let mut pid = 0;
    let thread = unsafe { GetWindowThreadProcessId(window, &mut pid) };
    let Some(running) = Process::open(pid)? else { return Ok(()) };
    let current_path = std::env::current_exe().map_err(|error| error.to_string())?;
    let running_path = running.executable()?;
    if current_path == running_path || executable_build(&current_path)? <= executable_build(&running_path)? {
        return Ok(());
    }

    close_legacy_input_hosts(pid)?;
    // WM_QUIT exits the UI event loop even when Close to tray is enabled. Waiting
    // for the process also keeps migrations and input ownership out of overlap.
    request_exit(thread)?;
    running.wait()
}

pub fn show_error(error: &str) {
    let message = wide(std::ffi::OsStr::new(error));
    let title = wide(std::ffi::OsStr::new("MacroToolbox"));
    unsafe { winapi::um::winuser::MessageBoxW(std::ptr::null_mut(), message.as_ptr(), title.as_ptr(), winapi::um::winuser::MB_OK | winapi::um::winuser::MB_ICONERROR); }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, UNIX_EPOCH};

    fn build(version: [u16; 4], seconds: u64) -> Build {
        Build { version, modified: UNIX_EPOCH + Duration::from_secs(seconds) }
    }

    #[test]
    fn newer_releases_take_precedence_over_file_timestamps() {
        assert!(build([6, 3, 1, 0], 1) > build([6, 2, 0, 0], 100));
        assert!(build([6, 2, 0, 0], 100) < build([6, 3, 1, 0], 1));
    }

    #[test]
    fn newer_local_builds_take_over_without_changing_the_release_version() {
        assert!(build([6, 2, 0, 0], 2) > build([6, 2, 0, 0], 1));
        assert_eq!(build([6, 2, 0, 0], 2), build([6, 2, 0, 0], 2));
    }

    #[test]
    fn missing_executable_versions_are_reported() {
        assert!(executable_build(Path::new("missing-macrotoolbox-test.exe")).is_err());
    }

    #[test]
    fn takeover_exits_the_previous_ui_message_loop() {
        use winapi::um::processthreadsapi::GetCurrentThreadId;
        use winapi::um::winuser::{GetMessageW, PeekMessageW, MSG, PM_NOREMOVE};

        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let (closed_tx, closed_rx) = std::sync::mpsc::channel();
        let fixture = std::thread::spawn(move || {
            let mut message: MSG = unsafe { std::mem::zeroed() };
            unsafe { PeekMessageW(&mut message, std::ptr::null_mut(), 0, 0, PM_NOREMOVE); }
            ready_tx.send(unsafe { GetCurrentThreadId() }).unwrap();
            assert_eq!(unsafe { GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) }, 0);
            closed_tx.send(()).unwrap();
        });
        request_exit(ready_rx.recv_timeout(Duration::from_secs(5)).unwrap()).unwrap();
        closed_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        fixture.join().unwrap();
    }

    #[test]
    fn an_invalid_ui_thread_fails_without_forcing_a_process_to_exit() {
        assert!(request_exit(u32::MAX).is_err());
    }
}
