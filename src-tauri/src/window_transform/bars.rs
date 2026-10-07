use super::{monitor_bounds, windows_error, PhysicalCoordinates};
use std::sync::mpsc;
use std::thread::JoinHandle;
use winapi::shared::windef::{HDC, HWND, RECT};
use winapi::um::winuser::*;

#[link(name = "gdi32")]
extern "system" {
    fn PatBlt(hdc: HDC, x: i32, y: i32, width: i32, height: i32, operation: u32) -> i32;
}

unsafe fn paint_black(hdc: HDC, rect: RECT) {
    const BLACKNESS: u32 = 0x0000_0042;
    PatBlt(
        hdc,
        rect.left,
        rect.top,
        rect.right - rect.left,
        rect.bottom - rect.top,
        BLACKNESS,
    );
}

unsafe extern "system" fn black_bar_proc(
    hwnd: HWND,
    message: u32,
    wparam: usize,
    lparam: isize,
) -> isize {
    match message {
        WM_PAINT => {
            let mut paint: PAINTSTRUCT = std::mem::zeroed();
            let hdc = BeginPaint(hwnd, &mut paint);
            paint_black(hdc, paint.rcPaint);
            EndPaint(hwnd, &paint);
            0
        }
        WM_ERASEBKGND | WM_PRINTCLIENT => {
            let mut rect: RECT = std::mem::zeroed();
            GetClientRect(hwnd, &mut rect);
            paint_black(wparam as HDC, rect);
            1
        }
        _ => {
            let original: WNDPROC = std::mem::transmute(GetClassLongPtrW(hwnd, GCLP_WNDPROC));
            CallWindowProcW(original, hwnd, message, wparam, lparam)
        }
    }
}

// Native bars leave rendering and keyboard/mouse input in the target process. Their thread owns
// the HWNDs and pumps messages; Drop stops it and destroys the windows on that same thread.
pub(super) struct BlackBars {
    stop: mpsc::Sender<()>,
    thread: Option<JoinHandle<()>>,
}

impl BlackBars {
    pub(super) fn new(target: isize, process_id: u32, thread_id: u32) -> Result<Self, String> {
        let (ready, initialized) = mpsc::sync_channel(1);
        let (stop, stopped) = mpsc::channel();
        let thread = std::thread::Builder::new()
            .name("window-fit-bars".into())
            .spawn(move || {
                let result = BarWindows::create(target as HWND);
                match result {
                    Ok(windows) => {
                        if ready.send(Ok(())).is_ok() {
                            windows.run(target as HWND, process_id, thread_id, stopped);
                        }
                    }
                    Err(error) => {
                        let _ = ready.send(Err(error));
                    }
                }
            })
            .map_err(|error| format!("Failed to start black bars: {error}"))?;
        match initialized.recv() {
            Ok(Ok(())) => Ok(Self {
                stop,
                thread: Some(thread),
            }),
            Ok(Err(error)) => {
                let _ = thread.join();
                Err(error)
            }
            Err(error) => {
                let _ = thread.join();
                Err(format!("Black bar initialization failed: {error}"))
            }
        }
    }
}

impl Drop for BlackBars {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

struct BarWindows {
    windows: [HWND; 4],
    timer: usize,
}

impl BarWindows {
    fn create(target: HWND) -> Result<Self, String> {
        let _dpi = PhysicalCoordinates::enter()?;
        let mut windows = Self {
            windows: [std::ptr::null_mut(); 4],
            timer: 0,
        };
        let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
        for hwnd in &mut windows.windows {
            *hwnd = unsafe {
                CreateWindowExW(
                    WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                    class.as_ptr(),
                    std::ptr::null(),
                    WS_POPUP | SS_BLACKRECT,
                    0,
                    0,
                    0,
                    0,
                    target,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                )
            };
            if hwnd.is_null() {
                return Err(windows_error("create black bars"));
            }
            // SS_BLACKRECT uses the system window-frame color, which can be gray. Override
            // painting and background erasure so these bars stay RGB(0, 0, 0) in every theme.
            if unsafe { SetWindowLongPtrW(*hwnd, GWLP_WNDPROC, black_bar_proc as usize as isize) }
                == 0
            {
                return Err(windows_error("set solid black bar painting"));
            }
        }
        // A thread timer survives destruction of the target and its owned bar HWNDs, so the
        // message loop can notice the closed target and stop instead of waiting forever.
        windows.timer = unsafe { SetTimer(std::ptr::null_mut(), 0, 100, None) };
        if windows.timer == 0 {
            return Err(windows_error("start black bar visibility tracking"));
        }
        Ok(windows)
    }

