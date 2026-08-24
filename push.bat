@echo off
REM ============================================================
REM  Push Living Wallpaper to GitHub (account: adnaanaeem)
REM  This folder is already a git repo with an initial commit.
REM ============================================================
setlocal
echo.
echo Pushing to github.com/adnaanaeem/living-wallpaper ...
echo.

where gh >nul 2>nul
if %errorlevel%==0 (
  echo GitHub CLI found. Creating repo and pushing...
  gh auth status >nul 2>nul || gh auth login
  gh repo create living-wallpaper --public --source . --remote origin --push
  goto done
)

echo GitHub CLI not found.
echo 1^) Create an EMPTY repo at https://github.com/new
echo       Owner: adnaanaeem   Name: living-wallpaper   (no README/license)
echo 2^) Then this script will add the remote and push:
echo.
git remote remove origin 1>nul 2>nul
git remote add origin https://github.com/adnaanaeem/living-wallpaper.git
git branch -M main
git push -u origin main

:done
echo.
echo Done. Watch the build at:
echo   https://github.com/adnaanaeem/living-wallpaper/actions
echo To publish a release + installer, tag a version:
echo   git tag v1.0.0  ^&^&  git push origin v1.0.0
pause
endlocal
