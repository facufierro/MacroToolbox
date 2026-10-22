# Mousepress

`mousepress(LButton)` uses AutoHotkey v2's built-in `ControlClick` to send a complete
mouse down/up pair to the profile's target window at the current cursor position.
Global profiles target the active window. The editor offers left, right, middle,
Mouse 4 and Mouse 5.

Saved `pressalt(...)` steps remain supported and appear as `mousepress` in the
editor. Saving them uses the new name.

When the button is already held, the target receives an up event, a 30 ms release
gap, and a fresh down/up click. The window ends with the button released, even if the
physical button remains held, so a following `restorecursor` does not start a drag.
An explicit `hold(...)` behavior retains ownership of its own held output.

No extra DLL, driver, program, or code injection into the game is used. This is
still a simulated click, delivered as window messages rather than normal global
mouse input. Games that read only raw input may ignore it.
Ordinary `press(...)` keeps its existing behavior.

Run the isolated checks without a build or live global input. They include actual
ControlClick message delivery to a hidden fixture window:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-ahk-behavior.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-ahk-behavior.ps1 -Engine copilot
```

After the user-built app is restarted:

1. Open an existing `pressalt` behavior and verify it displays as `mousepress`.
   Save and reopen it to confirm the selected button persists.
2. In a window-message viewer, trigger it with the cursor over the target client area.
   Check one down/up pair at the cursor position for each supported button.
3. Repeat on a monitor with negative screen coordinates, and after a `goto` step.
4. Check a global profile targets the active app, and a named profile targets its app.
5. Verify the cursor, focus, physical button state and Copilot remap remain unchanged.
6. In HB Evolution, hold the mouse button and press D with its goto, click and
   restorecursor sequence. Check that it picks once, restores the cursor and does
   not drag the clicked window. Also release the physical button during the tap
   and confirm it does not remain pressed.

Reference: [AutoHotkey ControlClick documentation](https://www.autohotkey.com/docs/v2/lib/ControlClick.htm).
