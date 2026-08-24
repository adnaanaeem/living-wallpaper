# Living Wallpaper — Claude Handoff

A living desktop wallpaper: **one scene that moves through sunrise → noon → sunset →
night in real time**, with **live rain/snow**, **temperature-driven visuals**, an
on-screen **weather panel**, **seven illustrated scenes** (Mountains, City, Beach,
Desert, Forest, Aurora, Snowy Village), rare weather delights (shooting stars,
post-rain rainbows), optional **ambient audio**, and an option to **relight your own
photo** through the day.

This doc is the single source of truth for picking the project back up — what's built,
how it fits together, how to run/develop it, and what's planned. Copy this whole folder
to your drive and keep going.

---

## 1. Two ways it ships

| | Standalone app (`src/`) | Lively pack (`lively/`) |
|---|---|---|
| Runs as | Real `.exe`, renders behind desktop icons via `electron-as-wallpaper` (Windows WorkerW) | HTML wallpaper inside the free **Lively Wallpaper** app |
| Needs | Nothing extra (build the exe) | Lively installed |
| Custom photo | Native file picker, any path | Lively **folderDropdown** (copies image in); pasted paths are blocked by Chromium |
| Multi-monitor | Built-in — one window per display ("All monitors" or pick one) | Configured in Lively's own UI |
| Game-pause | Built-in (koffi fullscreen detection) | Lively's own pause |

Both render the **same scene engine**. The engine is authored once and compiled to two
HTML files by `tools/build-wallpaper.js`.

---

## 2. Repo layout

```
LivingWallpaper/
├─ CLAUDE-HANDOFF.md      ← you are here
├─ README.md             ← end-user install/build guide
├─ SETUP-GITHUB.md       ← push + CI instructions
├─ package.json          ← Electron app manifest + electron-builder config
├─ push.bat / push.sh    ← one-step GitHub push helpers
├─ nsis/installer.nsh    ← NSIS hooks: force-kill the app before install/uninstall
├─ .github/workflows/build.yml   ← CI: builds the .exe + LivingWallpaper-Lively.zip on
│                                    tag/push, publishes both to the Release on a tag
│
├─ src/                  ← the STANDALONE Electron app
│  ├─ main.js            ← main process: wallpaper windows, WorkerW attach, tray,
│  │                       settings IPC, config, autostart, game-pause polling
│  ├─ preload.js         ← safe IPC bridge for the settings + about windows
│  ├─ config.js          ← JSON config load/save (%APPDATA%) + toRenderer()
│  ├─ desktop-win.js     ← optional koffi FFI: fullscreen detection (game pause)
│  ├─ settings.html      ← tray settings UI (scene picker, units, clock, map, monitors…)
│  ├─ about.html         ← tray About window (app info + live GitHub developer card)
│  ├─ preview.html       ← GENERATED tray Preview window: 24h seek bar + weather demo
│  │                       (do not hand-edit; see tools/) — same file as the dev demo,
│  │                       just retitled
│  └─ wallpaper.html     ← GENERATED renderer (do not hand-edit; see tools/)
│
├─ lively/               ← the LIVELY pack
│  ├─ index.html         ← GENERATED renderer (identical to src/wallpaper.html)
│  ├─ LivelyInfo.json    ← wallpaper manifest (Type 1 = web)
│  ├─ LivelyProperties.json ← Customize controls (scene, units, clock, photo, city…)
│  ├─ thumbnail.jpg / preview.gif ← library art
│  └─ backgrounds/       ← folder Lively copies user photos into
│
├─ assets/               ← icon.ico, icon-256.png, tray.png, scenes/*.jpg (thumbnails)
│
└─ tools/                ← DEV pipeline (see tools/README.md)
   ├─ engine-source.html ← THE scene engine + live preview (edit scenes here)
   ├─ prod-boot.js       ← production layer injected on top of the engine
   ├─ build-wallpaper.js ← regenerates src/wallpaper.html + lively/index.html
   ├─ gen-assets.js, gen-scene-thumbs.js, gen-preview.js, render-scenes.js
   └─ package.json       ← tooling deps (@napi-rs/canvas, png-to-ico, gif-encoder-2)
```

