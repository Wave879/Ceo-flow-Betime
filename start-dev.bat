@echo off
echo ========================================
echo  TeamFlow Pro - Setup and Run
echo ========================================
echo.

echo [1/3] Installing dependencies...
call npm install --no-fund --no-audit
if %errorlevel% neq 0 (
  echo ERROR: npm install failed!
  pause
  exit /b %errorlevel%
)

echo.
echo [2/3] Starting dev server...
echo Open http://localhost:5173 in your browser
echo.
call npm run dev
pause
