# Window transform checks

After building, use a windowed target with a different aspect ratio from its monitor
(for example, an 800×600 client on a 1920×1080 monitor).

1. Toggle `fit`: the client should become 1440×1080, centered, with black side bars.
   Check that bar pixels are solid `#000000` with light and dark Windows themes.
   Combine it with `borderless` to remove the frame. The original aspect ratio must
   be retained regardless of which of those two behaviors runs first.
2. Switch `fit` → `stretch` → `fit`, then toggle `fit` off: stretch should fill the
   monitor, fit should recover the original aspect ratio, and toggling off should
   restore the original placement. Repeat with borderless enabled; sizing changes
   must retain borderless until it is toggled off separately.
3. Alt-Tab, minimize, restore, and open an owned dialog: bars should hide when the
   target loses focus or is minimized, return on focus, and leave the target frame
   and dialog usable. Toggling from a dialog must still affect the saved target.
4. Repeat on a secondary monitor, including negative desktop coordinates and a
   different Windows DPI scale. Try a portrait monitor for top/bottom bars.
5. Quit MacroToolbox with fit enabled: the bars should disappear and the original
   window should return. Close and reopen the target instead: the next toggle must
   capture the new window without trying to restore the closed one.
6. Verify normal mouse input, configured percentage-based `goto` actions, and the
   MacroToolbox overlay against the fitted client area.

These behaviors resize the native window. They do not scale a fixed render surface
or change the display mode. Check actual rendered content in the target game;
successful native client resizing alone cannot prove that the game scales its
content. Exclusive fullscreen, protected apps, and higher-integrity processes may
reject window changes. A rejected change should restore the preceding transform
state and return an error through the command API.

Automated coverage lives in `window_transform.rs` and `window_transform/bars.rs`
(geometry and mode transitions), and `tests/ahk/behavior.test.ahk` (behavior routing).
Run the Rust tests with `cargo test --manifest-path src-tauri/Cargo.toml --lib` and
the interpreter tests with `powershell -NoProfile -File scripts/test-ahk-behavior.ps1`.
