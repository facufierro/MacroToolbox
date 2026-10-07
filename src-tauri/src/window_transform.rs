use winapi::shared::windef::{
    DPI_AWARENESS_CONTEXT, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, HWND, POINT, RECT,
};
use winapi::um::winuser::*;

mod bars;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Sizing {
    Original,
    Stretch,
    Fit,
}

#[derive(Clone, Copy)]
pub enum WindowTransform {
    Borderless,
    Stretch,
    Fit,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Mode {
    borderless: bool,
    sizing: Sizing,
}

impl Mode {
    fn toggled(self, transform: WindowTransform) -> Self {
        match transform {
            WindowTransform::Borderless => Self {
                borderless: !self.borderless,
                ..self
            },
            WindowTransform::Stretch | WindowTransform::Fit => {
                let sizing = match transform {
                    WindowTransform::Stretch => Sizing::Stretch,
                    _ => Sizing::Fit,
                };
                Self {
                    sizing: if self.sizing == sizing {
                        Sizing::Original
                    } else {
                        sizing
                    },
                    ..self
                }
            }
        }
    }

    fn enabled(self, transform: WindowTransform) -> bool {
        match transform {
            WindowTransform::Borderless => self.borderless,
            WindowTransform::Stretch => self.sizing == Sizing::Stretch,
            WindowTransform::Fit => self.sizing == Sizing::Fit,
        }
    }
}

pub struct WindowTransformState {
    hwnd: isize,
    process_id: u32,
    thread_id: u32,
    style: i32,
    ex_style: i32,
    placement: WINDOWPLACEMENT,
    original_client: (i32, i32),
    mode: Mode,
    bars: Option<bars::BlackBars>,
}

impl WindowTransformState {
    pub fn capture(hwnd: HWND) -> Result<Self, String> {
        let _dpi = PhysicalCoordinates::enter()?;
        unsafe {
            let mut placement: WINDOWPLACEMENT = std::mem::zeroed();
            placement.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
            if GetWindowPlacement(hwnd, &mut placement) == 0 {
                return Err(windows_error("read current window placement"));
            }
            let mut client: RECT = std::mem::zeroed();
            if GetClientRect(hwnd, &mut client) == 0 {
                return Err(windows_error("read original client resolution"));
            }
            let original_client = (client.right - client.left, client.bottom - client.top);
            if original_client.0 <= 0 || original_client.1 <= 0 || IsIconic(hwnd) != 0 {
                return Err("Restore the target window before changing its size".into());
            }
            let mut process_id = 0;
            let thread_id = GetWindowThreadProcessId(hwnd, &mut process_id);
            Ok(Self {
                hwnd: hwnd as isize,
                process_id,
                thread_id,
                style: GetWindowLongW(hwnd, GWL_STYLE),
                ex_style: GetWindowLongW(hwnd, GWL_EXSTYLE),
                placement,
                original_client,
                mode: Mode {
                    borderless: false,
                    sizing: Sizing::Original,
                },
                bars: None,
            })
        }
    }

    // A saved HWND may be recycled after its process exits. Never restore another app's window.
    pub fn is_current(&self) -> bool {
        unsafe {
            let mut process_id = 0;
            let thread_id = GetWindowThreadProcessId(self.hwnd as HWND, &mut process_id);
            thread_id != 0 && thread_id == self.thread_id && process_id == self.process_id
        }
    }

    pub fn is_active(&self) -> bool {
        self.mode.borderless || self.mode.sizing != Sizing::Original
    }

    pub fn toggle(&mut self, transform: WindowTransform) -> Result<bool, String> {
        let _dpi = PhysicalCoordinates::enter()?;
        if !self.is_current() {
            return Err("The target window has closed".into());
        }
        let previous = self.mode;
        self.mode = self.mode.toggled(transform);
        if let Err(error) = self.apply() {
            self.mode = previous;
            return match self.apply() {
                Ok(()) => Err(error),
                Err(restore_error) => Err(format!(
                    "{error}; restoring the previous state also failed: {restore_error}"
                )),
            };
        }
        Ok(self.mode.enabled(transform))
    }

