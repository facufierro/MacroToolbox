$env:PATH += ";C:\Users\fierr\.cargo\bin"
Set-Location "D:\Projects\Games\HotkeyManager"

# Kill any leftover HotkeyManager dev instances before starting a new one
Get-Process -Name "HotkeyManager","hotkey-manager" -ErrorAction SilentlyContinue | Stop-Process -Force

npm run tauri dev
