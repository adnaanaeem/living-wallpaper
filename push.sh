#!/usr/bin/env bash
# Push Living Wallpaper to GitHub (account: adnaanaeem).
# This folder is already a git repo with an initial commit.
set -e
echo "Pushing to github.com/adnaanaeem/living-wallpaper ..."

if command -v gh >/dev/null 2>&1; then
  gh auth status >/dev/null 2>&1 || gh auth login
  gh repo create living-wallpaper --public --source . --remote origin --push
else
  echo "GitHub CLI not found."
  echo "1) Create an EMPTY repo at https://github.com/new (owner: adnaanaeem, name: living-wallpaper)"
  echo "2) Pushing with plain git:"
  git remote remove origin 2>/dev/null || true
  git remote add origin https://github.com/adnaanaeem/living-wallpaper.git
  git branch -M main
  git push -u origin main
fi

echo "Done. Build: https://github.com/adnaanaeem/living-wallpaper/actions"
echo "Release + installer:  git tag v1.0.0 && git push origin v1.0.0"