    pub fn restore(&mut self) -> Result<(), String> {
        self.bars = None;
        if !self.is_current() {
            return Ok(());
        }
        let _dpi = PhysicalCoordinates::enter()?;
        self.mode = Mode {
            borderless: false,
            sizing: Sizing::Original,
        };
        self.apply()
    }

    fn apply(&mut self) -> Result<(), String> {
        unsafe {
            let hwnd = self.hwnd as HWND;
            let style = if self.mode.borderless {
                self.style & !(WS_OVERLAPPEDWINDOW as i32)
            } else {
                self.style
            };
            let ex_style = if self.mode.borderless {
                self.ex_style
                    & !((WS_EX_WINDOWEDGE
                        | WS_EX_CLIENTEDGE
                        | WS_EX_DLGMODALFRAME
                        | WS_EX_STATICEDGE) as i32)
            } else {
                self.ex_style
            };
            // Visibility and minimize/maximize flags are live state, not frame configuration.
            let live_flags = (WS_VISIBLE | WS_MINIMIZE | WS_MAXIMIZE) as i32;
            let style = (style & !live_flags) | (GetWindowLongW(hwnd, GWL_STYLE) & live_flags);
            set_window_style(hwnd, GWL_STYLE, style)?;
            set_window_style(hwnd, GWL_EXSTYLE, ex_style)?;

            if self.mode.sizing == Sizing::Original {
                self.bars = None;
                let mut placement = self.placement;
                placement.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
                if SetWindowPlacement(hwnd, &placement) == 0 {
                    return Err(windows_error("restore previous window placement"));
                }
                if SetWindowPos(
                    hwnd,
                    std::ptr::null_mut(),
                    0,
                    0,
                    0,
                    0,
                    SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOMOVE | SWP_NOSIZE,
                ) == 0
                {
                    return Err(windows_error("update the window frame"));
                }
                return Ok(());
            }

            let monitor = monitor_bounds(hwnd)?;
            let client = match self.mode.sizing {
                Sizing::Fit => fit_bounds(monitor, self.original_client)?,
                _ => monitor,
            };
            if IsZoomed(hwnd) != 0 || IsIconic(hwnd) != 0 {
                let mut placement: WINDOWPLACEMENT = std::mem::zeroed();
                placement.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
                if GetWindowPlacement(hwnd, &mut placement) == 0 {
                    return Err(windows_error("read window placement"));
                }
                placement.showCmd = SW_SHOWNOACTIVATE as u32;
                if SetWindowPlacement(hwnd, &placement) == 0 {
                    return Err(windows_error("restore the window for resizing"));
                }
            }
            let mut outer = client;
            if AdjustWindowRectExForDpi(
                &mut outer,
                style as u32,
                (!GetMenu(hwnd).is_null()) as i32,
                ex_style as u32,
                GetDpiForWindow(hwnd),
            ) == 0
            {
                return Err(windows_error("calculate the window frame"));
            }
            resize_client(hwnd, client, outer)?;
            if self.mode.sizing == Sizing::Fit {
                if self.bars.is_none() {
                    self.bars = Some(bars::BlackBars::new(
                        self.hwnd,
                        self.process_id,
                        self.thread_id,
                    )?);
                }
            } else {
                self.bars = None;
            }
            Ok(())
        }
    }
}

pub(super) struct PhysicalCoordinates(DPI_AWARENESS_CONTEXT);

impl PhysicalCoordinates {
    pub(super) fn enter() -> Result<Self, String> {
        let previous =
            unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
        if previous.is_null() {
            Err(windows_error("set physical monitor coordinates"))
        } else {
            Ok(Self(previous))
        }
    }
}

impl Drop for PhysicalCoordinates {
    fn drop(&mut self) {
        unsafe {
            SetThreadDpiAwarenessContext(self.0);
        }
    }
}

fn windows_error(action: &str) -> String {
    format!("Failed to {action}: {}", std::io::Error::last_os_error())
}

unsafe fn set_window_style(hwnd: HWND, index: i32, value: i32) -> Result<(), String> {
    // Zero is also a successful previous style, so clear and inspect the last error.
    #[link(name = "kernel32")]
    extern "system" {
        fn SetLastError(error: u32);
    }
    SetLastError(0);
    if SetWindowLongW(hwnd, index, value) == 0
        && std::io::Error::last_os_error().raw_os_error() != Some(0)
    {
        return Err(windows_error(
            "change the window frame (check the target app's permissions)",
        ));
    }
    Ok(())
}

fn monitor_bounds(hwnd: HWND) -> Result<RECT, String> {
    unsafe {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(monitor, &mut info) == 0 {
            return Err(windows_error("read monitor bounds"));
        }
        Ok(info.rcMonitor)
    }
}

fn fit_bounds(monitor: RECT, (width, height): (i32, i32)) -> Result<RECT, String> {
    let available_width = monitor.right - monitor.left;
    let available_height = monitor.bottom - monitor.top;
    if width <= 0 || height <= 0 || available_width <= 0 || available_height <= 0 {
        return Err("Cannot fit an empty window or monitor".into());
    }
    // Integer products avoid floating point drift and keep the fitted client inside the monitor.
    let (fitted_width, fitted_height) = if i64::from(width) * i64::from(available_height)
        > i64::from(height) * i64::from(available_width)
    {
        (
            available_width,
            (i64::from(available_width) * i64::from(height) / i64::from(width)) as i32,
        )
    } else {
        (
            (i64::from(available_height) * i64::from(width) / i64::from(height)) as i32,
            available_height,
        )
    };
    if fitted_width == 0 || fitted_height == 0 {
        return Err("The fitted window would have an empty client area".into());
    }
    let left = monitor.left + (available_width - fitted_width) / 2;
    let top = monitor.top + (available_height - fitted_height) / 2;
    Ok(RECT {
        left,
        top,
        right: left + fitted_width,
        bottom: top + fitted_height,
    })
}

unsafe fn client_bounds(hwnd: HWND) -> Result<RECT, String> {
    let mut rect: RECT = std::mem::zeroed();
    let mut origin = POINT { x: 0, y: 0 };
    if GetClientRect(hwnd, &mut rect) == 0 || ClientToScreen(hwnd, &mut origin) == 0 {
        return Err(windows_error("verify the resized client area"));
    }
    Ok(RECT {
        left: origin.x,
        top: origin.y,
        right: origin.x + rect.right,
        bottom: origin.y + rect.bottom,
    })
}

unsafe fn resize_client(hwnd: HWND, requested: RECT, mut outer: RECT) -> Result<(), String> {
    for attempt in 0..2 {
        if SetWindowPos(
            hwnd,
            std::ptr::null_mut(),
            outer.left,
            outer.top,
            outer.right - outer.left,
            outer.bottom - outer.top,
            SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOSENDCHANGING,
        ) == 0
        {
            return Err(windows_error("resize the target window"));
        }
        let actual = client_bounds(hwnd)?;
        if actual.left == requested.left
            && actual.top == requested.top
            && actual.right == requested.right
            && actual.bottom == requested.bottom
        {
            return Ok(());
        }
        if attempt == 0 {
            // Custom chrome, scrollbars, wrapped menus and legacy DPI virtualization can differ
            // from AdjustWindowRectExForDpi. Correct from actual screen-space client insets once.
            let mut frame: RECT = std::mem::zeroed();
            if GetWindowRect(hwnd, &mut frame) == 0 {
                return Err(windows_error("read the resized window frame"));
            }
            outer = RECT {
                left: requested.left - (actual.left - frame.left),
                top: requested.top - (actual.top - frame.top),
                right: requested.right + (frame.right - actual.right),
                bottom: requested.bottom + (frame.bottom - actual.bottom),
            };
        } else {
            return Err(format!("The target app refused the requested client bounds ({}x{}, got {}x{}). Use windowed mode and check whether the app supports resizing.",
                requested.right - requested.left, requested.bottom - requested.top,
                actual.right - actual.left, actual.bottom - actual.top));
        }
    }
    unreachable!()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(left: i32, top: i32, width: i32, height: i32) -> RECT {
        RECT {
            left,
            top,
            right: left + width,
            bottom: top + height,
        }
    }

    fn coordinates(rect: RECT) -> (i32, i32, i32, i32) {
        (rect.left, rect.top, rect.right, rect.bottom)
    }

    #[test]
    fn fit_preserves_aspect_ratio_for_wide_tall_and_equal_monitors() {
        for (monitor, source, expected) in [
            (rect(0, 0, 1920, 1080), (800, 600), rect(240, 0, 1440, 1080)),
            (
                rect(0, 0, 1280, 1024),
                (1920, 1080),
                rect(0, 152, 1280, 720),
            ),
            (
                rect(0, 0, 1080, 1920),
                (1920, 1080),
                rect(0, 656, 1080, 607),
            ),
            (rect(0, 0, 1920, 1080), (1280, 720), rect(0, 0, 1920, 1080)),
            (
                rect(-1920, -200, 1920, 1080),
                (800, 600),
                rect(-1680, -200, 1440, 1080),
            ),
        ] {
            assert_eq!(
                coordinates(fit_bounds(monitor, source).unwrap()),
                coordinates(expected)
            );
        }
    }

    #[test]
    fn fit_handles_downscaling_odd_pixels_and_large_resolutions() {
        let fitted = fit_bounds(rect(7, 9, 1365, 767), (7680, 4320)).unwrap();
        assert_eq!(coordinates(fitted), coordinates(rect(8, 9, 1363, 767)));
        assert!(fit_bounds(rect(0, 0, 100000, 100000), (100000, 50000)).is_ok());
    }

    #[test]
    fn fit_rejects_empty_bounds() {
        assert!(fit_bounds(rect(0, 0, 1920, 1080), (0, 600)).is_err());
        assert!(fit_bounds(rect(0, 0, 0, 1080), (800, 600)).is_err());
        assert!(fit_bounds(rect(0, 0, 1, 1), (1, 10000)).is_err());
    }

    #[test]
    fn sizing_modes_replace_each_other_and_toggle_back_to_original() {
        let original = Mode {
            borderless: false,
            sizing: Sizing::Original,
        };
        let fit = original.toggled(WindowTransform::Fit);
        assert_eq!(fit.sizing, Sizing::Fit);
        assert_eq!(fit.toggled(WindowTransform::Fit), original);
        let stretch = fit.toggled(WindowTransform::Stretch);
        assert_eq!(stretch.sizing, Sizing::Stretch);
        assert_eq!(stretch.toggled(WindowTransform::Stretch), original);
        assert_eq!(stretch.toggled(WindowTransform::Fit), fit);
    }

    #[test]
    fn borderless_stays_independent_of_sizing() {
        let original = Mode {
            borderless: false,
            sizing: Sizing::Original,
        };
        let borderless = original.toggled(WindowTransform::Borderless);
        let fit = borderless.toggled(WindowTransform::Fit);
        assert_eq!(fit.toggled(WindowTransform::Fit), borderless);
        assert_eq!(
            fit.toggled(WindowTransform::Borderless),
            original.toggled(WindowTransform::Fit)
        );
        assert_eq!(
            fit.toggled(WindowTransform::Stretch)
                .toggled(WindowTransform::Stretch),
            borderless
        );
    }
}
