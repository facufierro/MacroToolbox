$env:PATH += ";C:\Users\fierr\.cargo\bin"
Set-Location "D:\Projects\Games\MacroToolbox"

# Kill any leftover MacroToolbox dev instances before starting a new one
Get-Process -Name "MacroToolbox","macro-toolbox" -ErrorAction SilentlyContinue | Stop-Process -Force

# Free the Vite dev port so a leftover dev server doesn't fail the launch with "port in use"
Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

npm run tauri dev
