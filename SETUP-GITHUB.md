# Publish to GitHub & build the .exe in the cloud

This project ships a GitHub Actions workflow (`.github/workflows/build.yml`) that
builds the Windows installer on a `windows-latest` runner — so you get a `.exe`
**without needing to build locally**. Artifacts are attached to each run, and
pushing a version tag (e.g. `v1.0.0`) also publishes a GitHub **Release** with the
installer attached.

Account used below: **username `adnaanaeem`**, **email `jbsia.dani@gmail.com`**.

## 1) One-time git identity (for this repo)
```bash
cd LivingWallpaper
git init
git config user.name  "adnaanaeem"
git config user.email "jbsia.dani@gmail.com"
git add .
git commit -m "Living Wallpaper: initial commit"
git branch -M main
```

## 2) Create the GitHub repo and push

### Option A — GitHub CLI (easiest)
Install the GitHub CLI (https://cli.github.com), then:
```bash
gh auth login                      # sign in as adnaanaeem
gh repo create living-wallpaper --public --source . --remote origin --push
```

### Option B — Manual
1. Create an empty repo at https://github.com/new named **living-wallpaper**
   (owner: adnaanaeem). Do **not** add a README/license (this repo already has files).
2. Then:
```bash
git remote add origin https://github.com/adnaanaeem/living-wallpaper.git
git push -u origin main
```

## 3) Watch the build
- Go to the repo → **Actions** tab → the “Build Windows installer” run.
- When it finishes, open the run → **Artifacts** → download `LivingWallpaper-windows`
  (contains the `.exe`).

## 4) Cut a release (optional, gives a public download link)
```bash
git tag v1.0.0
git push origin v1.0.0
```
The workflow will build and attach the installer to a Release at
`https://github.com/adnaanaeem/living-wallpaper/releases`.

## Notes
- No secrets to configure — the workflow uses the automatic `GITHUB_TOKEN`.
- The build is **not code-signed**, so Windows SmartScreen may warn on first run
  (“More info → Run anyway”). Code signing needs a paid certificate; ask if you want
  that wired in later.
- `node_modules/` and `dist/` are git-ignored; the runner installs and builds fresh.
