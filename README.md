# MacroToolbox

Application-scoped hotkeys, app events, shared states, overlays, and Python/AutoHotkey scripts.

## Profile editor

Each profile has one editor for hotkeys, app events, overlay parts, and scripts. Existing profile categories remain readable as legacy metadata and do not restrict which parts a profile can contain.

App folders can contain subfolders. Create one with New subfolder, set its toggle shortcut in Subfolder settings, and place profiles in it using the Subfolder selector in Profile settings. Its switch or shortcut enables or disables the contained profiles together while preserving their individual enabled settings. Shortcuts apply while the app folder's target is focused; Global shortcuts apply everywhere. Disabling a subfolder releases its running inputs, stops its scripts, and clears its owned overlay timers. Deleting a subfolder keeps its profiles in the app folder.

Subfolders stay above profiles, with new subfolders added first. Drag their handles to reorder them. Drag a profile row or its handle onto a subfolder header to move it inside, or onto the app-folder header to move it back out. Profile moves stay within their app folder and work with empty or collapsed subfolders. The gear on each app folder opens its settings.

Drag a hotkey behavior row or its handle onto a profile in the sidebar to move it there, including profiles in other app folders. Referenced scripts, states, and overlays remain available. The destination keeps its settings and existing hotkeys; a profile with the same assigned trigger cannot accept the move. Inherited behaviors must be moved from their owning profile.

Drag an overlay card or its handle onto a sidebar profile to move the whole overlay and its parts. Individual parts can also move onto a profile, retaining their overlay settings, or directly onto another overlay card. Moves preserve part IDs, appearance, positions, timer links, and state definitions. Inherited overlays and parts must be moved from their owning profile.

The plus button in the Overlays section creates a container for timer, icon, bar, and text parts. Add parts with the Timer, Icon, Bar, and Text buttons inside the overlay. Move existing transfers parts, Settings opens the form above the parts, and the overlay's plus button creates a hotkey that starts or restarts its parts. Arrangement choices use equal-width text buttons. Pick position, key recording, behavior choices, and file browsing have visible labels; familiar edit, copy, and delete controls use Font Awesome icons. Overlay visibility can follow a named timer directly; individual parts have the same timer visibility option.

Every part belongs to an overlay. Existing standalone parts are wrapped in individual overlays while preserving their IDs, positions, and behavior references. Membership and part order remain stored on the profile's existing item list, using `overlay_groups` as the saved container definitions. Deleting an overlay deletes its owned parts after confirmation and removes references to deleted targets.

Hotkeys, Events, Overlays, Scripts, and States can be collapsed independently of whether they are enabled. Hotkeys, Events, and Overlays start expanded; Scripts and States start collapsed. Section and overlay-group switches preserve their configuration while stopping owned inputs, timers, bar values, and scripts. Disabled overlay/state operations are skipped so an otherwise enabled behavior can continue. States remain folder-owned: their switch applies to every profile in that folder and clears shared flags and countdowns. Independent overlay timers continue when only States is disabled.

Managed scripts receive the calling profile and section as their API context. `MACROTOOLBOX_SCRIPT_OWNER` identifies the profile that defines the script. Managed behaviors retain both contexts, so disabling the calling section or the defining profile's Scripts section also cancels their actions.

The bottom console opens for new errors from the app, overlay, cloud backup, and behavior runtime. It keeps the current session's messages with timestamps and repeated-error counts; Copy exports the messages and Clear empties them. Collapsing it does not stop logging. Missing overlay references remain visible in the behavior selector so they can be relinked to an existing part.

Drag the dot handle to reorder folders, profiles, hotkeys, events, overlays and their parts, scripts, shared states, variables, and behavior steps. The insertion line marks the drop position; focused handles also accept Up and Down. Saved lists persist their order immediately. Behavior steps keep their draft order until the behavior is saved. Reordering stays within the same list, folder, or overlay. Inherited entries keep their source order; owned overrides fill their existing slots in the order saved by the current profile.

## Shared variables

Variables are available to every profile. Number variables work in Sleep, Repeat timings, coordinates, resolution, and bar values. Text variables work in Type text. Keys variables work in key inputs, including Press, Hold, Repeat, and Mouse press.

Trigger list variables contain separate shortcuts, such as `lctrl 1`, `lctrl 2`, and `lctrl 3`. Create the list in Variables or from a hotkey's Trigger source, then choose Variable for the trigger. Each shortcut runs the same saved behavior. Choose Matched trigger as the source for a Press step to replay the shortcut that activated it; other steps, such as Press `e`, stay shared. Trigger lists support recording, adding, deleting, and dragging individual entries. Matched trigger also works with a literal hotkey trigger and with On release, including nested steps; it requires a hotkey and cannot be used in app events or standalone script/API calls.

