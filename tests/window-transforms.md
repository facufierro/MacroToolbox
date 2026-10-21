# Window transform checks

Use a windowed game at 1280×600 on a 1920×1080 monitor.

1. Toggle `fit`: the displayed image should enlarge to 1920×900, centered with
   90-pixel bars above and below. The game's selected resolution and native client
   must remain 1280×600. An 800×600 source should display at 1440×1080 with side bars.
   Check that bar pixels stay `#000000` with light and dark Windows themes, including
   all four monitor edges and corners; no desktop pixels or window border should show.
2. Combine `fit` with `borderless` in both orders. Fit scales the image; borderless
   removes the source window's frame without enlarging its client. Switch fit →
   stretch → fit, then toggle fit off: stretch resizes the client, fit restores the
   original client size and scales its pixels, and toggling off restores placement.
3. Check the game's camera, menus, ordinary mouse clicks, mouse wheel, percentage
   `goto` actions, and the MacroToolbox overlay. Native input stays in the original
   client coordinates; the scaler displays the corresponding cursor. A game's
   tighter mouse lock must remain intact when entering or leaving a menu.
4. Alt-Tab, Win+R, minimize, restore, and open an owned dialog. The scaled view must
   hide and release its mouse restriction while the game is unfocused or showing
   a separate dialog, then return when the game regains focus.
5. Repeat on a secondary monitor with negative coordinates and a different DPI
   scale. Quit MacroToolbox while fit is active: the scaled view must disappear,
   mouse input must recover, and the original window must return. Closing and
   reopening the game must discard the closed window's presentation.

Fit uses Windows' native image magnification control; it does not enlarge the
render surface or change the display mode. Verify The Isle's selected resolution
and rendered image in-game; native API tests cannot prove a particular game's
capture behavior. Exclusive fullscreen and protected content may not be captured.

Automated coverage lives in `window_transform.rs` and
`window_transform/presentation.rs` (source preservation, fitted image geometry,
native scaler configuration and black pixels), and `tests/ahk/behavior.test.ahk`
(behavior routing). Run:

`cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`

`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-ahk-behavior.ps1`
