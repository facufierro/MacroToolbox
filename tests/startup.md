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
