# MacroToolbox

Application-scoped hotkeys, app events, shared states, overlays, and Python/AutoHotkey scripts.

## Profile editor

Each profile has one editor for hotkeys, app events, overlay parts, and scripts. Existing profile categories remain readable as legacy metadata and do not restrict which parts a profile can contain.

The plus button in the Overlays section creates a container for timer, icon, bar, and text parts. Add parts with the Timer, Icon, Bar, and Text buttons inside the overlay. Move existing transfers parts, Settings opens the form above the parts, and the overlay's plus button creates a hotkey that starts or restarts its parts. Arrangement choices use equal-width text buttons. Pick position, key recording, behavior choices, and file browsing have visible labels; familiar edit, copy, and delete controls use Font Awesome icons. Overlay visibility can follow a named timer directly; individual parts have the same timer visibility option.

Every part belongs to an overlay. Existing standalone parts are wrapped in individual overlays while preserving their IDs, positions, and behavior references. Membership and part order remain stored on the profile's existing item list, using `overlay_groups` as the saved container definitions. Deleting an overlay deletes its owned parts after confirmation and removes references to deleted targets.

Hotkeys, Events, Overlays, Scripts, and States can be collapsed independently of whether they are enabled. Hotkeys, Events, and Overlays start expanded; Scripts and States start collapsed. Section and overlay-group switches preserve their configuration while stopping owned inputs, timers, bar values, and scripts. Disabled overlay/state operations are skipped so an otherwise enabled behavior can continue. States remain folder-owned: their switch applies to every profile in that folder and clears shared flags and countdowns. Independent overlay timers continue when only States is disabled.

Managed scripts receive the calling profile and section as their API context. `MACROTOOLBOX_SCRIPT_OWNER` identifies the profile that defines the script. Managed behaviors retain both contexts, so disabling the calling section or the defining profile's Scripts section also cancels their actions.

The bottom console opens for new errors from the app, overlay, cloud backup, and behavior runtime. It keeps the current session's messages with timestamps and repeated-error counts; Copy exports the messages and Clear empties them. Collapsing it does not stop logging. Missing overlay references remain visible in the behavior selector so they can be relinked to an existing part.

## Behavior and lifetime rules

- Target folders own application targets and shared state definitions. Profiles own their behaviors, overlay items, scripts, and running work.
- `press` taps a key combination. `hold` and `repeat` last until trigger release. A sequence waits for each action; a parallel group advances independent branches and completes when every branch finishes.
- Pressing a hotkey again after releasing it replaces that hotkey's pending activation, including click waits and delays. Its configured key presses or text are sent again; the cancelled activation releases its inputs and input observers. Holding the trigger does not restart the behavior.
- Trigger release completes holds/repeats and permits trailing sequence actions. Focus loss cancels running behaviors and releases their inputs. Shared states and countdowns continue.
- Disabling a profile cancels its work, stops its scripts, and removes its overlay timers. Folder-owned shared states remain available to other profiles.
- App lifecycle handlers use the same actions. Handlers dispatched while the target is unfocused may update state, overlays, and window properties; input actions require target focus. Event/API holds have the target/profile lifetime.

## Implementation boundaries

| Module | Authority |
| --- | --- |
| `src-tauri/src/behavior.rs` | Behavior wire model, legacy reading, validation |
| `src/behaviors.ts` | Editor drafts and portable reference traversal |
| `src-tauri/src/runtime.rs` | Folder state, countdowns, bar values, overlay snapshots |
| `src-tauri/src/behavior_runtime.ahk` | Running action trees, timing, cancellation |
| `src-tauri/src/runtime_host.ahk` | Live bindings, app lifecycle triggers, input context |
| `src-tauri/src/ahk.rs` | Key resolution and the shared input/Copilot hook |
| `src-tauri/src/scripts.rs` | Script processes and ownership cleanup |

Binding changes replace `runtime.json` while the input host remains running. Activation is acknowledged before the UI reports it healthy. Overlay windows render revisioned backend snapshots and do not own state transitions.

New edits serialize action trees as JSON inside the existing `behavior` field. Existing command strings remain readable. The editor and backend share compatibility fixtures in `tests/fixtures/behaviors.json`.

The v5 settings schema moves state definitions into folders and saves `db.json.v4.bak` before upgrading v4 settings. Existing folder definitions take precedence, followed by the first legacy definition for each state ID. Previous profile-local overrides become one shared definition. Older app versions cannot read the new schema.

## Managed script API

Python scripts import `macrotoolbox`; managed AutoHotkey scripts receive the `MacroToolbox` class automatically. Both expose state entry/exit/toggle, overlay start/restart/stop, bar values, snapshots, script launch, and behavior execution. Processes belong to both their defining and calling profiles.

```python
import macrotoolbox as mt

mt.set_state("buff-state-id")
mt.start_overlay("timer-item-id", restart=True)
mt.set_bar("health-item-id", 42)
mt.run_behavior([
    {"type": "parallel", "steps": [
        {"type": "repeat", "key": "a b", "interval": "100", "hold": "6"},
        {"type": "hold", "key": "RButton"},
    ]},
])
```

```autohotkey
MacroToolbox.SetState("buff-state-id")
MacroToolbox.StartOverlay("timer-item-id", true)
state := MacroToolbox.Snapshot()
```

`run_behavior` queues managed work. Scripts using direct OS input retain responsibility for that input's cleanup. Script bodies remain unchanged during import; code can resolve current resource IDs from `snapshot().config`.

## Verification

The **Build** action button packages the application and compiles Rust test binaries without running them. Then `npm test` runs type checks, JavaScript tests, Python API tests, isolated AutoHotkey tests, and those compiled Rust tests. It rejects stale Rust binaries using a source fingerprint and never builds.

For checks that need no build:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test.ps1 -SkipRust
```

AutoHotkey checks replace global input delivery with test sinks. Native mouse checks use hidden fixture windows. `/Validate` checks the complete input host and script API without installing hooks.

## Cloud backup

Google sign-in and automatic Firebase backup can be connected in Settings. See the [one-project Firebase setup](firebase/README.md).
