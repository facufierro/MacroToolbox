# Extra modifiers on hotkeys

Each hotkey has an **Allow extra modifiers** checkbox. New hotkeys start unchecked.
Older unmodified bindings keep their existing checked behavior; older explicit
modifier chords keep their existing matching.

- Unchecked `1 -> press(2)`: only 1 runs the behavior. Ctrl+1, Shift+1, Alt+1 and
  Win+1 do not activate it.
- Checked `1 -> press(2)`: 1 sends 2; Ctrl+1 sends Ctrl+2; Shift+1 sends Shift+2.
- An explicit `ctrl 1` trigger still requires Ctrl. Checking the box allows extra
  held modifiers, such as Shift; those extra modifiers pass through to the output.
  The declared trigger modifiers keep their existing consumption rules.
- An unchecked `ralt 1` accepts AltGr's synthesized Left Ctrl while rejecting
  extra held Shift, Win, Left Alt or Right Ctrl.

After the user builds/restarts the app, check these cases for press, hold, repeat
and compound hold behaviors. Save/reopen, duplicate, copy, export/import and
inherit a binding to confirm the checkbox choice is retained. Keep separate
Ctrl+1 and plain-1 bindings to check that the explicit chord wins when it matches.
Repeat the physical checks in [copilot-remap.md](copilot-remap.md).

Without an app build:

```powershell
node --experimental-strip-types --test tests/hotkey-modifiers.test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-ahk-behavior.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-ahk-behavior.ps1 -Engine copilot
```

Rust configuration and generated-binding regression tests are in `config.rs` and
`ahk.rs`; running them requires build authorization.
