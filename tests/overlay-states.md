# Shared overlay state checks

1. Select an overlay profile, click **States**, then **+ State**. Create a state
   with zero duration for a toggle, or a duration for a timed state.
2. Assign that state to **Visible with** on a timer, icon, and text item. For the
   timer, also select **Use timer from** that state.
3. In a hotkeys profile in the same folder, add a hotkey with a **state** step
   selecting that state. Arm both profiles. Triggering it should show all three
   items; a second trigger toggles a zero-duration state off or restarts a timer.
4. Right-click any linked item. All items using that visibility state should hide;
   the next trigger should restore them. Other states must remain unchanged.
5. Repeat using an event profile's **state** step. Export/import the folder, and
   copy or export/import a profile referencing another profile's state. Its links
   should continue to work. Deleting a state should clear its references across
   that folder. Existing group metadata must load without removing any items.
6. Add a fixed-duration timer with **Start with overlay** checked. It should count
   down when the overlay activates. Checking it while the overlay is active should
   start it immediately. Leave a second timer unchecked: it should remain idle.
7. Add a **startoverlay** step in a hotkey or event and select the unchecked timer.
   It should start that timer; repeating it while running must preserve the
   remaining time. Dismiss the timer or let it expire, then start it again. An
   expired visible timer must stay at zero until restarted. Repeat with a timer
   reading a shared state, and with an icon using a shared visibility state.
8. Start a timer, Alt-Tab away, wait a few seconds, and return. Its countdown
   should continue through the time away. Repeat between two apps with different
   overlay profiles. Expired timers must stay at zero and dismissed items must
   stay dismissed. Disarm and rearm the overlay profile to start a fresh session.
9. Create a timer with **Only while running** visibility and **Start with overlay**
   unchecked. It must stay hidden until a Start or Restart overlay action runs,
   appear during its countdown, and hide exactly at expiry. Restarting it while
   running must reset the countdown; starting it again must preserve its deadline.
   Repeat with **Start with overlay** enabled and with a shared timer state.

Without a build:

```powershell
node --experimental-strip-types --test tests/overlay-runtime.test.mjs tests/profile-states.test.mjs tests/overlay-position.test.mjs tests/overlay-items.test.mjs
```

The Rust `available_states_share_folder_definitions_and_preserve_overrides` test
checks the overlay configuration's state choices. Running Rust tests requires
build authorization.
