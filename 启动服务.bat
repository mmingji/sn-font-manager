@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title snfont manager - local server
cd /d "%~dp0"

rem ===== Environment pre-checks =====
rem NOTE: keep all comments/echo ASCII only. This file is saved as UTF-8 without BOM;
rem cmd parses it in the local ANSI codepage, so Chinese comment lines get mangled
rem into broken commands (2026-09 hit this). chcp 65001 below only fixes the runtime
rem output of node (server.mjs logs Chinese), not how cmd reads THIS file.
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] Node.js not found. Please install: https://nodejs.org/
  pause
  exit /b 1
)

rem Pre-check the build output: dist is in .gitignore (a git clone or an incomplete
rem folder copy has no dist). Show a clear hint instead of starting a 404 server.
if not exist "%~dp0dist\index.html" (
  echo [ERROR] dist\index.html not found - the app is not built yet.
  echo         Build it first:  npm install ^&^& npm run build
  echo         Or use the portable version: double-click dist\index.html directly.
  pause
  exit /b 1
)

rem ===== Port selection =====
rem Probe from 2333 upward. If the port already serves THIS app, reuse it (do not
rem start a second copy); if it is taken by unrelated software or a stale server,
rem fall back to the next free port (2334, 2335, ...).
rem Probe with node net.connect (lighter than netstat, no PowerShell dependency).
rem IMPORTANT: inside if-blocks always use !var! (delayed expansion) - %var% is
rem expanded once when the block is entered, which freezes errorlevel/PORT checks.
set PORT=2333
:findport
node -e "var n=require('net');var s=n.connect({port:!PORT!,host:'127.0.0.1',timeout:1200});s.on('connect',function(){console.log('BUSY');process.exit(0)});s.on('error',function(){console.log('FREE');process.exit(0)});s.on('timeout',function(){s.destroy();console.log('FREE');process.exit(0)})" > %temp%\snfont_port.txt 2>nul
set /p PORT_STATE=<%temp%\snfont_port.txt
if "!PORT_STATE!"=="BUSY" (
  rem Reuse only when this port serves this app (dist/index.html mounts Vue at id="app")
  node -e "var q=require('http').get('http://127.0.0.1:!PORT!/',function(r){var b='';r.on('data',function(d){b+=d});r.on('end',function(){process.exit(b.indexOf('id=\"app\"')>=0?0:1)})});q.on('error',function(){process.exit(1)});q.setTimeout(1500,function(){q.destroy();process.exit(1)})" >nul 2>nul
  if !errorlevel! equ 0 (
    echo [INFO] Server already running on port !PORT! - opening it.
    start "" "http://localhost:!PORT!/"
    pause
    exit /b 0
  )
  if !PORT! GEQ 2400 (
    echo [ERROR] Ports 2333-2400 are all in use.
    echo         Find what occupies them:  netstat -ano ^| findstr :2333
    pause
    exit /b 1
  )
  set /a PORT=!PORT!+1
  goto findport
)

echo ============================================
echo  snfont icon manager - local server
echo  URL: http://localhost:!PORT!
echo  Stop: press Ctrl+C in this window, or close it.
echo  Note: this runs the BUILT files from dist\ -
echo        after changing source code, run: npm run build
echo        (for live source with hot reload, use: npm run dev)
echo ============================================
echo.
start "" "http://localhost:!PORT!/"
rem Single-window mode: the server runs in the FOREGROUND of this bat, so this
rem window IS the server window - Ctrl+C or closing it stops the service.
rem (No hidden/separate node process anymore: stopping it was always confusing.)
node server.mjs !PORT!
echo.
echo Server exited.
pause
