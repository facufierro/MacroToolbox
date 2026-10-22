# Copilot and Windows shortcut checks

After rebuilding and restarting MacroToolbox, verify these with the physical keyboard:

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

The isolated input-owner tests run with
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-ahk-behavior.ps1 -Engine copilot`.
They exercise the production state transitions with an in-memory input sink and do
not install keyboard hooks or inject input. They also validate the production
hotkey declarations without running them. The physical checks above cover the
Windows shell and the target keyboard's compound Copilot sequence.
