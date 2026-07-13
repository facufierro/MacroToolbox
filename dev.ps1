$env:PATH += ";C:\Users\fierr\.cargo\bin"
Set-Location "D:\Projects\Games\HotkeyManager"

# Kill any leftover MacroToolbox dev instances before starting a new one
Get-Process -Name "MacroToolbox","macro-toolbox" -ErrorAction SilentlyContinue | Stop-Process -Force

npm run tauri dev