> **Generated files:** `src/wallpaper.html`, `lively/index.html`, `src/preview.html`, and
> `docs/index.html` are produced by `tools/build-wallpaper.js`. Never edit them directly
> — edit `tools/engine-source.html` and/or `tools/prod-boot.js`, then re-run the build.

---

## 3. Architecture

### 3.1 The scene engine (`tools/engine-source.html`)
A single `<canvas>` with a `requestAnimationFrame` loop (`draw()`), all pure functions:

- **Time model:** `minutes` in 0–1440. `skyAt(m)` interpolates keyframed sky palettes
  (zenith / mid / horizon). `sunInfo(m)` / `moonInfo(m)` give arc position + altitude.
- **Shared layers (all scenes):** sky gradient, horizon glow tracking the sun/moon,
  stars + Milky Way at night, sun/moon discs & bloom, soft volumetric clouds.
- **Swappable landscape:** `drawLandscape()` dispatches on the global `SCENE` to
  `drawSceneMountains / City / Beach / Desert / Forest / Aurora / Village`. Seeded
  geometry is built in `buildScenes()` (called from `resize()`). Forest reuses
  `drawPine()` in three depth layers + fireflies; Aurora reuses `drawRange()`/`ridge()`
  for permanently-snowy hills plus its own animated ribbon bands
  (`drawAuroraRibbons()`); Village is small lit cabins (`drawCabin()`) with snow-capped
  roofs, reusing the shared `trees` array for foreground pines.
- **Weather & temperature (shared):** `rainLevel` smoothing; temperature factors
  `cold / freeze / heat`; precipitation renders as **rain** or **snow** depending on
  temperature; `snowCover` whitens scenes; heat adds a horizon **heat-haze**; a
  cool/warm colour grade overlays everything.
- **Rare weather events (shared, in `draw()`):** shooting stars spawn at low random
  chance on clear night skies (`starA>0.5`) and animate as a fading streak
  (`shootingStars` array). A rainbow (`rainbowLevel`) triggers when `rainLevel` is
  detected tapering off (`prevRainLevel>rainLevel`) while the sun is reasonably high,
  then fades out over roughly a minute or two.
- **Ambient audio (`Sound` object, off by default):** procedural Web Audio — no asset
  files. Filtered white-noise buffers for rain (bandpass) and wind (lowpass), gains
  driven each frame by `Sound.update(dt, rainLevel, isSnow, night, cold)`; scheduled
  oscillator chirps for crickets on clear, mild, rainless nights. `Sound.setEnabled()`
  lazily creates the `AudioContext` on first enable (see `main.js`'s
  `autoplay-policy` switch in §3.3 for why the wallpaper window needs that).
- **Photo mode:** `drawPhotoScene()` relights a photo with multiply (brightness/temp),
  soft-light (golden hour), and screen (sun/moon bloom) passes. Multi-photo cross-fade
  is handled by an override in `prod-boot.js`.
- **HUD:** glass weather card (location, big temp + condition icon, clock+date, chips for
  feels-like / humidity / wind / precip). It's a DOM overlay (`#hud` div), **not** drawn
  into the canvas — matters if you ever want to screenshot the full look including the
  HUD (see §8's canvas-screenshot workaround, which composites it in via an SVG
  `foreignObject`).

Open `engine-source.html` in a browser to develop: seek bar, scene dropdown, Rain
toggle, Sound toggle, temperature slider, photo add, Live-weather button.

### 3.2 Production layer (`tools/prod-boot.js`)
An IIFE appended after the engine that turns the demo into a real wallpaper:
- Drives the **real system clock** (updates every 15 s); overrides `fmt()` for 12/24h.
- **Auto weather:** IP geolocation (`ipwho.is`) → Open-Meteo current conditions; refresh
  every 10 min. Overrides `updateHUD()` to apply unit conversions.
