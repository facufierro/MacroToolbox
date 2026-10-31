# Copilot and Windows shortcut checks

When Windows Settings → Bluetooth & devices → Keyboard → Customize Copilot key on
keyboard is set to Right control, Windows owns the remap. MacroToolbox reads that
selection at input-host startup and leaves Copilot, Win, and Shift input untouched.
Restart MacroToolbox after changing that Windows setting. Other selections retain
the existing app remap.

Microsoft documents limitations with extra Win/Shift combinations in its native
Right control mode. See [the native Copilot key behavior](https://support.microsoft.com/en-us/accessibility/windows/copilot/understand-updates-to-the-copilot-key-on-windows-devices).
The following app-remap modifier checks apply to the fallback; verify the game's
native Right Ctrl action separately when using the Windows setting.

The physical check on the target MSI keyboard showed a held native Right Ctrl
(`VK_A3`, extended scan code `01D`) for Copilot+N, followed by its release. The
original Win/Shift/F23 events also reached the fixture window. A second check
which suppressed only F23 key-down removed native Right Ctrl entirely. Filtering
F23 in an application hook therefore cannot be assumed to preserve Windows'
conversion. Neither the Windows setting nor passing the isolated app-remap tests
establishes equivalence to a physical Right Ctrl in every input path.
A third physical check passed F23 through and suppressed only Win/Left Shift
key-down inside the fixture; native Right Ctrl also disappeared in this case.

After restarting the input host with native Right Ctrl enabled and the text-send
release fix loaded, the user confirmed reliable Copilot behavior in the target
game. This confirms the tested game workflow; Microsoft's documented native-mode
combination limitations remain, and the app must continue to defer to Windows.

With the current dev session or a user-built release, verify these with the physical keyboard:

1. Win+R opens Run, both when R follows Win immediately and when Win is held first.
   Win+E and ordinary Shift input should work while a game is focused as well.
2. Copilot+Shift+N behaves as Right Ctrl+Shift+N in an external application, without
   opening Start or adding the Copilot chord's built-in Win modifier.
3. With `rctrl o -> send(ø)` and `rctrl shift o -> send(Ø)` configured, Copilot+O and
   Copilot+Shift+O produce their respective characters.
4. Hold Copilot for several seconds, then release it. Right Ctrl should stay down
   continuously until that release, without repeating or sticking.
5. Hold physical Right Ctrl, Win, or Shift independently while using Copilot. The
   remap should retain those keys until their own releases.
6. In the target game, compare physical Right Ctrl with Copilot for the same
   shortcut. Press the second key immediately after Copilot as well as after a
   several-second hold. Repeat with Shift, then release in either order. Both
   timings should produce the Ctrl action without Start, an extra Shift, or a
   plain-key action. Repeat the browser shortcuts after the game checks.
7. Record a hotkey trigger by pressing and releasing Copilot alone. It should save
   `rctrl`, without `Unidentified`, Win, or a phantom Shift. Record Copilot+O and
   Copilot+Shift+O as well; the independently pressed Shift must remain in the latter.
8. In the game's key-binding control, press Copilot alone. The first keypress
   should be Right Ctrl, without an unassigned key or a Left Ctrl tap. Verify that
   Start stays closed, including after the Copilot prefix is delayed under load.

The isolated input-owner tests run with
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-ahk-behavior.ps1 -Engine copilot`.
They exercise the production state transitions, including delayed F23 recognition,
physical presses and quick taps arriving between modifier transitions, and
restoration of the caller's key timing, with an in-memory input sink. They do not
install keyboard hooks or inject input. They also validate the production hotkey
declarations without running them.

A separate native-output fixture invokes the production remap and verifies the
extended Right Ctrl scan code and absence of unrelated key presses. Its temporary
observer consumes the generated events before applications receive them; it never
activates a window or sends input to the game. The physical checks above cover the
Windows shell and the target keyboard's compound Copilot sequence.

Native-mode tests verify detection of the Windows choice and that app startup or
exit cleanup cannot release Windows-owned Right Ctrl or other native modifiers.

The behavior suite also observes Type text and Secure send while an external
Right Ctrl is held, then with its release arriving during output. The temporary
hook consumes the dummy text before applications receive it. Both actions must
send the same Unicode packets without releasing or reasserting Ctrl. Text packets
retain the bundled AutoHotkey send-level marker so their Unicode scan codes cannot
activate profile hotkeys.

The runtime suite injects an unhandled timer error while a macro owns keys and a
mouse movement lock. It checks that hotkeys and polling stop, every run is cancelled,
owned input is released, independent physical modifiers remain held, and the failed
thread unwinds without a modal error dialog. Cleanup continues if one run's unlock
fails. These checks use an input sink and do not run the game's saved macros.

`node --experimental-strip-types --test tests/key-recorder.test.mjs` runs the actual
React recorder in an isolated browser. It covers the menu-mask event and modifier
handoff, standalone modifiers, real Shift combinations, mouse shortcuts, recording
cancellation, and behavior key recording without installing hooks or injecting input.
