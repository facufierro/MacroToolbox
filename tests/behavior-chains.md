# Triggered behavior chains

**Wait for** has no settings or independent input value.
Place one before Mouse press with **On release**: the physical mouse button's release
must unblock the rest of the list without sending an extra click. Repeat with
double click, a nested sequence, and Restart overlay. The next action retains all
of its settings; reordering changes which action the wait owns. In a parallel
list, the wait and its next action form one branch while other branches progress.
A wait at the end of its own list must prevent saving. Focus loss or disabling
the profile must cancel both the wait and its pending action.

Existing saved input waits automatically convert to Wait for followed by a matching input action:

After building and restarting, bind Q to:

```text
press(x);waitfor(LButton);press(y)
```

Press and release Q: X should run once, and Y should wait for the next left click.
The click should still reach the target app. If the button was already held when
the wait began, release it and click again. Other keys or buttons must not advance
the chain. Use the recorder on the following input action to select its trigger.

Add multiple waitfor steps, including keyboard triggers and modifier combinations.
For Spellbook, put Wait for before a left Mouse press, then another Wait for
before a left Mouse press with On release. The first click must finish only the
first wait; the following actions must wait until a second click is released.
Check that switching away from the profile's target app or disabling its profile
while waiting cancels the remaining actions. A Global profile may continue across
apps. Other hotkeys must remain usable while a chain is waiting.

For a timer that appears after casting, set the timer's visibility to **Only while
running** and leave **Start with overlay** unchecked. Bind E to `press(e)`, then
`waitfor(LButton)`, then an overlay action with **Restart** and that timer selected.
The next left click must show a full countdown, and expiry must hide it. Repeat
the cast while the timer is running: **Restart** must begin a fresh countdown.
**Start** deliberately preserves an already-running countdown.

Repeat the Copilot checks in [copilot-remap.md](copilot-remap.md), including a
Right Ctrl modifier on the wait trigger. Waiting chains preserve the existing
keyboard and mouse hooks; the waiting input is observed without sending it again.
Quick down/up pairs are latched from physical input events rather than sampled
held states. The tests feed real RAWINPUT packet layouts through the interpreter
and verify Windows device registration in the short-lived test process, without
sending global keyboard or mouse input.

Without an app build:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-ahk-behavior.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-ahk-behavior.ps1 -Engine copilot
```

The waiting-chain generation test is in `ahk.rs`. Running Rust tests requires
build authorization.

Native input references: [RegisterRawInputDevices](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerrawinputdevices),
[GetRawInputData](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getrawinputdata).