- **Scene resolver:** maps `mountains|city|beach|desert|forest|aurora|village|rotate|
  random` (`SCENE_LIST`) → the engine's `SCENE` (rotate = day-of-year, random = per
  launch).
- **Config:** reads `window.LW_CONFIG` (Electron injects it) with defaults; listens for
  `lw-config`, `lw-pause`, `lw-resume` events; exposes `livelyPropertyListener` +
  `livelyWallpaperPlaybackChanged` for Lively.
- **Sound:** `applySound()` calls the engine's `Sound.setEnabled(!!CONFIG.sound)` — see
  §3.1's Sound engine note. Wired into `applyConfig()`, Lively's `sound` checkbox
  property, and boot.
- **Photo:** single or cross-fade set; `toFileUrl()` handles quotes/spaces/relative paths.

### 3.3 Electron shell (`src/`)
- `main.js` creates **one borderless, focusable=false BrowserWindow per target display**
  (never a single window spanning multiple monitors — see §8) and calls `attach()` from
  **electron-as-wallpaper** to reparent each one behind the icons. Tray menu (Settings /
  Pause / Reload / autostart / Quit). Pushes config into the renderer via
  `executeJavaScript`. Polls `desktop-win.isForegroundFullscreen()` every 3 s to pause on
  games.
- `nsis/installer.nsh` (`customInit` / `customUnInit`) force-kills any running
  `Living Wallpaper.exe` before install, upgrade, or uninstall — otherwise the wallpaper
  window can survive an uninstall and stay stuck on screen.
- `config.js` persists `%APPDATA%/Living Wallpaper/config.json`.
- `settings.html` is the tray UI: scene **thumbnail picker**, units, 12/24h clock,
  photo(s), location (**Leaflet map** click or city search), monitor, autostart,
  game-pause.
- `about.html` is the tray **About…** window: app name/version/description come from
  `package.json` via `lw:get-app-info`; the developer card fetches
  `https://api.github.com/users/<author>` directly from the renderer (same pattern as
  the weather calls — no IPC proxy needed) and falls back to static text if offline.
  External links go through `lw:open-external`, which only allows `https://github.com/…`
  URLs — the renderer never gets a raw `shell.openExternal`.
- **Auto-update:** `electron-updater`'s `autoUpdater` checks GitHub Releases (config in
  `package.json`'s `build.publish` — same repo, no token needed since it's public) on
  launch and every 6h, plus on demand via tray **Check for Updates…**. `autoDownload` is
  off; both the download and the restart-to-install are gated behind a confirmation
  dialog. Only works in a packaged install (`app.isPackaged`) — a no-op message under
  `npm start`. Needs `latest.yml` + the `.exe` + `.blockmap` on the release, which CI
  already produces and attaches (see §6.1). `build.publish` is metadata only — it does
  **not** reintroduce the double-publish bug from `v1.0.2`, because `dist` still runs
  with `--publish never`, which overrides any publish policy regardless of config.
- `preview.html` is the tray **Preview…** window: `tools/engine-source.html`'s own demo
  panel (seek bar 0–1440 min, temperature slider, scene dropdown, rain toggle, play/
  real-time/live-weather buttons) was already exactly the "scrub the day and test
  weather" UI end users want, so `build-wallpaper.js` ships it as-is (just retitled) —
  no IPC bridge, no preload, self-contained like the dev demo. It's a normal resizable
  window (not attached behind icons) and doesn't touch `cfg`/the real wallpaper windows.
- `docs/index.html` is the **public live demo** — the same panel again, retitled, plus a
  small "View on GitHub / Download" link since visitors may land here from search or a
  shared link, not just the README. Served by **GitHub Pages** ("deploy from branch",
  `main` / `/docs` — no Actions workflow needed; Pages redeploys on its own whenever
  `docs/` changes on `main`) at `https://adnaanaeem.github.io/living-wallpaper/`.
  `docs/.nojekyll` skips GitHub's default Jekyll processing.

