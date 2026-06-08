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
2. The target is `changelog/v<highest-released-with-patch+1>.md`
   (e.g. highest released `v1.0.4` → `changelog/v1.0.5.md`).
3. Sanity check: the target version must **not** already have a tag or a `releases/` directory.
   If it does, increment again.

> Note: `src-tauri/tauri.conf.json`'s `version` is **not** a reliable "released" signal —
> `package-release.ps1` bumps it during a build, before the tag exists. Trust tags and
> `releases/` directories.

### Writing the entry

- **If `changelog/v<target>.md` does not exist,** create it:

  ```
  # Hotkey Manager v<target>

  ## Changes

  - <one bullet per change, user-facing, past tense>
  ```

- **If it exists (and is unreleased),** append a bullet under `## Changes`.
- Bullets describe the **effect for the user**, not the code. Skip pure internal churn
  (formatting, comments, renames, editor/tooling config) unless it changes app behavior.
