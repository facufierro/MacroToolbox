$env:PATH += ";C:\Users\fierr\.cargo\bin"
Set-Location "D:\Projects\Games\MacroToolbox"

# Kill any leftover MacroToolbox dev instances before starting a new one
Get-Process -Name "MacroToolbox","macro-toolbox" -ErrorAction SilentlyContinue | Stop-Process -Force

# Kill MacroToolbox's own leftover AutoHotkey processes (they run scripts from its app-data
# folder). Orphans from a force-killed session hold AutoHotkey64.exe and make the next build
# fail with "file in use". Scoped by command line so unrelated AutoHotkey scripts are untouched.
Get-CimInstance Win32_Process -Filter "Name='AutoHotkey64.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*com.fierro.macro-toolbox*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# Free the Vite dev port so a leftover dev server doesn't fail the launch with "port in use"
Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

npm run tauri dev