### 3.4 Native dependency note (important)
`electron-as-wallpaper@^2` compiles a **Rust (Neon / N-API)** module at `npm install`.
- N-API ⇒ **no electron-rebuild** needed.
- Building requires the **Rust toolchain** (+ VS Build Tools on Windows). The CI runner
  installs Rust automatically; local `npm start` needs it too.
`koffi` (used only for game-pause fullscreen detection) ships **prebuilt** — no compiler.

---

## 4. Config schema (`config.json` / `LW_CONFIG`)
```jsonc
{
  "units":    { "temp": "C|F", "wind": "kmh|mph" },
  "clock":    "12|24",
  "scene":    "mountains|city|beach|desert|forest|aurora|village|rotate|random",
  "showHud":  true,
  "photo":    "C:\\path\\img.jpg | null",     // single photo
  "photos":   ["...","..."] ,                  // ordered set -> day cross-fade
  "location": { "lat": 0, "lon": 0, "name": "City, CC" } | null,  // null = auto (IP)
  "monitor":  "all | <displayId>",
  "autostart": false,
  "pauseOnFullscreen": true,
  "sound":    false          // ambient rain/wind/cricket audio, off by default
}
```
Weather: **Open-Meteo** (no key). Reverse geocode: **BigDataCloud**. IP locate:
**ipwho.is**. City search: **Open-Meteo geocoding**. All keyless, CORS-friendly.

---

## 5. Run & build

### Develop the visuals
Open `tools/engine-source.html` in a browser. Edit scenes there, then:
```bash
node tools/build-wallpaper.js      # regenerate src/wallpaper.html + lively/index.html
```

### Run the standalone app
```bash
npm install          # needs Rust toolchain for the native module
npm start
```

### Build the installer
```bash
npm run dist         # electron-builder -> NSIS .exe in dist/
```
…or just push to GitHub and let CI build it (see `SETUP-GITHUB.md`).

### Lively
Import `lively/` (zip its contents, or select `index.html`). Customize for scene/units/etc.

---

## 6. Status — what's DONE
- ✅ Day-cycle engine (sky, sun/moon arc, stars/Milky Way, clouds) with realistic grading.
- ✅ Live rain + snow (temperature-based), snow cover, frost, heat-haze, cold/warm grade.
- ✅ Live weather + HUD (IP location, Open-Meteo), 12/24h clock, °C/°F, km/h/mph.
- ✅ Seven scenes (Mountains, City, Beach, Desert, Forest, Aurora, Snowy Village) +
  Rotate/Random; thumbnail picker in settings; scene dropdown in Lively.
- ✅ Rare weather delights — shooting stars on clear nights, a rainbow that fades in
  after rain tapers off in daylight and fades back out over a minute or two.
- ✅ Optional ambient audio — procedural rain/wind/cricket sound (no asset files), off
  by default, toggle in Settings/Lively/config.
- ✅ Photo relight (single) + multi-photo day cross-fade.
- ✅ Standalone Electron app: WorkerW attach, tray, settings, autostart, multi-monitor
  (one window per display), game-pause.
- ✅ Lively pack: manifest, properties, animated preview.gif, thumbnail, photo via
  folderDropdown, map-free city label.
- ✅ Settings map location picker (Leaflet + OSM).
- ✅ Icons (icon.ico / tray.png) generated.
- ✅ GitHub Actions CI (Rust + Node → NSIS installer, release on tag). Deps verified.
- ✅ CI regenerates `lively/index.html` and packages `LivingWallpaper-Lively.zip` on
  every build, attaching it to the Release next to the `.exe` — same commit, both
  artifacts, so the Lively pack can't drift out of sync again.
