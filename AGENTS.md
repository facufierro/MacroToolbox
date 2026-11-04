# MacroToolbox repository instructions

These instructions apply to the entire repository.

## Preserve the app's UI style

- The UI must be intuitive, compact, and simple. Strictly follow the app's established visual
  style, control patterns, layout density, spacing, typography, colors, and icons. Reuse existing
  components and patterns; do not introduce a different visual language for a new feature.
- Clarity and discoverability take priority over removing labels. Use a short visible label
  whenever an icon or value alone would be ambiguous, unfamiliar, or easy to miss. Essential
  meaning must not depend on hovering for a tooltip. Reserve icon-only controls for familiar,
  self-explanatory actions, and remove only redundant labels. Keep concise tooltips and accessible
  names for additional context.
- Keep secondary and optional controls inline or in the app's existing compact menus/popovers.
  Do not add a dedicated heading, full-width section, or extra row when an existing row can hold
  the control clearly and readably. Match the surrounding interface instead of expanding it
  into a form.
- Put short control explanations in tooltips rather than permanent helper text. Do not add
  tutorial prose, explanatory descriptions, or compatibility notices unless requested.
- Before handing off UI changes, visually inspect empty and configured states at normal and
  narrower window sizes. Passing functional tests alone does not establish that the UI fits
  the app's style. Do not redesign adjacent UI unless requested.

## Settings must migrate automatically on upgrade

- Opening a newer MacroToolbox version must automatically upgrade existing saved settings
  before startup uses them. Users must not need to edit `db.json`, reset their setup, or run
  a separate migration command.
- Every persisted schema change must include the required startup migration in the same change.
  Preserve existing folders, profiles, hotkeys, variables, references, and behavior, including
  when users skip releases. Changing only the saved version number is not a migration.
- Back up the original settings before migrating and persist the result atomically. A failed
  migration must leave the original settings intact. Reopening the app must not repeat an
  already completed migration.
- Add regression coverage for upgrading older saved settings, skipping versions, preserving
  configured behavior, and reopening the migrated settings.

## Copilot key remap invariants

The Copilot key is not a standalone key: on the target Windows hardware it arrives as the
compound `LWin+LShift+F23` sequence (`SC06E` is F23). MacroToolbox's always-on remap must make
that physical button behave as a true held **Right Ctrl**, never Left Ctrl or generic Ctrl.

When Windows' native Copilot setting is `RightControl`, Windows owns this remap.
MacroToolbox must leave the Copilot/Win/Shift hooks inactive and skip its remap cleanup;
it must not inject a second Ctrl transition. The input host reads this native choice
at startup. The invariants below apply to the app fallback when native ownership is off.

Whenever changing AutoHotkey generation, keyboard hooks, modifier handling, input ownership,
hotkey matching, or release recovery, preserve all of these invariants:

- Neutralize the Copilot chord's built-in Left Win and Left Shift before matching or forwarding
  the user's next key. Those synthetic chord modifiers must not leak into applications or make
  an unshifted shortcut look shifted.
- Hold Right Ctrl continuously from the Copilot F23/`SC06E` down event until its corresponding
  up event. Do not infer Copilot release by polling F23 with `GetAsyncKeyState`; Windows does not
  reliably expose the synthesized Copilot F23 as physically held, and polling can release Ctrl
  immediately after it is pressed.
- The Copilot remap and generated profile hotkeys share one AutoHotkey keyboard hook. Emit the
  remapped transitions through that hook (currently `SendEvent` at a higher send level), so the
  synthetic Right Ctrl works both in external applications and as a modifier for MacroToolbox's
  own configured `rctrl ...` hotkeys. `SendInput` temporarily removes the script's own hook and
  must not be used for these remapped transitions.
- Preserve independently held physical Right Ctrl, Left Win, and Shift keys. Recovery for a
  missed Copilot key-up belongs to hook reinstallation and process-exit cleanup; it must not
  shorten a normal held remap or leave Ctrl stuck.
- Add or update regression coverage whenever this seam changes. At minimum protect:
  `Copilot+Shift+N` behaving as `RCtrl+Shift+N` in an external application; configured
  `rctrl o -> send(ø)` and `rctrl shift o -> send(Ø)` remaining distinct; press/hold/release not
  repeating or sticking Right Ctrl; and ordinary Win/Shift input continuing to work.

## Changelogs are required for every user-facing change

Releases are cut by `scripts/package-release.ps1` and `.github/workflows/release.yml`.
Both hard-fail if `changelog/v<version>.md` is missing: the packaging script throws
`Changelog not found...`, and the release workflow's verification step exits non-zero.

