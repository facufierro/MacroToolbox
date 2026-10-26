# Overlay position checks

Without an app build:

```powershell
node --experimental-strip-types --test tests/overlay-position.test.mjs
```

Rust regression tests in `lib.rs` protect physical bounds and desktop offsets.
Running them requires build authorization:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib overlay_position_tests
```

After building and restarting, use **Pick** to position a timer inside a windowed
app, then confirm its top-left matches the picked point (within picker rounding).
Repeat at 100%, 125%, 150%, and 200% Windows scaling and on a secondary monitor
with different scaling positioned left of or above the primary screen. Move the
app between monitors and confirm the timer continues to follow its client area.
Check the Global folder too: 0,0 starts at the virtual desktop's top-left and
50,50 lands at its center. Icons, bars, and text should use the same positions.