- ✅ Multi-monitor fixed: one window per display instead of one window spanning the
  union of all displays (the latter didn't attach reliably — see §8). **Confirmed fixed
  by the user on real mixed-DPI hardware (125% primary + differently-scaled secondary)
  in `Living.Wallpaper.Setup.1.0.3.exe`** — both monitors now show the scene, no sliver
  of the old wallpaper left on the edge.
- ✅ Uninstall fixed: NSIS `customInit`/`customUnInit` force-kill the running app so it
  can't survive an uninstall.
- ✅ Settings toggle switches (info panel / pause-on-fullscreen / start-with-Windows)
  fixed — they were unclickable (see §8).
- ✅ Tray **About…** window (app info + live GitHub developer card).
- ✅ Tray **Preview…** window — 24h seek bar, temperature slider, scene picker, rain
  toggle, so users can check the animation/weather without waiting for real time.
- ✅ Auto-update from GitHub Releases (`electron-updater`), confirmation-gated, tray
  **Check for Updates…** for a manual check.
- ✅ Public live demo on GitHub Pages (`docs/index.html`), linked from the README.
- ✅ README has direct-download badges (installer + Lively zip), a build-status badge,
  a 10s trailer GIF (`assets/trailer.gif`, cycles all 7 scenes with the HUD, captured
  from the real engine), and a 7-image screenshot gallery (`assets/screenshots/`,
  excluded from the packaged app via `build.files`).

### 6.1 Release history — what shipped and how

The first public push (`v1.0.0`) went out with the extended-monitor bug already in it
(one window spanning the union of all displays). Everything from `v1.0.1` on is a fix
found by using the app on real mixed-DPI hardware and reading the actual failure, not a
guess:

- **`v1.0.1` — extended monitor showed the plain Windows wallpaper.** Root cause: `all`
  monitor mode created a *single* `BrowserWindow` sized to the bounding box of every
  display and handed it to `electron-as-wallpaper`'s `attach()`. That reparents a window
  behind the icons via `SetParent` into `WorkerW`, but a window straddling two monitors
  with different resolution/DPI doesn't attach reliably — the secondary monitor just kept
  showing the old wallpaper untouched. Fix: `targetBounds()` now returns one bounds entry
  **per display**, so `createWallpaperWindows()` (already a loop) creates and attaches a
  separate window per monitor instead of one big one. This was the structural fix but
  turned out to be only half of it — see `v1.0.3`.
- **`v1.0.2` — uninstalling left the wallpaper stuck on screen.** The NSIS uninstaller
  removed files but never stopped the running process, so the WorkerW-attached window
  (and 3-4 renderer processes) survived the uninstall. Fix: `nsis/installer.nsh` adds
  `customInit`/`customUnInit` macros that `taskkill /F /IM "Living Wallpaper.exe" /T`
  before install, upgrade, *and* uninstall. Also fixed in the same release: the GitHub
  Release was getting the installer uploaded **twice** under two different names, because
  electron-builder's own default publish policy (`onTagOrDraft`) was auto-publishing the
  release itself in addition to the workflow's explicit `softprops/action-gh-release`
  step — fixed by adding `--publish never` to the `dist` script so only the workflow step
  publishes.
- **`v1.0.3` — the per-monitor fix from `v1.0.1` still left a thin sliver of the old
  wallpaper on one monitor's edge.** This user's setup has different DPI scale factors
  per monitor (125% primary + a different scale on the secondary). Electron/Chromium can
  create a `BrowserWindow` with the wrong *initial* DPI context when its `x`/`y` land on
  a monitor scaled differently than the primary, so it renders undersized on that
  monitor even though its bounds are numerically correct. `electron-as-wallpaper`'s
  `attach()` was ruled out first by reading its Rust source (`src/attach.rs`) — it only
  calls `SetParent`, never touches size or position, so the bug had to be upstream of it.
  Fix: call `win.setBounds(b)` again right after creating the window (and once more on
  `did-finish-load`) to force Chromium to redo layout once it knows which monitor it's
  really on. Also in this release: the three Settings toggle switches (info panel /
  pause-on-fullscreen / start-with-Windows) were completely unclickable — the checkbox
  was `display:none` inside a plain `<span class="switch">` instead of a `<label>`, so
  clicks on the visible track never reached the checkbox. **User-confirmed fixed** on the
  real extended-monitor setup after installing this build.
- **`v1.0.4` — no functional fixes, tooling/polish only.** README got a download badge
  (links to `/releases/latest`), a CI build-status badge, and a 5-image screenshot
  gallery (captured by driving the scene engine's demo headlessly and compositing the
  DOM weather-HUD onto the canvas via an SVG `foreignObject`, rather than reusing the
  user's real desktop screenshots, to keep personal file/folder names out of the public
  repo). The tray gained an **About…** window with live GitHub developer info.
- (Landed alongside `v1.0.2`/`v1.0.3`, not its own tag) **CI now builds and attaches
  `LivingWallpaper-Lively.zip`** on every run — regenerates `lively/index.html` from the
  current engine, zips it, and attaches it to the tagged Release next to the `.exe` — so
  the Lively pack can never drift out of sync with the standalone app again.
- **`v1.0.5` — two feature requests, no bug fixes.** Tray **Preview…** window: rather
  than build a new scrub-the-day UI, `tools/build-wallpaper.js` now also ships
  `tools/engine-source.html`'s existing demo panel as `src/preview.html` (just
  retitled) — it already had exactly the seek bar / temperature slider / scene picker /
  rain toggle that was asked for. And **auto-update**: `electron-updater` checks GitHub
  Releases on launch, every 6h, and on demand (tray **Check for Updates…**); download
  and restart-to-install are each gated behind a confirmation dialog, nothing happens
  silently. Needed `build.publish` (owner/repo) added to `package.json` purely as
  metadata for the packaged app to know where to check — confirmed this doesn't
  resurrect the `v1.0.2` double-publish bug because `--publish never` on the `dist`
  script overrides any publish policy regardless of that config being present.
