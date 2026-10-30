# Overlay visibility on secondary monitors

After rebuilding, with the overlay enabled for the game:

1. Keep the borderless game focused on the secondary monitor. Check the overlay on
   the physical display without taking a screenshot or starting screen sharing.
2. Alt-Tab away and back, then switch between windowed and borderless modes. The
   overlay should reappear above the game without taking keyboard focus.
3. Move the game between the laptop display and the secondary monitor. Check
   overlay positions and right-click dismissal, including different display scales
   and a secondary monitor to the left or above the laptop display.
4. Disable overlays or leave the target app. They must stay hidden; position
   refreshes must not show a hidden overlay or reset its timers.

The native `unchanged_canvas_recovers_above_a_borderless_topmost_window_without_taking_focus`
regression checks order recovery when the canvas already has the correct bounds.
It does not verify the affected laptop's GPU composition or physical display output.
