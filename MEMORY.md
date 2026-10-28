# MacroToolbox — project memory

Tauri v2 app (React/TS frontend, Rust backend) that manages app-targeted folders of hotkey/overlay/script profiles and runs them through one always-on AutoHotkey v2 process.

## Structure
- [src/App.tsx](src/App.tsx) — main UI: profiles, hotkey binding recorder (records the typed character for letters/digits, `e.code` position as fallback; AltGr's synthetic LCtrl is dropped so it records as plain ralt), settings. Key semantics are character-based end to end: triggers resolve via the active layout in `layout_scancode` (ahk.rs), sends via `GetKeySC` in `PhysKey`, both with US-position fallback for layouts missing the character. Update check: on mount, every 30 min, and on the backend's `main-window-shown` event (WebView2 doesn't fire visibilitychange on native show/hide).
- [src/OverlayApp.tsx](src/OverlayApp.tsx) — in-game overlay window UI.
- Overlay positioning is owned by one OverlayPresentation value: focus changes clear its bounds until a refresh for that focus generation completes. Origin requests explicitly name the folder, run without overlap, and cannot apply results from an earlier focus generation. Minimized/empty native clients return no origin, keeping parts hidden without resetting timers.
- Overlay part labels are derived by nameOverlayParts from the effective overlay name and part order, with separate zero-based counters per overlay/type (for example, Reputation Timer 0). The legacy saved name field is not editable or authoritative. Resolved rows and folder-wide action/visibility choices use the same labels; overlay renames, moves, duplicates, and inherited overrides regenerate them without changing IDs.
- [src-tauri/src/ahk.rs](src-tauri/src/ahk.rs) — serializes profile bindings to runtime.json, launches one persistent AutoHotkey input host, and owns key normalization/Copilot input primitives. `behavior_runtime.ahk` executes action trees; `runtime_host.ahk` updates dynamic bindings without restarting the hook.
- [src-tauri/src/config.rs](src-tauri/src/config.rs) — profile/config model and inheritance. Schema v5 moves state definitions to folders and keeps a v4 backup; profile state lists are an import compatibility carrier.
- [src-tauri/src/scripts.rs](src-tauri/src/scripts.rs) — user script launching.
- [src-tauri/src/lib.rs](src-tauri/src/lib.rs) — Tauri setup, commands, localhost backend (port 17823) the AHK script calls for overlay sync/events.

## Features
- Folder-owned app targets gate armed profiles with `WinActive("ahk_exe …")`; the permanent Global folder owns the `*` (Any app) target.
- Hotkey behaviors: press/hold (true remap)/repeat (hold-to-repeat)/goto/sleep/send/state/borderless/stretch/killprocess; trigger modifiers are excluded only during behavior output so they cannot leak into remapped keys and remain held for subsequent hotkeys; toggle keys per profile.
- Key names resolve through the active keyboard layout, with a US-position fallback for characters missing from that layout.
- The Copilot key → Right Ctrl remap and profile hotkeys share one persistent AHK process, so keyboard-hook recovery and synthesized modifier state have a single owner.
- Copilot's modifier handoff stays critical and keeps its prefix InputHook active until Right Ctrl has been sent. Its sends disable per-key delays locally and restore the caller's timing and send level, so a fast physical shortcut or tap cannot reach the app between the modifier transitions.
- Copilot's independent Win/Shift ownership is captured at the candidate Win-down. Do not infer it again from the passed-prefix phase or shiftHeld when F23 arrives: a prefix timeout can have forwarded the same Copilot chord's modifiers already, and they still need neutralizing.
- BindingHost owns consumed trigger presses separately from behavior lifetimes. Its wildcard guards suppress activating-key repeats and key-up until release, including after modifiers change or a behavior finishes; hook reinstallation clears consumption from the old hook generation.
- BindingHost supplies BehaviorExecutor's physical-output ownership predicate. A consumed trigger (matched by scan code as well as name) cannot retain a synthetic output after its action releases it; unrelated physical holds, other output owners, and Copilot-held Right Ctrl are preserved. The same predicate applies to failed acquisition and release cleanup.
- Keyboard-hook health check + reinstall on wake so hotkeys survive sleep/tray idling.
- Overlay combines parts from the focused app's armed profiles (200ms poll → backend show/hide/focus).
- Update check (launch + every 30min + on window becoming visible + manual "Check for Updates" button in Settings, GitHub latest release): in-app banner + Windows toast via tauri-plugin-notification (`checkUpdate` in App.tsx).
- Releases: `scripts/package-release.ps1` + `.github/workflows/release.yml`; both require `changelog/v<version>.md` (see AGENTS.md rules). Installer is NSIS perMachine (app runs elevated + autostarts).

## Verification
- User runs the Build action button; agents run tests. The button passes `-PrepareTests` to compile Rust test executables without executing them.
- `scripts/test.ps1 -SkipRust` runs build-free checks; `npm test` also runs fresh compiled Rust tests and never invokes a build.
- Rust tests run sequentially because native window tests interfere through process-wide magnification and desktop state. Ctrl-only trigger normalization uses Control/LControl/RControl; the short AHK names are aliases for the same key codes.
- `README.md` records action composition, cancellation, shared-state ownership, and script APIs.

## Editor workflow
- Icon.tsx owns action-button rendering and accessible labels; showLabel displays the same label beside the icon. fontAwesomeIcons.ts contains locally bundled Font Awesome Free SVG paths with attribution; icons work offline without an icon-library dependency.
- Profiles expose hotkeys, app events, overlay parts, scripts, and shared folder states in one workspace; legacy profile categories no longer gate parts.
- Keep individual behavior add buttons in their existing order; the user rejected an action-type dropdown. Use visible words for behavior choices, pickers, key recording, overlay parts, browsing, and cloud actions. Familiar edit/copy/delete/reorder controls and contextual section plus buttons stay compact icons.
- Arrange parts uses equal-width Horizontal, Vertical, and Individual positions text buttons. Highlighting changes colors only. Overlay settings appear above the parts in a responsive grouped form, with visible Save and Cancel buttons.
- Overlay containers own layout/placement; flat item membership and order remain authoritative. Every part belongs to a container, persisted as overlay_groups. Parts/containers can follow a named timer without a state. The user removed the editor preview; keep it removed.
- OverlayGroupView anchors a flow layout to its first visible part's top-left. Later parts use zero-width (column) or zero-height (row) slots to stay centered on that part without changing its position; hit-testing still measures each actual part wrapper.
- Every ProfileSection is collapsible; Hotkeys, Events, and Overlays start expanded, Scripts and States start collapsed. Section/group enable flags are independent of collapse state; state enablement belongs to the folder. Toggle mutations use set_profile_part_enabled to update only the intended flag against the current database.
- Native plans carry section revisions so disabling one section does not cancel the others. ExecutionScope preserves the caller section and script-defining profile through managed scripts and queued behaviors; those owners control cancellation.