- (Repo/docs only, not a tagged release) **Public live demo via GitHub Pages** —
  `docs/index.html`, linked from the README's "Try the live demo" badge/link.
- **`v1.0.6` — auto-update from `v1.0.5` was silently broken, found while verifying the
  release rather than by a user report.** Two compounding bugs: (1) the release-publish
  step's `files:` glob never included `dist/*.blockmap` (only the CI artifact upload
  did), so `electron-updater`'s NSIS differential-update file was never actually on the
  GitHub Release; (2) worse, the installer's `latest.yml` referenced
  `Living-Wallpaper-Setup-1.0.5.exe` (hyphens — electron-builder sanitizes the `url:`
  field), but the real file on disk was `Living Wallpaper Setup 1.0.5.exe` (spaces —
  the unmodified default `artifactName`), and GitHub itself renamed it a **third** way on
  upload (`Living.Wallpaper.Setup.1.0.5.exe` — GitHub replaces spaces in asset names
  with dots). Three different names for one file meant `electron-updater` could never
  have found the installer to download, on any release up through `v1.0.5`. Fixed by
  setting `nsis.artifactName` to a fixed, space-free, **unversioned**
  `"Living-Wallpaper-Setup.exe"` — this makes electron-builder generate the exe and
  `latest.yml` with the exact same name every time (no more 3-way mismatch), and as a
  bonus gives the README a permanently stable direct-download link that survives every
  version bump: `.../releases/latest/download/Living-Wallpaper-Setup.exe`. Also added
  `dist/*.blockmap` to the release `files:` glob. **This means auto-update was
  non-functional in `v1.0.5` — don't rely on it having worked before `v1.0.6`.**
  README's download badges were also switched from linking the releases page to linking
  the asset directly (`.../releases/latest/download/<name>`) — one badge for the
  installer, one for the Lively zip (`LivingWallpaper-Lively.zip`, already unversioned
  so no change needed there).

  Also landed in the same `v1.0.6` push (built on the `main` branch, then tagged and
  verified once the build was green): the **rare weather events** (shooting stars,
  post-rain rainbow), **ambient audio** (procedural `Sound` object — see §3.1/§3.3 for
  the `autoplay-policy` command-line switch it needs), and the **three new scenes**
  (Forest, Aurora, Snowy Village) with their settings-picker thumbnails. Also fixed in
  this push: the scene `<select>`'s popup list was unreadable — `.btn`'s background is
  a mostly-transparent `rgba(255,255,255,0.06)`, fine for the closed control against the
  page's dark background, but the native OS popup list falls back to the browser's own
  white background while keeping the light option text, making it nearly invisible.
  Fixed with an explicit opaque dark `background`/`color` on `<option>` (see §8).
  **Verified end-to-end after tagging**: `gh release view v1.0.6` showed all four assets
  (`Living-Wallpaper-Setup.exe`, `.blockmap`, `latest.yml`, `LivingWallpaper-Lively.zip`)
  with `latest.yml`'s `url:` matching the actual asset name exactly, and both README
  direct-download links resolved `302 → 200` via `curl -IL`.
