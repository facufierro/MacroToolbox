# Hotkey Manager — project rules

## Changelogs are required for every change

Releases are cut by `scripts/package-release.ps1` and `.github/workflows/release.yml`.
**Both hard-fail if `changelog/v<version>.md` is missing** — the packaging script throws
("Changelog not found…") and the release workflow's verify step exits non-zero. So a missing
changelog blocks the entire release.

Therefore, whenever you make a user-facing code change in this repo, record it in the changelog
for the next release **in the same change**:

- **File:** `changelog/v<next>.md`, where `<next>` is the latest git tag with its **patch number
  incremented** (e.g. latest tag `v1.0.3` → `changelog/v1.0.4.md`). This mirrors how
  `package-release.ps1` derives the version from `git describe --tags --abbrev=0`.
- **If the file does not exist,** create it with this format:

  ```
  # Hotkey Manager v<next>

  ## Changes

  - <one bullet per change, user-facing, past tense>
  ```

- **If it already exists,** append a bullet under `## Changes` instead of making a new file.
- Bullets describe the **effect for the user**, not the code. Skip pure internal churn
  (formatting, comments, renames) unless it changes behavior.
