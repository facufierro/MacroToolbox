# Triggered behavior chains

After building and restarting, bind Q to:

```text
press(x);waitfor(LButton);press(y)
```

Press and release Q: X should run once, and Y should wait for the next left click.
The click should still reach the target app. If the button was already held when
the wait began, release it and click again. Other keys or buttons must not advance
the chain. Use the existing recorder on a **waitfor** step to select its trigger.

Add multiple waitfor steps, including keyboard triggers and modifier combinations.
Check that switching away from the profile's target app or disabling its profile
while waiting cancels the remaining actions. A Global profile may continue across
apps. Other hotkeys must remain usable while a chain is waiting.

Repeat the Copilot checks in [copilot-remap.md](copilot-remap.md), including a
Right Ctrl modifier on the wait trigger. Waiting chains preserve the existing
keyboard and mouse hooks; the waiting input is observed without sending it again.

Without an app build:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-ahk-behavior.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-ahk-behavior.ps1 -Engine copilot
```

The waiting-chain generation test is in `ahk.rs`. Running Rust tests requires
build authorization.