- (Repo/docs only, landed on `main` right after `v1.0.6`, no new tag needed since the
  packaged app didn't change) **Trailer GIF + expanded screenshot gallery.** A ~10s,
  7-frame animated GIF (`assets/trailer.gif`) cycling Mountains (sunset) → City (rainy
  night) → Beach (noon) → Desert (heat-haze) → Forest (fireflies) → Aurora → Snowy
  Village (snowfall), each frame captured from the *actual* engine (not a simplified
  reimplementation) with the real weather HUD composited in via the SVG `foreignObject`
  technique (see §8), then assembled with Pillow (`Image.save(..., save_all=True,
  duration=1400, loop=0)`). Replaced the static hero screenshot as the README's top
  visual. Also added dedicated `assets/screenshots/` shots for Forest/Aurora/Village,
  extending the gallery to all seven scenes; the now-unused `hero-mountains-hud.jpg` was
  deleted.

## 7. Roadmap — what's PLANNED / next
- ⬜ **Code signing** — sign the `.exe` (needs a paid cert); wire cert as a CI secret so
  SmartScreen stops warning. (Workflow is structured to drop this in.)
- ⬜ **Per-scene Lively previews** — not possible inside Lively's Customize dialog;
  consider a standalone "Scene Gallery" HTML so Lively users can preview before picking.
- ⬜ **More scenes** — Countryside, Rainforest. (Forest, Aurora, and Snowy Village have
  shipped — see §6.) Add via the 5-step recipe in `tools/README.md`.
- ⬜ **Richer weather visuals** — fog banks, lightning flashes in storms, wind-driven rain
  angle, falling leaves (autumn), pollen/dust in heat, lake/ground icing when freezing.
- ⬜ **Weather-code driven scene mood** — use Open-Meteo `weather_code` (fog/overcast/
  thunder) to modulate clouds/visibility, not just precipitation.
- ⬜ **Sunrise/sunset accuracy** — compute real sun times from lat/lon/date (currently a
  fixed 06:00–18:30 arc) so the visual day matches the real sky.
- ⬜ **Photo cross-fade UI** — reorder/time-tag photos in settings (currently evenly
  spaced by order).
- ⬜ **Performance** — FPS cap / lower-power mode on battery; pause when display sleeps.
- ⬜ **Android app** — the original goal. Reuse the canvas engine in a `WallpaperService`
  via a WebView, or port `draw()` to Kotlin/Canvas. Weather/location layer reusable.
- ⬜ **Distribution** — Microsoft Store / winget listing. (Auto-update is already done —
  see §6.)

## 8. Gotchas / lessons learned
- `src/wallpaper.html` & `lively/index.html` are **generated** — edit `tools/` sources.
- Lively/Chromium **blocks `file://` images** from arbitrary paths — use Lively's
  folderDropdown (copies the file in) or the standalone's native picker.
- Lively applies to **one monitor by default** — multi-monitor is set in Lively's own UI;
  the standalone spans all displays itself.
- `electron-as-wallpaper` must be **`^2.0.3`** (v1.1.x doesn't exist) and needs **Rust**
  to build. It's **N-API**, so no electron-rebuild.
- Engine globals (`SCENE`, `minutes`, `temperature`, functions) are top-level `let`/decls
  shared across `<script>` blocks — `prod-boot.js` reassigns `fmt`, `drawPhotoScene`,
  `updateHUD`, `SCENE` by name. Keep them top-level.
- **Never create one BrowserWindow spanning multiple monitors.** It doesn't attach
  reliably behind the icons when monitors have different resolution/DPI — the secondary
  monitor just keeps showing the normal Windows wallpaper. Always one window per display.
- **Mixed-DPI monitors:** Electron/Chromium can create a `BrowserWindow` with the wrong
  initial DPI context when its `x`/`y` land on a monitor with a different scale factor
  than the primary, rendering it undersized on that monitor (a thin strip of the old
  wallpaper stays visible at the edge). Fix: call `win.setBounds(b)` again right after
  creation (and again on `did-finish-load`) to force Chromium to re-layout for the
  correct monitor. `electron-as-wallpaper`'s `attach()` itself only does `SetParent` —
  it never touches size/position, so this isn't its bug.
- **`.switch` toggles in `settings.html`:** the real `<input type="checkbox">` is hidden
  (`display:none`) and a decorative `.track` span shows the visual state. That wrapper
  **must be a `<label>`**, not a bare `<span>` — otherwise clicking the visible switch
  never reaches the checkbox and `onchange` never fires. All three toggles were broken
  this way before being fixed.
- **`nsis.artifactName` must stay a fixed, space-free string** (currently
  `"Living-Wallpaper-Setup.exe"`, no `${version}`). electron-builder's `latest.yml`
  sanitizes spaces to hyphens in its `url:`/`path:` fields but does **not** rename the
  actual output file to match, and GitHub separately sanitizes spaces to dots on
  upload — so a space-containing artifactName produces three different filenames for
  the same file and silently breaks `electron-updater` (see `v1.0.6` in §6.1). Leaving
  it unversioned is also what makes the README's direct-download link permanent instead
  of needing an edit every release.
- `package.json`'s `dist` script must keep `--publish never`. Because `package.json` has
  a `repository` field and CI sets `GH_TOKEN`, electron-builder's default
  `onTagOrDraft` publish policy will otherwise auto-publish the GitHub Release **itself**
  on a tag push, uploading the installer a second time under its own sanitized filename
  (dots instead of hyphens) alongside the workflow's explicit release step — same file,
  two names, one release.
- **`<option>` elements need their own explicit `background`/`color`.** A `<select>`
  styled with a translucent background (`.btn`'s `rgba(255,255,255,0.06)`) looks fine
  closed, because it composites over the page, but the native OS popup list isn't part
  of the page — it falls back to the browser's own (usually white) background while
  still inheriting the light text color, making the options unreadable. Set
  `select.btn option { background: #141a2b; color: #e8edf5; }` explicitly.
- **Screenshotting the engine headlessly:** the canvas draws fine via automation, but
  `draw()`'s `dt` (elapsed-time) smoothing means values like `rainLevel` don't snap to a
  new scene's target — they decay/ramp over real elapsed time. Setting `rainOn=false`
  right after a heavy-rain scene can leave visible rain/snow-state artifacts in the next
  capture unless you also zero `rainLevel`/`prevRainLevel`/`rainbowLevel` directly, or
  just do a full page reload between captures. The `#hud` weather card is a DOM overlay,
  not canvas content — compositing it into a screenshot means cloning it, inlining its
  computed styles, wrapping in an SVG `foreignObject`, and drawing that onto a copy of
  the canvas (see the `assets/screenshots/` and `assets/trailer.gif` capture history in
  §6.1 for the working recipe). Also call `syncUI()`/`updateHUD()` after changing
  `SCENE`/`minutes`/`liveWeather` — the canvas picks up new values on the next `draw()`,
  but the HUD's DOM text doesn't refresh until those are called explicitly.

## 9. Continuing with Claude
Point Claude at this file first. Good next asks: "add fog + lightning to storms",
"compute real sunrise/sunset from location", "add a Countryside or Rainforest scene",
"wire code signing into CI", "start the Android WallpaperService port". Always run
`node tools/build-wallpaper.js` after engine/prod-boot edits.