Whenever you make a user-facing code change, record it in the changelog for the next
unreleased version as part of the same change.

### One active development release

- A release groups the user's ongoing work. Individual features, fixes, follow-up requests,
  conversation turns, test runs, local builds, and rebuilds do not each get a new version.
- Look for the existing unreleased changelog before calculating a version. Append all work for
  that release to it. Never create a second next-version changelog for another feature in the
  same batch.
- A release target explicitly established by the user persists across follow-ups. Keep using
  it until the user requests another release or the current release is finalized. Do not
  silently reinterpret local build artifacts as the end of that batch.
- Apply semantic versioning to the entire pending release, using the last released version as
  the baseline. If the combined work requires a larger bump, rename the one unreleased
  changelog and preserve all its entries; do not split the batch between versions or increment
  the active version once per feature.
- Installer filenames, directory timestamps, `Cargo.toml`, `tauri.conf.json`, and database
  schema versions do not independently establish a new application release. Packaging owns
  application-version updates; feature work must not bump them independently.
- Before handing off user-facing work, verify that there is exactly one active unreleased
  changelog, all changes for the batch are recorded there, and no competing next-version
  changelog was introduced.

Example: after released `v1.0.6`, an ongoing feature batch targets `v1.1.0`. Additional
features and fixes after building `v1.1.0` still belong to `changelog/v1.1.0.md`. A local
`releases/v1.1.0/` directory does not justify creating `changelog/v1.2.0.md`.

### Never modify a released version's changelog

A version is released if it has a `vX.Y.Z` Git tag or a `releases/vX.Y.Z/` directory committed
in Git. Local, uncommitted build output does not make a version released. Keep features and
fixes for the same development release in its existing changelog, including after local rebuilds.
A released changelog describes what shipped. Never add, edit, or remove its entries; put later
changes in the next version instead.

### Determine or reuse the target version

1. Find the highest released version: the greatest `vX.Y.Z` represented by a Git tag
   (`git tag --sort=-v:refname`) or a committed `releases/vX.Y.Z/` directory
   (`git ls-tree --name-only HEAD:releases`). Ignore uncommitted local build directories.
2. Find the active unreleased `changelog/v*.md` and any release target established by the user.
   Reuse that release for the ongoing batch. Calculate a new target only when no active
   release exists, the user requests another release, or the combined batch requires a larger
   semantic-version bump.
3. Classify the entire pending batch according to semantic versioning:
   - **Major** (`v<MAJOR+1>.0.0`): a backward-incompatible change. Existing saved configuration
     (`db.json`), scopes, profiles, hotkeys, or persisted behavior commands stop working or
     require users to migrate their setup manually.
   - **Minor** (`v<MAJOR>.<MINOR+1>.0`): a new backward-compatible user-facing capability, such
     as a setting, button, overlay item, or command. Existing setups continue to work.
   - **Patch** (`v<MAJOR>.<MINOR>.<PATCH+1>`): a bug fix or small correction with no new feature.
   Adding, removing, renaming, or moving UI controls does not by itself require a major bump.
   UI refinements are patch changes; new capabilities are minor changes, unless they break
   existing saved setups as defined above. Compatible automatic migrations are not major changes.
   If a batch mixes change types, use the highest-ranked one: major, then minor, then patch.
4. When a new target is needed, increment the selected part of the highest released version
   and reset every lower part to zero. Never increment from the active unreleased version.
   For example, from `v1.0.6`, a fix targets `v1.0.7`, a feature targets `v1.1.0`, and a
   breaking change targets `v2.0.0`. The file is `changelog/v<target>.md`.
5. Confirm that the target has neither a tag nor a committed `releases/` directory. If it does,
   it is already released; repeat these rules using that release as the baseline. Otherwise,
   continue using that target for the current development release.

`src-tauri/tauri.conf.json` is not a reliable released-version signal. The packaging script
updates it during a build, before the tag exists. Trust tags and committed `releases/` directories.

### Write the changelog entry

- Keep one next-version changelog. If an unreleased `changelog/v*.md` exists above the highest
  released version, append to it. If the new change requires a higher semantic-version bump,
  rename that file to the higher target and append there; never leave competing next-version
  changelogs.
- If no next-version changelog exists, create `changelog/v<target>.md`:

  ```markdown
  # MacroToolbox v<target>

  ## Changes

  - <one user-facing, past-tense bullet per change>
  ```

- If the file exists and is unreleased, append a bullet under `## Changes`.
- Describe the effect for the user, not the implementation.
- Skip pure internal churn—formatting, comments, renames, and editor or agent configuration—
  unless it changes application behavior.
