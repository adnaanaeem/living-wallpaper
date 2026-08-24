# Living Wallpaper — Claude Handoff

A living desktop wallpaper: **one scene that moves through sunrise → noon → sunset →
night in real time**, with **live rain/snow**, **temperature-driven visuals**, an
on-screen **weather panel**, **four illustrated scenes** (Mountains, City, Beach,
Desert), and an option to **relight your own photo** through the day.

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
│  ├─ preload.js         ← safe IPC bridge for the settings window
│  ├─ config.js          ← JSON config load/save (%APPDATA%) + toRenderer()
│  ├─ desktop-win.js     ← optional koffi FFI: fullscreen detection (game pause)
│  ├─ settings.html      ← tray settings UI (scene picker, units, clock, map, monitors…)
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

> **Generated files:** `src/wallpaper.html` and `lively/index.html` are produced by
> `tools/build-wallpaper.js`. Never edit them directly — edit `tools/engine-source.html`
> and/or `tools/prod-boot.js`, then re-run the build.

---

## 3. Architecture

### 3.1 The scene engine (`tools/engine-source.html`)
A single `<canvas>` with a `requestAnimationFrame` loop (`draw()`), all pure functions:

- **Time model:** `minutes` in 0–1440. `skyAt(m)` interpolates keyframed sky palettes
  (zenith / mid / horizon). `sunInfo(m)` / `moonInfo(m)` give arc position + altitude.
- **Shared layers (all scenes):** sky gradient, horizon glow tracking the sun/moon,
  stars + Milky Way at night, sun/moon discs & bloom, soft volumetric clouds.
- **Swappable landscape:** `drawLandscape()` dispatches on the global `SCENE` to
  `drawSceneMountains / City / Beach / Desert`. Seeded geometry is built in
  `buildScenes()` (called from `resize()`).
- **Weather & temperature (shared):** `rainLevel` smoothing; temperature factors
  `cold / freeze / heat`; precipitation renders as **rain** or **snow** depending on
  temperature; `snowCover` whitens scenes; heat adds a horizon **heat-haze**; a
  cool/warm colour grade overlays everything.
- **Photo mode:** `drawPhotoScene()` relights a photo with multiply (brightness/temp),
  soft-light (golden hour), and screen (sun/moon bloom) passes. Multi-photo cross-fade
  is handled by an override in `prod-boot.js`.
- **HUD:** glass weather card (location, big temp + condition icon, clock+date, chips for
  feels-like / humidity / wind / precip).

Open `engine-source.html` in a browser to develop: seek bar, scene dropdown, Rain
toggle, temperature slider, photo add, Live-weather button.

### 3.2 Production layer (`tools/prod-boot.js`)
An IIFE appended after the engine that turns the demo into a real wallpaper:
- Drives the **real system clock** (updates every 15 s); overrides `fmt()` for 12/24h.
- **Auto weather:** IP geolocation (`ipwho.is`) → Open-Meteo current conditions; refresh
  every 10 min. Overrides `updateHUD()` to apply unit conversions.
- **Scene resolver:** maps `mountains|city|beach|desert|rotate|random` → the engine's
  `SCENE` (rotate = day-of-year, random = per launch).
- **Config:** reads `window.LW_CONFIG` (Electron injects it) with defaults; listens for
  `lw-config`, `lw-pause`, `lw-resume` events; exposes `livelyPropertyListener` +
  `livelyWallpaperPlaybackChanged` for Lively.
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
  "scene":    "mountains|city|beach|desert|rotate|random",
  "showHud":  true,
  "photo":    "C:\\path\\img.jpg | null",     // single photo
  "photos":   ["...","..."] ,                  // ordered set -> day cross-fade
  "location": { "lat": 0, "lon": 0, "name": "City, CC" } | null,  // null = auto (IP)
  "monitor":  "all | <displayId>",
  "autostart": false,
  "pauseOnFullscreen": true
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
- ✅ Four scenes + Rotate/Random; thumbnail picker in settings; scene dropdown in Lively.
- ✅ Photo relight (single) + multi-photo day cross-fade.
- ✅ Standalone Electron app: WorkerW attach, tray, settings, autostart, multi-monitor
  (spans extended desktop), game-pause.
- ✅ Lively pack: manifest, properties, animated preview.gif, thumbnail, photo via
  folderDropdown, map-free city label.
- ✅ Settings map location picker (Leaflet + OSM).
- ✅ Icons (icon.ico / tray.png) generated.
- ✅ GitHub Actions CI (Rust + Node → NSIS installer, release on tag). Deps verified.
- ✅ CI regenerates `lively/index.html` and packages `LivingWallpaper-Lively.zip` on
  every build, attaching it to the Release next to the `.exe` — same commit, both
  artifacts, so the Lively pack can't drift out of sync again.
- ✅ Multi-monitor fixed: one window per display instead of one window spanning the
  union of all displays (the latter didn't attach reliably — see §8).
- ✅ Uninstall fixed: NSIS `customInit`/`customUnInit` force-kill the running app so it
  can't survive an uninstall.
- ✅ Settings toggle switches (info panel / pause-on-fullscreen / start-with-Windows)
  fixed — they were unclickable (see §8).
- ✅ Tray **About…** window (app info + live GitHub developer card).
- ✅ README has a download badge, build-status badge, and a screenshot gallery
  (`assets/screenshots/`, excluded from the packaged app via `build.files`).

## 7. Roadmap — what's PLANNED / next
- ⬜ **Code signing** — sign the `.exe` (needs a paid cert); wire cert as a CI secret so
  SmartScreen stops warning. (Workflow is structured to drop this in.)
- ⬜ **Per-scene Lively previews** — not possible inside Lively's Customize dialog;
  consider a standalone "Scene Gallery" HTML so Lively users can preview before picking.
- ⬜ **More scenes** — Forest/Hills, Countryside, Snowy village, Aurora (night), Rainforest.
  Add via the 5-step recipe in `tools/README.md`.
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
- ⬜ **Distribution** — Microsoft Store / winget listing; auto-update via electron-builder
  (`latest.yml` already produced by the release job).

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
- `package.json`'s `dist` script must keep `--publish never`. Because `package.json` has
  a `repository` field and CI sets `GH_TOKEN`, electron-builder's default
  `onTagOrDraft` publish policy will otherwise auto-publish the GitHub Release **itself**
  on a tag push, uploading the installer a second time under its own sanitized filename
  (dots instead of hyphens) alongside the workflow's explicit release step — same file,
  two names, one release.

## 9. Continuing with Claude
Point Claude at this file first. Good next asks: "add a Forest scene", "add fog + lightning
to storms", "compute real sunrise/sunset from location", "wire code signing into CI",
"start the Android WallpaperService port". Always run `node tools/build-wallpaper.js`
after engine/prod-boot edits.