Every supported field has a Value / Variable selector. Choosing Variable opens creation when there are no variables of the matching type. Save and use saves the definition and assigns it to that field. Existing variables can be selected by name, and New variable creates another. Sleep and Repeat timings use milliseconds.

The Variables page lists saved definitions. Add and Edit open a form with explicit Save and Cancel actions. Renames preserve references; saved value changes apply to all uses. Referenced variables keep their type and cannot be deleted until their uses are removed.

## Behavior and lifetime rules

Secure send types a saved password when its hotkey runs. Add Secure send in the hotkey editor, enter the password in the masked field, then save the hotkey. Cancel discards password edits. Saved fields show a placeholder without retrieving the password. Passwords are stored in the current Windows user's Credential Manager; profiles, exports, cloud backups, runtime configuration, and logs contain only references. Enter the password again after importing or restoring a reference on another computer or Windows account. Changing a password creates a new credential so copies keep their existing password; an unused credential is removed after its last local profile reference is deleted or replaced. Secure send requires a hotkey, sends literal text without the clipboard, and does not append Enter.

- Target folders own application targets and shared state definitions. Profiles own their behaviors, overlay items, scripts, and running work.
- `press` taps a key combination. `hold` and `repeat` last until trigger release. A sequence waits for each action; a parallel group advances independent branches and completes when every branch finishes.
- Press and Mouse press offer On press and On release. On release waits for the activating hotkey key or chord to be released, then performs the tap or click. It keeps its place in a sequence and can wait independently in a parallel group. Release actions require a hotkey trigger and are unavailable for app events or standalone script/API behavior calls.
- Wait for has no parameters and uses the following action in the same list. With Press or Mouse press, it observes that physical input without replaying it; On release waits for that input's release, and Double click waits for both clicks. Other actions retain their normal completion behavior. In a parallel group, the wait and its next action form one branch. A wait needs a following action in its own list. Saved input waits automatically become Wait for followed by the matching input action.
- Start and Stop overlay can select several overlays or parts in one action. Start or Restart applies to every selected target before the next action continues.
- Pressing a hotkey again after releasing it replaces that hotkey's pending activation, including click waits and delays. Its configured key presses or text are sent again; the cancelled activation releases its inputs and input observers. Holding the trigger does not restart the behavior.
- A hotkey's Cancel triggers list stops its running behavior list when any listed key or mouse button is pressed, including nested and simultaneous actions, and releases its owned inputs. For an E-triggered list cancelled by either right-click or Escape, set Trigger to `e` and add `RButton` and `Esc` as separate cancel triggers. Cancellation inputs still reach the application. An already-held input must be released and pressed again; an empty list disables cancellation by keys. Existing saved cancel keys upgrade automatically to a one-entry list.
- Under Cancel on, Another behavior starts also cancels that running list when a new behavior activation begins, including in another profile or through an event or script/API call. Nested steps in the same activation do not count. This option is off by default and can be combined with cancel keys.
- A matched hotkey consumes its activating key's repeats and release until that key is released, even if its modifiers are released first or its behavior has already finished. A later plain press works normally.
- Sending the trigger itself still produces a complete configured press. Its intercepted physical hold does not extend the output; independent physical keys and shared output owners remain held.
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

Variable references use `{ "variable": "id" }` in action parameters and hotkey triggers. Trigger lists store an array of shortcut strings; Press uses `{ "source": "trigger" }` for Matched trigger. Literal strings remain literal. The v7 schema reads existing number variables and numeric `$id` references automatically, and keeps `db.json.v6.bak` before upgrading v6 settings. New saves include each variable's Number, Text, Keys, or Trigger list type. Older application versions cannot read the v7 database.

The v5 settings schema moves state definitions into folders and saves `db.json.v4.bak` before upgrading v4 settings. Existing folder definitions take precedence, followed by the first legacy definition for each state ID. Previous profile-local overrides become one shared definition. Older app versions cannot read the new schema.

The v8 schema adds app-owned `subfolders` and profile `subfolder_id` membership. Startup backs up the original settings before upgrading, including skipped versions. Existing profiles stay in the app folder with their configuration and activation unchanged. Subfolder switch states and shortcuts persist across restarts.

The v9 schema moves legacy Wait for input values into separate following Press or Mouse press actions, including nested behaviors and shared Behavior variables. Startup backs up the original settings and saves the upgraded setup atomically. Wait for itself stores no input value.

The v10 schema stores Start and Stop overlay targets as lists. Existing single-overlay actions, including shared and nested behaviors, upgrade automatically with their selected target and Start/Restart mode preserved.

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
