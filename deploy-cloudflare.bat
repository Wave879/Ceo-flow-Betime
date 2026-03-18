@echo off
set NODE_OPTIONS="--dns-result-order=ipv4first"
echo ========================================
echo  CEO Flow - Deploy to Cloudflare Pages
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
echo [2/3] Building production bundle...
call npm run build
if %errorlevel% neq 0 (
  echo ERROR: Build failed!
  pause
  exit /b %errorlevel%
)

echo.
echo [3/4] Preparing Pages deploy bundle (dist + functions)...
set DEPLOY_DIR=.pages-deploy
if exist %DEPLOY_DIR% rmdir /s /q %DEPLOY_DIR%
mkdir %DEPLOY_DIR%
xcopy dist\* %DEPLOY_DIR%\ /E /I /Y >nul
xcopy functions\* %DEPLOY_DIR%\functions\ /E /I /Y >nul
if %errorlevel% neq 0 (
  echo ERROR: Failed to prepare deploy bundle!
  pause
  exit /b %errorlevel%
)

echo.
echo [4/4] Deploying to Cloudflare Pages...
echo (Browser will open to login if not logged in yet)
call npx wrangler pages deploy %DEPLOY_DIR% --project-name=ceoflow
if %errorlevel% neq 0 (
  echo.
  echo If login is required, it will open in browser automatically.
  echo After login, run this script again.
)

echo.
echo Done! Check the URL above to visit your site.
pause
