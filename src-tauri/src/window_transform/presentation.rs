use super::{
    client_bounds, fitted_image_bounds, monitor_bounds, windows_error, PhysicalCoordinates,
};
use std::sync::mpsc;
use std::thread::JoinHandle;
use winapi::shared::windef::{HDC, HWND, RECT};
use winapi::um::winuser::*;

#[repr(C)]
struct Transform {
    matrix: [[f32; 3]; 3],
}

#[link(name = "Magnification")]
extern "system" {
    fn MagInitialize() -> i32;
    fn MagUninitialize() -> i32;
    fn MagSetWindowSource(hwnd: HWND, source: RECT) -> i32;
    fn MagSetWindowTransform(hwnd: HWND, transform: *const Transform) -> i32;
    fn MagSetWindowFilterList(hwnd: HWND, mode: u32, count: i32, windows: *const HWND) -> i32;
    fn MagShowSystemCursor(show: i32) -> i32;
}

#[link(name = "gdi32")]
extern "system" {
    fn PatBlt(hdc: HDC, x: i32, y: i32, width: i32, height: i32, operation: u32) -> i32;
}

#[link(name = "dwmapi")]
extern "system" {
    fn DwmSetWindowAttribute(
        hwnd: HWND,
        attribute: u32,
        value: *const std::ffi::c_void,
        size: u32,
    ) -> i32;
}

