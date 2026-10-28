# Overlay position checks

Without an app build:

```powershell
node --experimental-strip-types --test tests/overlay-position.test.mjs
node --experimental-strip-types --test tests/overlay-layout.test.mjs
```

The layout checks render the actual overlay parts in headless Chrome or Edge.
They protect matching icon positions with and without timers, centered alignment,
part hitboxes, layout gaps, and individual position offsets.

Rust regression tests in `lib.rs` protect physical bounds and desktop offsets.
Running them requires build authorization:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib overlay_position_tests
```

After building and restarting, use **Pick** to position a timer inside a windowed
app, then confirm its top-left matches the picked point (within picker rounding).
Alt+Tab away and back repeatedly, including minimizing/restoring the app. The
overlay should reappear directly at its configured position without flashing at
the top-left or at the minimized window's coordinates. Move the target while it
is unfocused and repeat; its timer should continue without restarting.
Repeat at 100%, 125%, 150%, and 200% Windows scaling and on a secondary monitor
with different scaling positioned left of or above the primary screen. Move the
app between monitors and confirm the timer continues to follow its client area.
Check the Global folder too: 0,0 starts at the virtual desktop's top-left and
50,50 lands at its center. Icons, bars, and text should use the same positions.
Compare two overlays with matching positions and matching first icons, one with
only the icon and the other with a timer below it. Their icons should overlap
exactly, including when the timer is wider or its background is hidden. A taller
neighbor in a horizontal layout should likewise leave the first icon anchored.
