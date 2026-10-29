@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto no_node
if exist node_modules goto check_electron
echo Installing dependencies. Internet access is required on first run.
call npm install
if errorlevel 1 goto install_failed

:check_electron
if exist "node_modules\electron\dist\electron.exe" goto build_site
echo Downloading Electron runtime...
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
call node "node_modules\electron\install.js"
if exist "node_modules\electron\dist\electron.exe" goto build_site
echo Electron download failed. Set a mirror and reinstall, e.g.:
echo   set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
echo   npm install
pause
exit /b 1

:build_site
rem Use a project-local temp dir so antivirus/file locks cannot block esbuild cleanup.
if not exist ".tmp-desktop" mkdir ".tmp-desktop"
set "TEMP=%cd%\.tmp-desktop"
set "TMP=%cd%\.tmp-desktop"
echo Building frontend (local temp)...
call node scripts\build.mjs
if errorlevel 1 goto build_failed
rem Start the local API so online music / NetEase login works in the desktop shell.
netstat -ano | findstr /C:"127.0.0.1:8787" >nul 2>nul
if errorlevel 1 (
  echo Starting local API server...
  start "SONORA API" /min cmd /c "node server\index.js"
  set "SONORA_API_STARTED=1"
)
echo Starting SONORA Desktop...
call node scripts\electron-launch.mjs
if defined SONORA_API_STARTED taskkill /FI "WINDOWTITLE eq SONORA API*" /T /F >nul 2>nul
if errorlevel 1 pause
exit /b 0

:no_node
echo Please install Node.js 20.19 or newer, then try again.
pause
exit /b 1

:install_failed
echo Installation failed. Check your internet connection and try again.
pause
exit /b 1

:build_failed
echo Build failed. Check the console output above.
pause
exit /b 1