unsafe fn remove_backdrop_frame(hwnd: HWND) -> Result<(), String> {
    // A monitor matte must have neither a compositor border nor rounded/transparent corners.
    // The Windows 11 attributes are optional on older Windows; non-client removal is universal.
    const E_INVALIDARG: i32 = 0x80070057_u32 as i32;
    const DWMWA_NCRENDERING_POLICY: u32 = 2;
    const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
    const DWMWA_BORDER_COLOR: u32 = 34;
    const DWMNCRP_DISABLED: u32 = 1;
    const DWMWCP_DONOTROUND: u32 = 1;
    const DWMWA_COLOR_NONE: u32 = 0xfffffffe;
    for (attribute, value) in [
        (DWMWA_NCRENDERING_POLICY, DWMNCRP_DISABLED),
        (DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND),
        (DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE),
    ] {
        let result = DwmSetWindowAttribute(hwnd, attribute, &value as *const u32 as *const _, 4);
        if result < 0 && !(attribute >= DWMWA_WINDOW_CORNER_PREFERENCE && result == E_INVALIDARG) {
            return Err(format!(
                "Failed to remove fitted backdrop frame: 0x{:08X}",
                result as u32
            ));
        }
    }
    Ok(())
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

unsafe extern "system" fn background_proc(
    hwnd: HWND,
    message: u32,
    wparam: usize,
    lparam: isize,
) -> isize {
    match message {
        WM_NCCALCSIZE | WM_NCPAINT => 0,
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

// The presentation thread owns the native scaler, windows and input lease. The game retains
// its render surface and receives native keyboard, raw mouse and normal mouse input.
pub(super) struct FitView {
    stop: mpsc::Sender<()>,
    thread: Option<JoinHandle<()>>,
}

impl FitView {
    pub(super) fn new(target: isize, process_id: u32, thread_id: u32) -> Result<Self, String> {
        let (ready, initialized) = mpsc::sync_channel(1);
        let (stop, stopped) = mpsc::channel();
        let thread = std::thread::Builder::new()
            .name("window-fit-presentation".into())
            .spawn(move || {
                let _dpi = match PhysicalCoordinates::enter() {
                    Ok(dpi) => dpi,
                    Err(error) => {
                        let _ = ready.send(Err(error));
                        return;
                    }
                };
                match Presentation::create(target as HWND) {
                    Ok(mut view) => {
                        if ready.send(Ok(())).is_ok() {
                            if let Err(error) =
                                view.run(target as HWND, process_id, thread_id, stopped)
                            {
                                eprintln!("[window] {error}");
                            }
                        }
                    }
                    Err(error) => {
                        let _ = ready.send(Err(error));
                    }
                }
            })
            .map_err(|error| format!("Failed to start fitted image presentation: {error}"))?;
        match initialized.recv() {
            Ok(Ok(())) => Ok(Self {
                stop,
                thread: Some(thread),
            }),
            result => {
                let _ = thread.join();
                match result {
                    Ok(Err(error)) => Err(error),
                    Err(error) => Err(format!("Fitted image initialization failed: {error}")),
                    _ => unreachable!(),
                }
            }
        }
    }
}

impl Drop for FitView {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[derive(Clone, Copy)]
struct Layout {
    source: RECT,
    monitor: RECT,
    image: RECT,
}

impl Layout {
    unsafe fn for_window(target: HWND) -> Result<Self, String> {
        let source = client_bounds(target)?;
        let monitor = monitor_bounds(target)?;
        let image = fitted_image_bounds(
            monitor,
            (source.right - source.left, source.bottom - source.top),
        )?;
        Ok(Self {
            source,
            monitor,
            image,
        })
    }

    fn transform(self) -> Transform {
        let scale = ((self.image.right - self.image.left) as f32
            / (self.source.right - self.source.left) as f32)
            .min(
                (self.image.bottom - self.image.top) as f32
                    / (self.source.bottom - self.source.top) as f32,
            );
        Transform {
            matrix: [[scale, 0.0, 0.0], [0.0, scale, 0.0], [0.0, 0.0, 1.0]],
        }
    }
}

struct Presentation {
    host: HWND,
    image: HWND,
    timer: usize,
    layout: Layout,
    input: Option<InputLease>,
}

impl Presentation {
    fn create(target: HWND) -> Result<Self, String> {
        unsafe {
            let layout = Layout::for_window(target)?;
            if MagInitialize() == 0 {
                return Err(windows_error("initialize fitted image scaling"));
            }
            let mut view = Self {
                host: std::ptr::null_mut(),
                image: std::ptr::null_mut(),
                timer: 0,
                layout,
                input: None,
            };
            let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
            view.host = CreateWindowExW(
                WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                class.as_ptr(),
                std::ptr::null(),
                WS_POPUP | SS_BLACKRECT | WS_CLIPCHILDREN,
                0,
                0,
                0,
                0,
                target,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            );
            if view.host.is_null() {
                return Err(windows_error("create fitted image backdrop"));
            }
            if SetWindowLongPtrW(
                view.host,
                GWLP_WNDPROC,
                background_proc as *const () as isize,
            ) == 0
            {
                return Err(windows_error("set solid black backdrop painting"));
            }
            remove_backdrop_frame(view.host)?;
            if SetLayeredWindowAttributes(view.host, 0, 255, LWA_ALPHA) == 0 {
                return Err(windows_error("set fitted image opacity"));
            }
            let class: Vec<u16> = "Magnifier\0".encode_utf16().collect();
            const MS_SHOWMAGNIFIEDCURSOR: u32 = 1;
            view.image = CreateWindowExW(
                0,
                class.as_ptr(),
                std::ptr::null(),
                WS_CHILD | WS_VISIBLE | MS_SHOWMAGNIFIEDCURSOR,
                0,
                0,
                0,
                0,
                view.host,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            );
            if view.image.is_null() {
                return Err(windows_error("create fitted image scaler"));
            }
            // Exclude the complete host, including its black background, from the source image.
            const MW_FILTERMODE_EXCLUDE: u32 = 0;
            if MagSetWindowFilterList(view.image, MW_FILTERMODE_EXCLUDE, 1, &view.host) == 0 {
                return Err(windows_error(
                    "exclude presentation from its captured image",
                ));
            }
            view.configure(layout)?;
            // A thread timer also wakes cleanup when the source and its owned HWNDs are destroyed.
            view.timer = SetTimer(std::ptr::null_mut(), 0, 8, None);
            if view.timer == 0 {
                return Err(windows_error("start fitted image tracking"));
            }
            Ok(view)
        }
    }

    unsafe fn configure(&mut self, layout: Layout) -> Result<(), String> {
        if SetWindowPos(
            self.host,
            std::ptr::null_mut(),
            layout.monitor.left,
            layout.monitor.top,
            layout.monitor.right - layout.monitor.left,
            layout.monitor.bottom - layout.monitor.top,
            SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_FRAMECHANGED,
        ) == 0
        {
            return Err(windows_error("position fitted image backdrop"));
        }
        if SetWindowPos(
            self.image,
            std::ptr::null_mut(),
            layout.image.left - layout.monitor.left,
            layout.image.top - layout.monitor.top,
            layout.image.right - layout.image.left,
            layout.image.bottom - layout.image.top,
            SWP_NOACTIVATE | SWP_NOZORDER,
        ) == 0
        {
            return Err(windows_error("position fitted image"));
        }
        if MagSetWindowTransform(self.image, &layout.transform()) == 0
            || MagSetWindowSource(self.image, layout.source) == 0
        {
            return Err(windows_error("scale the game image"));
        }
        InvalidateRect(self.host, std::ptr::null(), 1);
        self.layout = layout;
        Ok(())
    }

    fn run(
        &mut self,
        target: HWND,
        process_id: u32,
        thread_id: u32,
        stopped: mpsc::Receiver<()>,
    ) -> Result<(), String> {
        let mut message: MSG = unsafe { std::mem::zeroed() };
        unsafe {
            self.update(target)?;
        }
        loop {
            if !matches!(stopped.try_recv(), Err(mpsc::TryRecvError::Empty)) {
                return Ok(());
            }
            unsafe {
                let mut current_process = 0;
                let current_thread = GetWindowThreadProcessId(target, &mut current_process);
                if current_process != process_id || current_thread != thread_id {
                    return Ok(());
                }
                if GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) <= 0 {
                    return Ok(());
                }
                if message.message == WM_TIMER {
                    self.update(target)?;
                }
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
    }

    unsafe fn update(&mut self, target: HWND) -> Result<(), String> {
        // Owned dialogs retain their native placement/input. Scaling resumes when the game
        // itself regains focus; a dialog must not be hidden behind the fitted image.
        if GetAncestor(GetForegroundWindow(), GA_ROOT) != target
            || IsWindowVisible(target) == 0
            || IsIconic(target) != 0
        {
            self.input = None;
            ShowWindow(self.host, SW_HIDE);
            return Ok(());
        }
        let layout = Layout::for_window(target)?;
        if !same_rect(layout.monitor, self.layout.monitor)
            || !same_rect(layout.source, self.layout.source)
        {
            self.input = None;
            self.configure(layout)?;
        }
        if self.input.is_none() {
            self.input = Some(InputLease::acquire(layout.source)?);
        } else {
            self.input.as_mut().unwrap().refresh(layout.source)?;
        }
        if IsWindowVisible(self.host) == 0 {
            if SetWindowPos(
                self.host,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
            ) == 0
            {
                return Err(windows_error("show fitted image"));
            }
        }
        if MagSetWindowSource(self.image, layout.source) == 0 {
            return Err(windows_error("refresh fitted image"));
        }
        InvalidateRect(self.image, std::ptr::null(), 0);
        Ok(())
    }
}

impl Drop for Presentation {
    fn drop(&mut self) {
        self.input = None;
        unsafe {
            if self.timer != 0 {
                KillTimer(std::ptr::null_mut(), self.timer);
            }
            if !self.host.is_null() && IsWindow(self.host) != 0 {
                DestroyWindow(self.host);
            }
            MagUninitialize();
        }
    }
}

// Keep the physical cursor in the unscaled client and let Windows draw its scaled counterpart.
// Native clicks therefore arrive at the original game's correct coordinates, including raw-input
// games, without synthesizing mouse buttons or installing another input hook.
struct InputLease {
    previous_clip: RECT,
    owned_clip: Option<RECT>,
}

impl InputLease {
    unsafe fn acquire(source: RECT) -> Result<Self, String> {
        let mut lease = Self {
            previous_clip: std::mem::zeroed(),
            owned_clip: None,
        };
        lease.refresh(source)?;
        Ok(lease)
    }

    unsafe fn refresh(&mut self, source: RECT) -> Result<(), String> {
        let mut current: RECT = std::mem::zeroed();
        if GetClipCursor(&mut current) == 0 {
            return Err(windows_error("read current game mouse bounds"));
        }
        // Games can unlock their cursor when opening a menu. Retain their newer lock when
        // tighter, and remember their latest unscaled bounds when clipping is needed again.
        if !contains(source, current) {
            if ClipCursor(&source) == 0 {
                return Err(windows_error(
                    "keep mouse input in the unscaled game client",
                ));
            }
            // Windows intersects the request with the virtual desktop. Track the applied
            // bounds so cleanup still works when a client crosses a monitor edge.
            let mut applied: RECT = std::mem::zeroed();
            if GetClipCursor(&mut applied) == 0 {
                let error = windows_error("read the applied game mouse bounds");
                ClipCursor(&current);
                return Err(error);
            }
            self.previous_clip = current;
            self.owned_clip = Some(applied);
        }
        if MagShowSystemCursor(0) == 0 {
            return Err(windows_error("refresh the scaled game cursor"));
        }
        Ok(())
    }
}

impl Drop for InputLease {
    fn drop(&mut self) {
        unsafe {
            if let Some(owned) = self.owned_clip {
                let mut current: RECT = std::mem::zeroed();
                if GetClipCursor(&mut current) != 0 && same_rect(current, owned) {
                    ClipCursor(&self.previous_clip);
                }
            }
            MagShowSystemCursor(1);
        }
    }
}

fn same_rect(a: RECT, b: RECT) -> bool {
    (a.left, a.top, a.right, a.bottom) == (b.left, b.top, b.right, b.bottom)
}

fn contains(outer: RECT, inner: RECT) -> bool {
    inner.left >= outer.left
        && inner.top >= outer.top
        && inner.right <= outer.right
        && inner.bottom <= outer.bottom
}

#[cfg(test)]
mod tests {
    use super::*;

    #[link(name = "Magnification")]
    extern "system" {
        fn MagGetWindowSource(hwnd: HWND, source: *mut RECT) -> i32;
        fn MagGetWindowTransform(hwnd: HWND, transform: *mut Transform) -> i32;
    }

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmGetWindowAttribute(
            hwnd: HWND,
            attribute: u32,
            value: *mut std::ffi::c_void,
            size: u32,
        ) -> i32;
    }

    #[test]
    fn backdrop_covers_monitor_edges_without_a_frame_or_rounded_corners() {
        let _dpi = PhysicalCoordinates::enter().unwrap();
        let source = super::super::tests::TestWindow::new();
        let mut view = Presentation::create(source.0).unwrap();
        for monitor in [
            view.layout.monitor,
            RECT {
                left: -1920,
                top: -200,
                right: 0,
                bottom: 880,
            },
            RECT {
                left: 7,
                top: 9,
                right: 1372,
                bottom: 776,
            },
        ] {
            let layout = Layout {
                monitor,
                image: fitted_image_bounds(monitor, (800, 600)).unwrap(),
                source: view.layout.source,
            };
            unsafe {
                view.configure(layout).unwrap();
            }
            assert!(same_rect(
                unsafe { client_bounds(view.host).unwrap() },
                monitor
            ));
            let mut frame_enabled = 1_u32;
            assert_eq!(
                unsafe {
                    DwmGetWindowAttribute(view.host, 1, &mut frame_enabled as *mut u32 as *mut _, 4)
                },
                0
            );
            assert_eq!(frame_enabled, 0);
            let mut corner_preference = 0_u32;
            let result = unsafe {
                DwmGetWindowAttribute(
                    view.host,
                    33,
                    &mut corner_preference as *mut u32 as *mut _,
                    4,
                )
            };
            if result == 0 {
                assert_eq!(corner_preference, 1);
            } else {
                assert_eq!(result, 0x80070057_u32 as i32);
            }
        }
    }

    #[test]
    fn native_scaler_uses_the_original_client_and_fitted_image_bounds() {
        let _dpi = PhysicalCoordinates::enter().unwrap();
        let source = super::super::tests::TestWindow::new();
        let before = unsafe { client_bounds(source.0).unwrap() };
        let view = Presentation::create(source.0).unwrap();
        let mut captured: RECT = unsafe { std::mem::zeroed() };
        let mut transform: Transform = unsafe { std::mem::zeroed() };
        unsafe {
            assert_ne!(MagGetWindowSource(view.image, &mut captured), 0);
            assert_ne!(MagGetWindowTransform(view.image, &mut transform), 0);
        }
        assert!(same_rect(captured, before));
        assert!(same_rect(
            unsafe { client_bounds(source.0).unwrap() },
            before
        ));
        let scale = view.layout.transform().matrix[0][0];
        assert_eq!(transform.matrix[0][0], scale);
        assert_eq!(transform.matrix[1][1], scale);
        let mut image: RECT = unsafe { std::mem::zeroed() };
        unsafe {
            GetClientRect(view.image, &mut image);
        }
        assert_eq!(
            image.right,
            view.layout.image.right - view.layout.image.left
        );
        assert_eq!(
            image.bottom,
            view.layout.image.bottom - view.layout.image.top
        );
        assert!(
            image.right == view.layout.monitor.right - view.layout.monitor.left
                || image.bottom == view.layout.monitor.bottom - view.layout.monitor.top
        );
    }

    #[test]
    fn input_preserves_a_games_existing_tighter_mouse_lock() {
        let client = RECT {
            left: 100,
            top: 100,
            right: 900,
            bottom: 700,
        };
        assert!(contains(client, client));
        assert!(contains(
            client,
            RECT {
                left: 400,
                top: 300,
                right: 401,
                bottom: 301
            }
        ));
        assert!(!contains(
            client,
            RECT {
                left: 0,
                top: 0,
                right: 1920,
                bottom: 1080
            }
        ));
    }

    #[test]
    fn backdrop_pixels_are_pure_black() {
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
                panic!("Failed to create the paint test bitmap");
            }
            let previous = SelectObject(hdc, bitmap as HGDIOBJ);
            PatBlt(hdc, 0, 0, 8, 8, 0x00ff_0062);
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
            paint_black(
                hdc,
                RECT {
                    left: 0,
                    top: 0,
                    right: 8,
                    bottom: 8,
                },
            );
            let edges = [
                (0, 0),
                (7, 0),
                (0, 7),
                (7, 7),
                (3, 0),
                (3, 7),
                (0, 3),
                (7, 3),
            ]
            .map(|(x, y)| GetPixel(hdc, x, y));
            SelectObject(hdc, previous);
            DeleteObject(bitmap as HGDIOBJ);
            DeleteDC(hdc);
            assert_eq!(painted, 0x000000);
            assert_eq!(untouched, 0xffffff);
            assert_eq!(
                edges, [0x000000; 8],
                "every outer edge and corner must be black"
            );
        }
    }
}
