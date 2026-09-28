@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.19 or newer, then run this file again.
  pause
  exit /b 1
)
node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=19)?0:1)"
if errorlevel 1 (
  echo Node.js 22.19 or newer is required.
  pause
  exit /b 1
)
if not exist node_modules\office-addin-debugging (
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo Dependency installation failed. Check your network or company npm settings.
    pause
    exit /b 1
  )
)
call npm start
if errorlevel 1 echo Excel registration failed. See README.md for the shared catalog option.
pause
