# Push to GitHub & build the .exe in the cloud

This folder is **already a git repository** with an initial commit made as
**adnaanaeem `<jbsia.dani@gmail.com>`** on branch `main`. You just need to push it to
your GitHub account — then GitHub Actions builds the Windows installer for you on a
`windows-latest` runner (no local build, no Rust/Visual Studio needed on your PC).

## Fastest: run the helper script
- **Windows:** double-click **`push.bat`** (or run it in a terminal).
- **macOS/Linux:** `bash push.sh`

The script uses the GitHub CLI if present (creates the repo and pushes in one step),
otherwise it prints the two commands to finish manually.

## Manual — GitHub CLI
```bash
gh auth login                 # sign in as adnaanaeem
gh repo create living-wallpaper --public --source . --remote origin --push
```

## Manual — plain git
1. Create an **empty** repo at https://github.com/new
   (owner **adnaanaeem**, name **living-wallpaper**, no README/license).
2. Then:
```bash
git remote add origin https://github.com/adnaanaeem/living-wallpaper.git
git branch -M main
git push -u origin main
```

## Watch the build / get the .exe
- Repo → **Actions** tab → “Build Windows installer” run → **Artifacts** →
  download `LivingWallpaper-windows` (contains the installer `.exe`).
- For a public download link, cut a release:
  ```bash
  git tag v1.0.0 && git push origin v1.0.0
  ```
  The workflow attaches the installer to a Release automatically.

## How the CI build works (FYI)
The wallpaper-behind-icons feature uses `electron-as-wallpaper`, which compiles a small
**Rust (Neon / N-API)** native module at install time. The workflow therefore:
1. sets up Node 20 **and the Rust toolchain**,
2. runs `npm install` (compiles the native module — N-API means no electron-rebuild),
3. runs `npm run dist` (electron-builder → NSIS installer in `dist/`).

No secrets to configure — it uses the automatic `GITHUB_TOKEN`.

## Notes
- **Local dev is optional.** If you *want* to run it on your own machine with
  `npm start`, you'll need Node + the **Rust toolchain** + **VS Build Tools** (for the
  native module). Most people can skip this and just download the CI `.exe`.
- The build is **unsigned**, so SmartScreen may warn on first run (More info → Run anyway).
  Real code signing needs a paid certificate — ask if you want it wired in.
