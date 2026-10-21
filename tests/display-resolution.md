# Display resolution

1. Add a `resolution` step to a hotkey or event, set width to `1280` and height to
   `720`, save, then reopen it. Both dimensions must remain set. Empty, zero,
   fractional, and negative dimensions must disable Save.
2. Trigger the hotkey with the target app on a secondary monitor. Check Windows
   display settings: that monitor must become 1280×720, and the other monitor's
   resolution must remain unchanged. Repeat on a monitor with negative desktop
   coordinates and with different DPI scaling.
3. In a global profile, trigger the behavior while an app on each monitor is
   active. Only the active app's monitor must change.
4. Run `resolution(1280,720);fit` against a windowed app. Fit must use the new
   monitor dimensions. Run a second resolution step using the original supported
   dimensions to restore the display. Resolution sets a mode; it does not toggle.
5. Request an unsupported mode. The display must remain unchanged and the backend
   must report the rejected dimensions. Trigger an already active resolution;
   the display must not switch modes again.

The behavior changes the current display mode without replacing Windows' saved
display configuration. Windows chooses a compatible refresh rate. It does not
automatically restore the prior mode when MacroToolbox exits.

Automated coverage: `display_resolution::tests` exercises mode validation and
failure handling without changing a display; `tests/ahk/behavior.test.ahk` checks
command dimensions, target encoding, and sequence order. Run the existing AHK
test script and, with build authorization, `cargo test --lib display_resolution`
from `src-tauri`.
