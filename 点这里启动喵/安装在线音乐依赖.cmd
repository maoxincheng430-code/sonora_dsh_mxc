@echo off
rem Script lives in a subfolder; go up to the project root.
cd /d "%~dp0.."
title SONORA - install online music deps
where node >nul 2>nul
if errorlevel 1 goto no_node

echo.
echo ============================================================
echo    SONORA: install online music dependencies
echo ============================================================
echo.
echo   This installs the two helper services used by the
echo   "Online Music" panel:
echo.
echo     - QQ Music   (tools\qq-api,  port 3200)
echo     - Netease    (tools\netease, port 3202)
echo.
echo   Main project deps are installed separately by the website launcher on first run.
echo.
echo   Internet access is required. This may take a few minutes.
echo.

if exist node_modules goto qq_deps
echo [1/3] Installing main project dependencies...
call npm install
if errorlevel 1 goto install_failed

:qq_deps
if exist "tools\qq-api\node_modules" goto netease_deps
if not exist "tools\qq-api\package.json" goto netease_deps
echo.
echo [2/3] Installing QQ Music service deps (tools\qq-api)...
pushd "tools\qq-api"
call npm install
popd
if errorlevel 1 goto install_failed

:netease_deps
if exist "tools\netease\node_modules" goto done
if not exist "tools\netease\package.json" goto done
echo.
echo [3/3] Installing Netease service deps (tools\netease)...
pushd "tools\netease"
call npm install
popd
if errorlevel 1 goto install_failed

:done
echo.
echo ============================================================
echo    Done.
echo ============================================================
echo.
echo   Next steps:
echo     1. Double-click the website launcher to start SONORA.
echo     2. Open the Online Music panel and scan the QR code
echo        to sign in to your own account.
echo.
echo   Login state is saved under tools\*\\.auth-state and stays
echo   on your machine only. It is never uploaded anywhere.
echo.
goto end_success

:no_node
echo.
echo [ERROR] Node.js not found.
echo Please install Node.js 20.19 or newer from https://nodejs.org/
echo then run this script again.
echo.
pause
exit /b 1

:install_failed
echo.
echo [ERROR] Installation failed.
echo Check your internet connection and try again.
echo If npm is slow, consider a mirror:
echo   npm config set registry https://registry.npmmirror.com
echo.
pause
exit /b 1

:end_success
pause
exit /b 0
