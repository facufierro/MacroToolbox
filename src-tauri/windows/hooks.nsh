; Tauri NSIS installer hooks.
;
; MacroToolbox runs elevated (requireAdministrator) and auto-starts into the tray, so during an
; update the previous MacroToolbox.exe is still running and holds a lock on its own file. The
; stock uninstaller then leaves the exe behind and the installer aborts with "Unable to
; uninstall!". Force-close the app (and its AutoHotkey child, via /T) before the files are
; touched so they are free to be replaced. Because the installer runs perMachine it is elevated
; and is therefore allowed to terminate the elevated app. taskkill returns non-zero when nothing
; is running, which is fine — we ignore it.

!macro NSIS_HOOK_PREINSTALL
  Push $0
  nsExec::Exec 'taskkill /F /T /IM "MacroToolbox.exe"'
  Pop $0
  Pop $0
  Sleep 1500
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Push $0
  nsExec::Exec 'taskkill /F /T /IM "MacroToolbox.exe"'
  Pop $0
  Pop $0
  Sleep 1500
!macroend
