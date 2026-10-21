use winapi::shared::windef::HWND;
use winapi::um::wingdi::{DEVMODEW, DM_PELSHEIGHT, DM_PELSWIDTH};
use winapi::um::winuser::{
    ChangeDisplaySettingsExW, EnumDisplaySettingsW, GetMonitorInfoW, IsWindow, MonitorFromWindow,
    CDS_TEST, DISP_CHANGE_BADMODE, DISP_CHANGE_RESTART, DISP_CHANGE_SUCCESSFUL,
    ENUM_CURRENT_SETTINGS, MONITORINFO, MONITORINFOEXW, MONITOR_DEFAULTTONEAREST,
};

pub fn set_resolution(hwnd: HWND, width: u32, height: u32) -> Result<(), String> {
    unsafe {
        if IsWindow(hwnd) == 0 {
            return Err("The target window has closed".into());
        }
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut info: MONITORINFOEXW = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
        if GetMonitorInfoW(monitor, &mut info as *mut _ as *mut MONITORINFO) == 0 {
            return Err(format!(
                "Cannot read the target monitor: {}",
                std::io::Error::last_os_error()
            ));
        }
        let mut mode: DEVMODEW = std::mem::zeroed();
        mode.dmSize = std::mem::size_of::<DEVMODEW>() as u16;
        if EnumDisplaySettingsW(info.szDevice.as_ptr(), ENUM_CURRENT_SETTINGS, &mut mode) == 0 {
            return Err("Cannot read the target monitor's display mode".into());
        }
        apply_resolution(&mut mode, width, height, |mode, flags| {
            // Use the selected device, never the primary-display default. A dynamic change
            // leaves Windows' saved display configuration intact.
            ChangeDisplaySettingsExW(
                info.szDevice.as_ptr(),
                mode,
                std::ptr::null_mut(),
                flags,
                std::ptr::null_mut(),
            )
        })
    }
}

fn apply_resolution(
    mode: &mut DEVMODEW,
    width: u32,
    height: u32,
    mut change: impl FnMut(&mut DEVMODEW, u32) -> i32,
) -> Result<(), String> {
    if width == 0 || height == 0 {
        return Err("Resolution width and height must be positive".into());
    }
    if (mode.dmPelsWidth, mode.dmPelsHeight) == (width, height) {
        return Ok(());
    }
    mode.dmPelsWidth = width;
    mode.dmPelsHeight = height;
    // Only request pixel dimensions; let the driver choose a compatible refresh rate.
    mode.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT;
    for flags in [CDS_TEST, 0] {
        match change(mode, flags) {
            DISP_CHANGE_SUCCESSFUL => (),
            DISP_CHANGE_BADMODE => {
                return Err(format!("The monitor does not support {width}×{height}"))
            }
            DISP_CHANGE_RESTART => return Err("The display mode requires a restart".into()),
            code => {
                return Err(format!(
                    "Cannot set display resolution to {width}×{height} (code {code})"
                ))
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use winapi::um::wingdi::{DM_DISPLAYFREQUENCY, DM_POSITION};
    use winapi::um::winuser::DISP_CHANGE_FAILED;

    fn current_mode() -> DEVMODEW {
        let mut mode: DEVMODEW = unsafe { std::mem::zeroed() };
        mode.dmSize = std::mem::size_of::<DEVMODEW>() as u16;
        mode.dmPelsWidth = 1920;
        mode.dmPelsHeight = 1080;
        mode.dmDisplayFrequency = 144;
        mode.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY | DM_POSITION;
        mode
    }

    #[test]
    fn resolution_is_tested_before_applying_without_persisting_other_settings() {
        let mut mode = current_mode();
        let mut calls = Vec::new();
        apply_resolution(&mut mode, 1280, 720, |requested, flags| {
            assert_eq!((requested.dmPelsWidth, requested.dmPelsHeight), (1280, 720));
            assert_eq!(requested.dmFields, DM_PELSWIDTH | DM_PELSHEIGHT);
            assert_eq!(requested.dmSize as usize, std::mem::size_of::<DEVMODEW>());
            calls.push(flags);
            DISP_CHANGE_SUCCESSFUL
        })
        .unwrap();
        assert_eq!(calls, [CDS_TEST, 0]);
    }

    #[test]
    fn unsupported_resolution_never_changes_the_display() {
        let mut calls = Vec::new();
        let error = apply_resolution(&mut current_mode(), 1234, 567, |_, flags| {
            calls.push(flags);
            DISP_CHANGE_BADMODE
        })
        .unwrap_err();
        assert!(error.contains("1234×567"));
        assert_eq!(calls, [CDS_TEST]);
    }

    #[test]
    fn apply_failure_is_reported_after_a_successful_test() {
        let mut calls = Vec::new();
        let error = apply_resolution(&mut current_mode(), 1280, 720, |_, flags| {
            calls.push(flags);
            if flags == CDS_TEST {
                DISP_CHANGE_SUCCESSFUL
            } else {
                DISP_CHANGE_FAILED
            }
        })
        .unwrap_err();
        assert!(error.contains("code -1"));
        assert_eq!(calls, [CDS_TEST, 0]);
    }

    #[test]
    fn empty_dimensions_cannot_detach_a_monitor() {
        for (width, height) in [(0, 720), (1280, 0), (0, 0)] {
            assert!(
                apply_resolution(&mut current_mode(), width, height, |_, _| {
                    panic!("invalid resolution reached the display driver")
                })
                .is_err()
            );
        }
    }

    #[test]
    fn setting_the_current_resolution_is_a_noop() {
        apply_resolution(&mut current_mode(), 1920, 1080, |_, _| {
            panic!("unchanged resolution reached the display driver")
        })
        .unwrap();
    }
}
