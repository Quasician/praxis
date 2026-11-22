@echo off
title Day Planner
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js isn't installed yet.
  echo   1. Get the LTS version from https://nodejs.org and install it
  echo   2. Double-click "Start Day Planner" again
  echo.
  start "" https://nodejs.org
  pause
  exit /b
)

node server.js --open
pause
