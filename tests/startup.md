# Login startup regression

Run these checks after building and installing the updated app. They change the
Windows login task, so perform them explicitly as part of the startup check.

1. Open the installed app, enable Launch on startup, and capture the MacroToolbox
   scheduled task's action with `schtasks /Query /TN MacroToolbox /XML`. Its
   executable must be the installed app.
2. Close the installed app and launch Run Dev with that setting still enabled.
   Query the task again. Starting the development app and saving its settings must
   preserve the installed executable as the task's target.
3. Disable Launch on startup in the development app. The task must be removed;
   development builds may disable startup even though they cannot register
   themselves as its target. Enabling it again in development must not create a
   task that runs the development executable.
4. Close development and open the installed app with Launch on startup enabled.
   It must register its current installed path, including after an app update or
   move. This also repairs a task previously pointing at a development build.
5. Restart Windows without Vite running. With Open to tray enabled, the app must
   start in the tray; focusing an armed overlay's target must show its configured
   parts without an embedded browser error page.

The reported one-time error page was not reproduced. These checks cover the
confirmed registration issue that can launch a development executable at login
without its frontend server; they do not establish that it caused that occurrence.

## Automatic settings upgrades

1. Start the newer build with a copy of v6 settings. It must upgrade to v7 before
   activating profiles, preserve the original as `db.json.v6.bak`, and retain all
   profiles, variables, and behavior references. Reopen it and verify that neither
   the migrated settings nor the backup changes just from loading them.
2. Repeat with older saved formats and skipped releases. Upgrades must happen
   during the normal settings load, without a separate command or resetting the
   user's configuration. A failed backup must leave the original file untouched.

## Newer settings with an older installed app

1. In a test installation, use settings whose schema is newer than the installed
   app supports. Startup must show Update required, automatically check the latest
   release, and run its installer when a newer version is available. The installer
   must relaunch the app and preserve the settings file. Test both normal startup
   and an installation configured to open to the tray.
2. With the network unavailable, no newer release, or a failed download, the app
   must keep the update screen open and allow Retry update. The settings file must
   remain byte-for-byte unchanged, and hotkeys and cloud sync must not start.
3. Relaunch with the latest released app and a still-newer test schema. It must
   report that no newer release is available rather than reinstalling in a loop.
