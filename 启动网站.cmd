@echo off
cd /d "%~dp0"
rem Use a project-local temp dir for Vite / esbuild.
if not exist ".tmp-build" mkdir ".tmp-build"
set "TEMP=%cd%\.tmp-build"
set "TMP=%cd%\.tmp-build"
where node >nul 2>nul
if errorlevel 1 goto no_node
if exist node_modules goto start_stack
echo Installing dependencies. Internet access is required on first run.
call npm install
if errorlevel 1 goto install_failed

:start_stack
rem Start the local MariaDB and API when the database has been set up.
if not exist ".mysql\mariadb-11.4.5-winx64\bin\mysqld.exe" goto check_site
netstat -ano | findstr /C:"127.0.0.1:3307" >nul 2>nul
if errorlevel 1 (
  echo Starting local database...
  powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\db-start.ps1" >nul 2>nul
)
netstat -ano | findstr /C:"127.0.0.1:8787" >nul 2>nul
if errorlevel 1 (
  echo Starting API server...
  start "SONORA API" /min cmd /c "node server\index.js"
)

:check_site
netstat -ano | findstr /C:"127.0.0.1:5173" >nul 2>nul
if not errorlevel 1 goto already_running
echo Starting SONORA. Keep this window open while using the website.
call npm run dev -- --open
goto end_success

:already_running
echo Website is already running. Opening http://127.0.0.1:5173/
start "" "http://127.0.0.1:5173/"
pause
exit /b 0

:no_node
echo Please install Node.js 20.19 or newer, then try again.
pause
exit /b 1

:install_failed
echo Installation failed. Check your internet connection and try again.
pause
exit /b 1

:end_success
pause
exit /b 0
