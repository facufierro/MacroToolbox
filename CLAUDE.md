# Hotkey Manager — project rules

## Changelogs are required for every change

Releases are cut by `scripts/package-release.ps1` and `.github/workflows/release.yml`.
**Both hard-fail if `changelog/v<version>.md` is missing** — the packaging script throws
("Changelog not found…") and the release workflow's verify step exits non-zero. So a missing
changelog blocks the entire release.

Therefore, whenever you make a user-facing code change in this repo, record it in the changelog
for the **next, UNRELEASED** version **in the same change**.

### A released version's changelog is FROZEN — never touch it

A version is **released** if it has a git tag `vX.Y.Z` **or** a `releases/vX.Y.Z/` directory.
Its changelog describes exactly what shipped in that binary. **Never add, edit, or remove
entries in the changelog of a released version** — if you do, the notes will claim fixes that
the shipped binary does not contain. If you are about to edit such a file, stop: your change
belongs in the next version instead.

### Determine the target version every time (do not assume)

1. Find the **highest released version** = the greatest `vX.Y.Z` that has a git tag
   (`git tag --sort=-v:refname`) or a `releases/vX.Y.Z/` directory.
2. **Classify the change** to choose which part to bump (semantic versioning `vMAJOR.MINOR.PATCH`):
   - **major** (`v<MAJOR+1>.0.0`) — a breaking change: an existing user's saved config /
     `db.json`, scopes, profiles, or hotkeys stops working or needs migration, or a feature
     or command is removed/renamed.
   - **minor** (`v<MAJOR>.<MINOR+1>.0`) — a new, backward-compatible user-facing feature or
     capability (a new setting, button, overlay item, command, …). Existing setups keep working.
   - **patch / hotfix** (`v<MAJOR>.<MINOR>.<PATCH+1>`) — a bug fix or small correction with
     no new feature.
   If a single batch mixes types, use the highest-ranked one (major > minor > patch).
3. The target is the highest released version with the chosen part incremented and every lower
   part reset to 0 — e.g. from released `v1.0.6`: a fix → `v1.0.7`, a feature → `v1.1.0`, a
   breaking change → `v2.0.0`. The file is `changelog/v<target>.md`.
4. Sanity check: the target must **not** already have a tag or a `releases/` directory. If it
   does, that version is already released — apply these same rules to it to get the next one.

> Note: `src-tauri/tauri.conf.json`'s `version` is **not** a reliable "released" signal —
> `package-release.ps1` bumps it during a build, before the tag exists. Trust tags and
> `releases/` directories.

### Writing the entry

- Keep a **single** next-version changelog. If an unreleased `changelog/v*.md` already exists
  above the highest released version, that file *is* the next version — append to it. But if
  your change needs a **higher** bump than that file's version reflects (e.g. it is `v1.0.7`
  for a fix and you are now adding a feature), rename the file to the higher target (`v1.1.0`)
  and append your bullet there — never leave two competing next-version files.
- **If no next-version changelog exists,** create `changelog/v<target>.md`:

  ```
  # Hotkey Manager v<target>

  ## Changes

  - <one bullet per change, user-facing, past tense>
  ```

- **If it exists (and is unreleased),** append a bullet under `## Changes`.
- Bullets describe the **effect for the user**, not the code. Skip pure internal churn
  (formatting, comments, renames, editor/tooling config) unless it changes app behavior.