    fn run(&self, target: HWND, process_id: u32, thread_id: u32, stopped: mpsc::Receiver<()>) {
        let Ok(_dpi) = PhysicalCoordinates::enter() else {
            return;
        };
        let mut message: MSG = unsafe { std::mem::zeroed() };
        unsafe {
            self.update(target);
        }
        loop {
            if !matches!(stopped.try_recv(), Err(mpsc::TryRecvError::Empty)) {
                break;
            }
            unsafe {
                let mut current_process = 0;
                let current_thread = GetWindowThreadProcessId(target, &mut current_process);
                if current_process != process_id || current_thread != thread_id {
                    break;
                }
                if GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) <= 0 {
                    break;
                }
                if message.message == WM_TIMER {
                    self.update(target);
                }
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
    }

    unsafe fn update(&self, target: HWND) {
        let focused =
            GetAncestor(GetForegroundWindow(), GA_ROOTOWNER) == GetAncestor(target, GA_ROOTOWNER);
        let bounds = monitor_bounds(target);
        let mut outer: RECT = std::mem::zeroed();
        if !focused
            || IsWindowVisible(target) == 0
            || IsIconic(target) != 0
            || GetWindowRect(target, &mut outer) == 0
            || bounds.is_err()
        {
            for &hwnd in &self.windows {
                ShowWindow(hwnd, SW_HIDE);
            }
            return;
        }
        // Leave the entire outer frame available, including custom chrome. Topmost bars cover
        // the taskbar only while this target (or one of its owned dialogs) is foreground.
        let bounds = bounds.unwrap();
        let regions = bar_regions(bounds, outer);
        for (&hwnd, rect) in self.windows.iter().zip(regions) {
            let width = rect.right - rect.left;
            let height = rect.bottom - rect.top;
            if width <= 0 || height <= 0 {
                ShowWindow(hwnd, SW_HIDE);
            } else {
                SetWindowPos(
                    hwnd,
                    HWND_TOPMOST,
                    rect.left,
                    rect.top,
                    width,
                    height,
                    SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_SHOWWINDOW,
                );
            }
        }
    }
}

impl Drop for BarWindows {
    fn drop(&mut self) {
        if self.timer != 0 {
            unsafe {
                KillTimer(std::ptr::null_mut(), self.timer);
            }
        }
        for &hwnd in &self.windows {
            if !hwnd.is_null() && unsafe { IsWindow(hwnd) } != 0 {
                unsafe {
                    DestroyWindow(hwnd);
                }
            }
        }
    }
}

fn bar_regions(monitor: RECT, outer: RECT) -> [RECT; 4] {
    let left = outer.left.clamp(monitor.left, monitor.right);
    let right = outer.right.clamp(left, monitor.right);
    let top = outer.top.clamp(monitor.top, monitor.bottom);
    let bottom = outer.bottom.clamp(top, monitor.bottom);
    [
        RECT {
            right: left,
            ..monitor
        },
        RECT {
            left: right,
            ..monitor
        },
        RECT {
            left,
            right,
            bottom: top,
            ..monitor
        },
        RECT {
            left,
            right,
            top: bottom,
            ..monitor
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bar_painter_uses_pure_black_and_respects_the_paint_rectangle() {
        use winapi::shared::windef::{HBITMAP, HGDIOBJ};

        #[link(name = "gdi32")]
        extern "system" {
            fn CreateCompatibleDC(hdc: HDC) -> HDC;
            fn CreateBitmap(
                width: i32,
                height: i32,
                planes: u32,
                bits: u32,
                data: *const std::ffi::c_void,
            ) -> HBITMAP;
            fn SelectObject(hdc: HDC, object: HGDIOBJ) -> HGDIOBJ;
            fn GetPixel(hdc: HDC, x: i32, y: i32) -> u32;
            fn DeleteObject(object: HGDIOBJ) -> i32;
            fn DeleteDC(hdc: HDC) -> i32;
        }

        unsafe {
            let hdc = CreateCompatibleDC(std::ptr::null_mut());
            assert!(!hdc.is_null());
            let bitmap = CreateBitmap(8, 8, 1, 32, std::ptr::null());
            if bitmap.is_null() {
                DeleteDC(hdc);
                panic!("Failed to create the bar paint test bitmap");
            }
            let previous = SelectObject(hdc, bitmap as HGDIOBJ);
            const WHITENESS: u32 = 0x00ff_0062;
            PatBlt(hdc, 0, 0, 8, 8, WHITENESS);
            paint_black(
                hdc,
                RECT {
                    left: 2,
                    top: 2,
                    right: 6,
                    bottom: 6,
                },
            );
            let painted = GetPixel(hdc, 3, 3);
            let untouched = GetPixel(hdc, 0, 0);
            SelectObject(hdc, previous);
            DeleteObject(bitmap as HGDIOBJ);
            DeleteDC(hdc);

            assert_eq!(painted, 0x000000, "bar pixels must be RGB(0, 0, 0)");
            assert_eq!(
                untouched, 0xffffff,
                "painting must stay inside the requested rectangle"
            );
        }
    }

    #[test]
    fn bars_cover_only_unused_monitor_space() {
        let monitor = RECT {
            left: -1920,
            top: -200,
            right: 0,
            bottom: 880,
        };
        let outer = RECT {
            left: -1688,
            top: -231,
            right: -232,
            bottom: 888,
        };
        let regions = bar_regions(monitor, outer);
        assert_eq!(regions[0].right, outer.left);
        assert_eq!(regions[1].left, outer.right);
        assert_eq!(regions[2].bottom, monitor.top);
        assert_eq!(regions[3].top, monitor.bottom);
        for region in regions {
            assert!(region.left >= monitor.left && region.right <= monitor.right);
            assert!(region.top >= monitor.top && region.bottom <= monitor.bottom);
            assert!(
                region.right <= outer.left
                    || region.left >= outer.right
                    || region.bottom <= outer.top
                    || region.top >= outer.bottom
            );
        }
    }
}
