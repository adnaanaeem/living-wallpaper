# Living Wallpaper — Claude Handoff

A living desktop wallpaper: **one scene that moves through sunrise → noon → sunset →
night in real time**, with **live rain/snow**, **temperature-driven visuals**, an
on-screen **weather panel**, **eight illustrated scenes** (Mountains, City, Beach,
Desert, Forest, Aurora, Snowy Village, Waterfall Valley), rare weather delights
(shooting stars, post-rain rainbows), optional **ambient audio**, and an option to
**relight your own photo** through the day.

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
│  ├─ screensaver.js     ← `/s`/`/p`/`/c` argv handling + registry enable/disable (§3.3)
│  ├─ screensaver-preload.js ← forwards input events so `/s` mode exits on activity
│  ├─ lockscreen.js      ← periodic snapshot → WinRT LockScreen API (best-effort, §3.3/§8)
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
  (zenith / mid / horizon). `sunInfo(m)` / `moonInfo(m)` give arc position + altitude,
  using `SUN_RISE`/`SUN_SET` (module-level, minutes-of-day) rather than a fixed
  schedule — see "Real sunrise/sunset" below.
- **Real sunrise/sunset:** `calcSunTimes(lat, lon, date)` is a NOAA simplified solar
  calculator (equation of time + declination, no external calls) returning today's real
  `{riseMin, setMin}` for a location; `setSunTimes()` writes them into `SUN_RISE`/
  `SUN_SET`. Both the demo panel's 📍 Live weather button and `prod-boot.js`'s
  `refreshWeather()` call this once location is known, so the sun's arc and altitude
  track the user's actual location/date, not a hardcoded 06:00–18:45 day. Moon rise/set
  isn't independently modeled (real lunar rise/set drifts ~50 min/day and depends on
  phase, which we don't have inputs for) — it's a stylized simplification: moon rises at
  sunset, sets at the next sunrise. `remapToReferenceClock(m)` maps a real clock minute
  onto the fixed reference day (06:00/12:00/18:45) that `KEYS` (sky colour keyframes)
  and `phaseName()` are authored against, via 5 piecewise-linear anchors (midnight,
  sunrise, noon, sunset, midnight) — so sky colour and phase labels ("Sunrise", "Dusk"…)
  stay in sync with the real sun position instead of drifting away from it. `sunInfo()`'s
  y-coordinate is anchored to hit exactly `HORIZON` at `m=SUN_RISE`/`SUN_SET` (no offset)
  so the disc is genuinely bisected by the horizon at the real computed instant — see
  `v1.0.12` in §6.1 for the bug this replaced and why ridge geometry also needed a fix.
- **Shared layers (all scenes):** sky gradient, horizon glow tracking the sun/moon,
  stars + Milky Way at night, sun/moon discs & bloom (plus low-angle **light rays** via
  `drawSunRays()`, fading in near the horizon and out by ~⅓ up the sky), soft
  volumetric **clouds** whose density follows real `cloud_cover`% (each of the 5 clouds
  has its own reveal `threshold`, so a clear day shows a wisp or two and an overcast one
  shows all five — see `cloudiness` global, set from `liveWeather.cloudCover` in
  `prod-boot.js`; rain always forces some minimum cloud cover too), and **distant birds**
  (`drawBirds()`) — a fixed pool of 3, daytime-only, hidden in rain, each just two
  stroked quadratic curves with a `sin()`-driven wing flap and no gradients or per-frame
  allocation, deliberately cheap next to the existing rain/snow particle systems
  (hundreds of drops/flakes already run every frame without issue).
- **Clock style:** `CLOCK_STYLE` ('digital'|'analog', default digital) toggles between
  the existing `#hudClock` text and `drawAnalogClock()`, which paints a small clock face
  (ticks, hour/minute hands) onto the `#hudClockAnalog` canvas inside the HUD — a DOM
  canvas, not the main scene canvas, since it only needs to redraw on `updateHUD()`
  ticks, not every animation frame. `setClockStyle()` is the engine-level setter;
  `prod-boot.js`'s `applyClockStyle()` calls it from `CONFIG.clockStyle`. `drawAnalogClock()`
  resizes the canvas's own backing store to `56*DPR` (matching the main scene canvas's own
  DPR handling) and resets the 2D context transform to that scale before drawing, keeping
  all its drawing math in fixed 56-CSS-pixel units — found and fixed a real bug where it
  drew straight at the HTML `width="56" height="56"` backing resolution with no DPR
  scaling at all, rendering blurry on any >100% Windows display scaling (125%/150%/200% —
  the common case, not the exception). Verified by forcing `DPR` to 1/1.5/2 and checking
  the canvas's backing pixel size scales (56/84/112) while its CSS size stays fixed at
  56px, then visually confirming the face renders crisp at 2x.
  **Separate bug in the same area, found by measuring `getBoundingClientRect()` rather
  than trusting a screenshot glance:** the analog clock rendered pinned to the whole
  `#hud` panel's top-left corner, overlapping the location row, instead of sitting next
  to the date inside `.hud-time` where its DOM position (and the digital clock's
  equivalent spot) says it should. Root cause: the file's one bare `canvas{}` rule (line
  ~11, `position:absolute; inset:0; width:100%; height:100%;`) is meant only for the
  fullscreen scene canvas `#c`, but a bare element-type selector matches *every*
  `<canvas>` — including `#hudClockAnalog`. My inline `cv.style.width/height` (from the
  DPR fix above) happened to override the `width`/`height` part, which is why the canvas
  was the right *size* and easy to mistake for correct, but `position`/`inset` were never
  touched, so it stayed absolutely pinned to `inset:0` of its nearest positioned
  ancestor (`#hud`, `position:fixed`). Fixed with an explicit `.hud-clock-analog{
  position:static; inset:auto; ...}` override. If you ever add another `<canvas>`
  anywhere inside `#hud` (or anywhere that isn't the fullscreen scene layer), it will
  silently inherit this same absolute/inset:0 positioning unless explicitly reset —
  check `getComputedStyle(el).position`, not just whether the element *looks* roughly
  right in a screenshot.
- **HUD position:** `setHudPosition()` swaps the `#hud` div's class between
  `pos-top-right`/`pos-top-left`/`pos-bottom-right`/`pos-bottom-left` (CSS only — each
  just sets `top`/`bottom`/`left`/`right`). No true drag-to-reposition: the wallpaper
  window is `focusable:false` with mouse input not forwarded by design (so desktop
  clicks pass through to the icons underneath), and enabling drag would mean enabling
  input capture, breaking that. A 4-way preset picker in Settings/Lively sidesteps the
  conflict entirely.
- **HUD transparency:** `setHudOpacity(pct)` sets plain CSS `opacity` (0.15-1, clamped)
  on the whole `#hud` div — a user-settable seek bar (Settings/Lively, 15-100%, default
  100 = unchanged from before this existed). Deliberately a blanket opacity rather than
  fading just the glass background: simplest, most predictable behaviour for a
  "transparency" control, at the cost of also fading the text/numbers at low values —
  the 15% floor exists so users can't drag it to fully invisible-and-undiscoverable.
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
  feels-like / humidity / wind / precip / **sunrise / sunset**). It's a DOM overlay
  (`#hud` div), **not** drawn into the canvas — matters if you ever want to screenshot
  the full look including the HUD (see §8's canvas-screenshot workaround, which
  composites it in via an SVG `foreignObject`). Sunrise/sunset chips just call the
  existing `fmt(SUN_RISE)`/`fmt(SUN_SET)` in `updateHUD()`, so they inherit the 12/24h
  setting automatically. **Deliberately not shown: moonrise/moonset or eclipses** — the
  moon here is a stylized "rises at sunset, sets at sunrise" model (see the "Real
  sunrise/sunset" note above), not real lunar ephemeris, and eclipse prediction needs
  actual orbital mechanics (Sun-Earth-Moon alignment, Saros cycle data) well beyond the
  simplified NOAA solar calculator this engine uses — showing either would mean
  fabricated numbers next to the now-accurate real sunrise/sunset. Revisit only if a real
  ephemeris source gets wired in.

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
- **`screensaver.js` — Windows screensaver, same exe.** A Windows screensaver is just an
  executable invoked with a conventional command line (`/s` = run fullscreen, `/p <hwnd>`
  = embed a small preview, `/c` = config), so rather than shipping a second binary,
  `main.js`'s `handleLaunch()` inspects `process.argv` (and the forwarded argv from
  `second-instance`, since the wallpaper app is normally already running and holds the
  single-instance lock) and branches: `/s` creates one fullscreen, focusable, always-
  on-top `BrowserWindow` per display showing `wallpaper.html` (via `screensaver.js`'s
  `runFullscreen()`), exits on any keyboard input (`before-input-event`) or real mouse
  movement/click/wheel (injected listener + `screensaver-preload.js`'s
  `lwScreensaver.exit()`, with an 8px movement threshold so jitter doesn't dismiss it
  instantly). `/p` just exits immediately — see the gotcha below, no embedded native
  preview. Settings' **"Use as Windows screensaver"** toggle calls `screensaver.enable()`
  /`disable()`, which point Windows' own idle-timer at this exe via `HKCU\Control
  Panel\Desktop`'s `SCRNSAVE.EXE`/`ScreenSaveActive` registry values (the same values the
  classic dialog itself writes) — `ScreenSaveTimeOut` is only set if the user doesn't
  already have one, so an existing idle-timeout preference isn't silently overridden.
  Packaged app only (`app.isPackaged`), same guard pattern as auto-update.
- **`lockscreen.js` — periodic lock-screen snapshot. Best-effort, Windows-build-
  dependent — confirmed non-functional on one real Windows 11 build (10.0.26200, this
  dev machine) but confirmed WORKING by an end user on their own machine.** The Windows
  lock screen renders on a separate secure desktop that no regular process can draw
  into, so there's no way to make it animate live. When Settings' **"Use as lock
  screen"** toggle is on, every 30 minutes `lockscreen.js` grabs
  `webContents.capturePage()` from the primary wallpaper window, saves it to
  `%APPDATA%/Living Wallpaper/lockscreen.png`, and calls the WinRT
  `Windows.System.UserProfile.LockScreen.SetImageFileAsync` API — reached from Node
  without any native module by shelling out to `powershell.exe` with
  `ContentType=WindowsRuntime` type activation (the same technique apps like Bing
  Wallpaper have historically used). On this dev machine the call succeeds and updates
  its own metadata (`LockScreen.OriginalImageFile`) but doesn't change what's actually
  rendered — see §6's writeup for what was ruled out (Spotlight, slideshow, group
  policy) and the likely cause (the modern lock screen renderer is a separate system
  app that appears not to source its background from this call anymore) — yet it *does*
  visibly work end-to-end on the reporting user's real machine, so whatever gates this
  varies by Windows build/config in a way not yet root-caused. Don't assume it's broken
  everywhere just because it was broken here, and don't assume it's fixed everywhere
  just because a user confirmed it once. See the §8 gotcha for why the PowerShell side
  needs a reflection-based `AsTask` awaiter rather than the naively-expected
  `.Status`/`.GetResults()` — that part *is* solid regardless of the OS-honoring
  question.
  - **Clock-mismatch bug, found once a user had it actually working:** because the
    snapshot only refreshes every 30 min, its baked-in HUD clock visibly drifted from
    Windows' own live lock-screen clock in between refreshes — obviously wrong to
    anyone glancing at both. `capturePage()` grabs the whole rendered page (DOM +
    canvas), so the HUD's clock chip was baked into the picture right along with
    everything else. Fixed by hiding *just* the clock (not the rest of the weather
    HUD, which goes stale much less noticeably) for the capture: a new
    `HUD_CLOCK_SUPPRESSED` flag + `setHudClockSuppressed(v)` in
    `tools/engine-source.html`'s `updateHUD()`, toggled by `lockscreen.js` via
    `executeJavaScript` immediately before/after `capturePage()`. Deliberately a flag
    checked *inside* `updateHUD()` itself, not a one-off `style.display` write from
    outside — `updateHUD()` already re-runs every 15s (real-clock tick) independently of
    the snapshot, so a plain external hide could get raced and undone before the
    capture actually happened; gating inside `updateHUD()` means every tick respects
    the flag regardless of timing. Verified: forced an `updateHUD()` tick while
    suppressed and confirmed the clock stayed hidden (both digital and analog styles).

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
  "clockStyle": "digital|analog",
  "hudPosition": "top-right|top-left|bottom-right|bottom-left",
  "hudOpacity": 100,          // 15-100 (%), panel transparency
  "scene":    "mountains|city|beach|desert|forest|aurora|village|rotate|random",
  "showHud":  true,
  "photo":    "C:\\path\\img.jpg | null",     // single photo
  "photos":   ["...","..."] ,                  // ordered set -> day cross-fade
  "location": { "lat": 0, "lon": 0, "name": "City, CC" } | null,  // null = auto (IP)
  "monitor":  "all | <displayId>",
  "autostart": false,
  "pauseOnFullscreen": true,
  "sound":    false,         // ambient rain/wind/cricket audio, off by default
  "useAsScreensaver": false, // registers this exe as the Windows screensaver (packaged app only)
  "useAsLockScreen":  false  // confirmed non-functional on modern Windows 11 - see §6/§8; kept as best-effort
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
- ✅ **Lock-screen clock mismatch, analog clock blur, and analog clock mispositioning —
  three bugs, all fixed in the same pass.** Found from user reports once the lock-screen
  feature was confirmed actually working on their machine: (1) the snapshot's baked-in
  HUD clock visibly drifted from Windows' own live lock-screen clock between the 30-min
  refreshes — fixed by suppressing just the clock (not the rest of the weather HUD)
  during the capture; (2) the analog clock style rendered blurry on any >100% Windows
  display scaling because its canvas never scaled its backing store by DPR (unlike the
  main scene canvas, which always has); (3) the analog clock also rendered pinned to the
  HUD panel's top-left corner (overlapping the location text) instead of next to the
  date, because a bare `canvas{}` CSS rule meant only for the fullscreen scene canvas
  was leaking `position:absolute;inset:0` onto every other canvas too. See §3.1 for the
  technical detail on all three.
- ✅ **HUD sunrise/sunset times + transparency slider.** The weather panel now shows
  Sunrise/Sunset chips (`fmt(SUN_RISE)`/`fmt(SUN_SET)`, so they respect the 12/24h
  setting automatically) and a Settings/Lively seek bar (15-100%, default 100) for the
  panel's overall transparency. Deliberately **not** added: moonrise/moonset or eclipse
  times — the moon here is a stylized "rises at sunset" model, not real lunar ephemeris,
  and eclipses need real orbital-mechanics prediction this engine doesn't have; showing
  either would just be fabricated numbers next to the now-accurate real sunrise/sunset.
  See §3.1 for both.
- ✅ **Sun/moon now genuinely bisected by the horizon at the exact real sunrise/sunset
  minute** — two bugs fixed (a ~29px vertical offset in `sunInfo()`/`moonInfo()`, and
  mountain ridges that happened to peak ~100px above the horizon exactly where the sun's
  arc rises/sets). Found from a user report with real Lahore sunrise/sunset times;
  `calcSunTimes()` itself was already accurate. See `v1.0.12` in §6.1 for the full
  writeup.
- ✅ **HUD position picker** — Settings/Lively 4-way preset (top-left/top-right/
  bottom-left/bottom-right) for the weather panel, CSS-only. No true drag-to-reposition
  by design — see the gotcha below.
- ✅ **Photo-selection guidance** — a tip in Settings (above the photo picker) and in
  the README explaining what makes a source photo work well with Photo mode (open sky,
  flat lighting, no people, unfiltered) — see §8 for the underlying reason (the app
  draws its own sun/moon glow directly onto the photo).
- ✅ **Analog clock option** — Settings/Lively toggle between digital and a small
  hand-drawn analog clock face in the weather panel.
- ✅ **Distant birds** — a small, deliberately cheap daytime-only flock (3 birds, no
  gradients, no per-frame allocation) drifting across the sky. No perching-on-trees
  behaviour (out of scope for now — would need per-scene tree-position integration).
- ✅ **Sun position fixed + real sunrise/sunset by location.** The sun's arc x-formula
  had a real bug (`x = 0.10W − 0.80W·cos(angle)`) that put it off-canvas for the entire
  morning and only 10% across even at solar noon — found from a user report ("sun was
  overhead around 11:30am, wallpaper showed nothing"). Fixed to a centered, symmetric
  arc, **and** the fixed 06:00/18:45 schedule is now replaced with real sunrise/sunset
  computed from the resolved location + today's date (NOAA solar calculator, no
  external calls). Sky colour and phase labels remap to stay in sync. See §3.1.
- ✅ **Clouds now follow real weather**, and **low-angle sun rays**. Cloud density scales
  with live `cloud_cover`% instead of always showing all 5; a clear day shows a wisp,
  overcast shows all of them. Soft light rays fade in near the horizon at sunrise/sunset
  and fade out by mid-morning. See §3.1.
- ✅ Day-cycle engine (sky, sun/moon arc, stars/Milky Way, clouds) with realistic grading.
- ✅ Live rain + snow (temperature-based), snow cover, frost, heat-haze, cold/warm grade.
- ✅ Live weather + HUD (IP location, Open-Meteo), 12/24h clock, °C/°F, km/h/mph.
- ✅ Eight scenes (Mountains, City, Beach, Desert, Forest, Aurora, Snowy Village,
  Waterfall Valley) + Rotate/Random; thumbnail picker in settings; scene dropdown in
  Lively. **Waterfall Valley** adds a waterfall ribbon cut through two mountain layers,
  drifting lake mist, and a foreground fence, reusing the existing ridge/water/pine/bird
  primitives — see §6.1's `v1.0.11` entry for the canvas hole-punching gotcha it
  surfaced.
- ✅ **Windows screensaver mode** — the packaged `.exe` responds to `/s` (run
  fullscreen), `/p` (preview), `/c` (configure → opens Settings) so it can be registered
  as a normal Windows screensaver; toggle in Settings. Registry writes verified live;
  the fullscreen window itself needs a real packaged-build test pass (see §6.1).
- 🟡 **Lock-screen snapshot (best-effort, confirmed non-functional on tested Windows
  11 build)** — periodically sets a scene snapshot as the Windows lock screen picture
  via the WinRT `LockScreen` API. The call succeeds but doesn't change what's actually
  rendered on this machine's Windows 11 build — kept as a harmless opt-in toggle rather
  than removed, since it costs nothing when off. Do not tell users this works. See
  §6.1's `v1.0.11` entry and §8's gotcha for the full investigation.
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
- **`v1.0.7` — sun position bug fix + real sunrise/sunset by location.** See §6's
  "Sun position fixed" bullet above for the root cause and fix; §3.1 for
  `calcSunTimes()`/`remapToReferenceClock()`. Also landed in this release: clouds
  driven by live `cloud_cover`%, and low-angle sun rays at sunrise/sunset.
- **`v1.0.8` — analog clock option + distant birds.** `CLOCK_STYLE` toggle
  (`drawAnalogClock()`) and a small cheap daytime-only bird flock (`drawBirds()`). See
  §6/§3.1 above for detail.
- **`v1.0.9` — HUD position picker + photo-selection guidance.** CSS-only 4-way preset
  for the weather panel (no true drag, see §8's gotcha on why), plus a Settings/README
  tip on what makes a source photo work well with Photo mode.
- **`v1.0.10` — fix: HUD hiding behind the taskbar in bottom positions.** Found by
  actually using bottom-right/bottom-left HUD placement on a real desktop: both only
  had 18px of clearance from the screen edge, the same as the top positions, nowhere
  near enough to clear a taskbar — which sits on top of everything as its own OS layer
  above the wallpaper, not something the wallpaper window can measure or avoid other
  than by guessing generously. Bumped bottom clearance to 72px (68px at the mobile
  breakpoint).
- **`v1.0.11` — new "Waterfall Valley" scene, plus a Windows screensaver mode and a
  best-effort (confirmed non-functional) lock-screen snapshot feature.**
  **Waterfall Valley** ([tools/engine-source.html](tools/engine-source.html)) reuses the
  existing ridge/water/pine/bird primitives and adds three new pieces: a waterfall
  ribbon threaded between two mountain layers, drifting mist bands over the lake, and a
  foreground fence. Building it surfaced a real canvas gotcha worth remembering: cutting
  a "hole" in a filled shape with `ctx.fill('evenodd')` only works if the hole subpath
  stays *inside* the outer shape — any part of the hole that falls outside gets filled
  solid instead of doing nothing, so the hole's bounds must be clamped to the actual
  ridge geometry at that column, not a fixed offset (see §8's gotcha entry). Verified by
  sampling actual rendered pixel colors (not just eyeballing the screenshot) at sunset,
  noon, and night+snow+rain — the visual bug wasn't obvious until specific pixel values
  were checked. **Windows screensaver + periodic lock-screen snapshot.** `screensaver.js`/
  `lockscreen.js` + a Settings card, wired per §3.3.
  - ✅ Verified: the `/s`/`/p`/`/c` argv-detection regexes (`screensaver.js`'s
    `detectMode()`), against real Windows invocation patterns.
  - ✅ Verified: the `HKCU\Control Panel\Desktop` registry writes (`screensaver.enable()`
    /`disable()`) — ran the exact commands live (pointed `SCRNSAVE.EXE` at a harmless
    placeholder, confirmed the write, restored the user's original values exactly).
  - ⬜ **Not** live-verified: the actual fullscreen `/s` window itself — this dev sandbox
    couldn't produce a working local Electron build (no Rust toolchain for
    `electron-as-wallpaper`, and writing new `.exe` files appears to be sandbox-blocked
    entirely, so `electron.exe` itself never fully extracted). The window/input-exit code
    is straightforward Electron (`BrowserWindow` + `before-input-event` + a content-side
    listener), but treat it as needing a real test pass in a packaged build.
  - ❌ **`useAsLockScreen` does not work on current Windows 11 (confirmed on build
    10.0.26200) and should be treated as non-functional, not just unverified.** The WinRT
    plumbing itself is solid — `System.__ComObject`'s lack of a usable
    `.Status`/`.GetResults()` on a raw `IAsyncOperation<T>` was hit live, fixed with a
    reflection-based `AsTask` awaiter (see `lockscreen.js`, and the §8 gotcha), and
    `LockScreen.SetImageFileAsync` was run for real against this machine's actual lock
    screen: it returned success, and `[Windows.System.UserProfile.LockScreen]::
    OriginalImageFile` afterward correctly reported the path we set. **But the visible
    lock screen never changed**, confirmed across two separate lock/unlock cycles.
    Checked and ruled out: Windows Spotlight (`RotatingLockScreenEnabled=0`),
    slideshow mode (`SlideshowEnabled=0` under `HKCU\...\CurrentVersion\Lock Screen`),
    and group policy (`HKLM\SOFTWARE\Policies\Microsoft\Windows\Personalization` doesn't
    exist on this machine). The registry blob under `HKCU\...\CurrentVersion\Lock
    Screen` *did* record our write (`Details_B: IMAGENAME:...powershell.exe`), so the
    call reaches the OS layer — it just isn't reflected by the actual renderer, which on
    modern builds is a separate system app (`LockAppAumId:
    Microsoft.LockApp_cw5n1h2txyewy!WindowsDefaultLockScreen`). Likely explanation:
    Microsoft has quietly stopped having that renderer source its background from this
    classic WinRT call on recent Windows 11 builds, even though the call itself still
    "succeeds." Decision: keep the code and the Settings toggle rather than rip it out —
    it's a harmless no-op where it doesn't work, costs nothing when off, and might work
    on other Windows versions/configurations or if Microsoft's behavior differs
    elsewhere — but do **not** advertise this as a working feature until it's confirmed
    visually on some real setup. If revisiting: the next thing worth trying is whatever
    mechanism actually reads current builds' `Microsoft.LockApp` background (undocumented,
    would need real reverse-engineering / ProcMon tracing — not attempted here).
- **`v1.0.12` — two real bugs in sun/moon horizon positioning, found from a user report
  ("sunset in Lahore is 6:34 PM — at that exact time the sun should be exactly half
  behind the mountains, half above").** Both confirmed and fixed in
  [tools/engine-source.html](tools/engine-source.html):
  1. `sunInfo()`/`moonInfo()`'s y-formula had the disc's vertical center offset by
     `+H*0.04`/`+H*0.02` from `HORIZON` even at the exact rise/set instant (`angle=0`/`π`,
     `sin(angle)=0`) — so on a 720px-tall canvas the sun's center sat ~29px *below* the
     horizon at the moment it should have been bisected by it, meaning it would appear to
     rise late and set early relative to the real computed time. Fixed by removing the
     offset entirely: `y = HORIZON - sin(angle)*H*0.60` (and the equivalent for the moon)
     — now `sun.y === HORIZON` exactly at `m=SUN_RISE`/`SUN_SET` (verified to floating-
     point noise, ~1e-14). Cross-checked `calcSunTimes()` itself against the user's real
     Lahore figures (5:34 AM/6:34 PM): computed 5:34/18:35 for those coordinates on this
     machine (whose system timezone is already Asia/Karachi) — the clock-time math was
     already correct; only the disc's *pixel position at that time* was wrong.
  2. Even with (1) fixed, the Mountains/Waterfall Valley/Aurora ridges are seeded
     (`ridge()`) with wavy amplitude up to ~H*0.13–0.17, and the sun's arc always
     rises/sets at the *same* fixed x (≈0.06W/0.94W — see `sunInfo()`'s
     `x = 0.5W - cos(angle)*0.44W`). On the existing fixed seeds, the ridge line at
     those exact x's happened to sit up to ~100px above the horizon (confirmed by
     sampling ridge points within 8px of the sun's x), which would hide the disc for
     30–60+ minutes past the real sunrise/sunset before it climbed clear — a separate bug
     from (1), since the "half above/half below" moment needs the *ground silhouette*,
     not just the abstract horizon, to be near-flush with the sun's crossing point. Fixed
     with a new `taperRidgeEdges(pts, radiusFrac)` that pulls ridge points toward
     `HORIZON` in a falloff zone centered on the sun's two arc-extreme x's (not the
     screen edges — the sun's arc never actually reaches x=0/x=W, so an earlier attempt
     anchored to screen-edge distance under-corrected at the real x=0.06W/0.94W points
     and needed a second pass); applied to `buildRanges()` (Mountains),
     `buildWaterfallValley()`, and `buildAurora()`. Verified: ridge height at the sun's
     exact x is now within ~5px of `HORIZON` (down from up to ~100px), and confirmed
     visually — Beach (flat water horizon, unaffected by this ridge fix) shows the sun
     precisely bisected by the horizon at the exact computed sunrise minute; Mountains
     shows the same at sunrise. (At the Mountains-scene sunset moment specifically, the
     disc is confirmably rendering at the right pixels — verified by sampling the exact
     RGB right after the fill call, `[255,138,66]` as expected — but is hard to *see* by
     eye in a screenshot because the dusk sky/vignette happen to land on a very similar
     warm hue at that exact spot; a color-contrast nuance, not a position bug.)

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
- **Verify arc/position math numerically, not just visually.** The sun x-formula bug
  (`x = 0.10W − 0.80W·cos(angle)`, off-canvas for the entire morning) had presumably
  been sitting there since the engine was first written — a purely visual check on the
  wrong time-of-day could easily miss it (evening/night looked fine; the sun only
  appeared once it swung far enough right). Print `sun.x/W` and `sun.altitude` at
  several `minutes` values (rise, noon, an arbitrary mid-morning point) and check they
  land where they should before trusting a screenshot.
- **`drawPhotoScene()` paints an actual sun/moon disc + glow directly onto the user's
  photo** (`ctx.arc(sun.x,sun.y,...)` with `'screen'` blend, not just a color grade) at
  wherever the day-arc currently has it. This is why photo-selection guidance matters —
  a photo with its own visible sun or strong directional shadows will visibly clash with
  the app's light. Worth remembering if the photo-relight passes ever get revisited.
- **No embedded native `/p` screensaver preview, on purpose.** Windows' classic Screen
  Saver Settings dialog wants a live thumbnail rendered inside a small HWND it owns,
  which means reparenting our window into it (`SetParent` + clearing `WS_POPUP`/setting
  `WS_CHILD` via `SetWindowLongPtrW` + `MoveWindow`). Tried via `koffi` and it segfaulted
  in isolated testing (two real Notepad windows, no Electron involved) — a `koffi`-
  registered `EnumWindows` callback crashed on cleanup. Not worth chasing for a thumbnail
  in a dialog most users never open: `/p` just exits immediately, Windows shows a blank
  preview box, and the real screensaver (`/s`, fullscreen) is completely unaffected.
- **WinRT async calls from PowerShell need a reflection-based `AsTask` awaiter, not
  `.Status`/`.GetResults()`.** Activating a WinRT class from PowerShell via
  `[Type,Namespace,ContentType=WindowsRuntime]` works fine for plain calls, but a method
  returning `IAsyncOperation<T>` (e.g. `StorageFile.GetFileFromPathAsync`) comes back as
  a bare `System.__ComObject` — polling `.Status` prints nothing and `.GetResults()`
  isn't reachable, because `AsTask` (from `System.Runtime.WindowsRuntime`, which needs
  an explicit `Add-Type -AssemblyName System.Runtime.WindowsRuntime`) is a *generic*
  method, so PowerShell's late binding can't resolve which overload to use without
  reflection (`MakeGenericMethod`). `IAsyncAction` (e.g.
  `LockScreen.SetImageFileAsync`) needs the same treatment minus the generic dispatch.
  See `lockscreen.js`'s `Await`/`AwaitAction` PowerShell functions. Also: pass a script
  this size as an actual `.ps1` file (`-File`), not `-Command`/`-EncodedCommand` with a
  multi-line string — the latter mangled a `$path` variable assignment in testing for no
  obvious reason once the script grew past a couple of lines.
- **No true drag-to-reposition for the HUD.** The wallpaper `BrowserWindow` is
  `focusable:false` with `forwardMouseInput:false` (`electron-as-wallpaper`'s `attach()`
  options) — deliberate, so clicks pass through to the desktop icons underneath instead
  of being captured by the wallpaper. Live dragging would require enabling mouse input
  forwarding, which breaks that click-through. A CSS-only 4-corner preset picker
  (`hudPosition`) sidesteps the conflict.
- **`ctx.fill('evenodd')` only punches a real hole where the hole subpath stays inside
  the outer shape.** Any part of a hole subpath that falls *outside* the outer shape
  doesn't get subtracted from anything — under even/odd parity it's just its own
  region with a count of 1 (odd), so it gets filled solid with whatever `fillStyle` is
  set. Used to cut the waterfall gap into `drawSceneWaterfall()`'s mountain ridges
  (`drawRangeWithGap()`): the first attempt anchored the hole's top edge to a fixed
  offset from `HORIZON`, which sat above the actual (wavy, seeded) ridge line at that
  column — so instead of a see-through gap, that stretch rendered as a solid mountain-
  colored block, hiding the waterfall ribbon drawn underneath it. Fixed by scanning the
  ridge's own points near the gap column for their minimum y and clamping the hole's top
  to that, so the hole subpath never extends past the shape it's cut from. Caught by
  sampling actual rendered pixel colors at specific coordinates, not by eyeballing the
  screenshot — the wrong-looking block was subtle enough to miss visually at thumbnail
  size.
- **`LockScreen.SetImageFileAsync` reports success without actually changing the visible
  lock screen, on at least one real Windows 11 build (10.0.26200).** See §6.1's
  `v1.0.11` entry for the full investigation (Spotlight/slideshow/policy all ruled out;
  the modern lock screen is rendered by a separate system app,
  `Microsoft.LockApp_cw5n1h2txyewy!WindowsDefaultLockScreen`, that appears not to source
  its background from this classic WinRT call anymore). Don't trust this API's return
  value as proof the lock screen actually changed — verify visually (lock the session)
  before ever calling this "done."

## 9. Continuing with Claude
Point Claude at this file first. Good next asks: "add fog + lightning to storms",
"add a Countryside or Rainforest scene", "wire code signing into CI",
"start the Android WallpaperService port". Also pending, agreed but not started: a
texture/shading realism pass on the Mountains scene (noise/grain, directional shading,
surface detail) as a proof of concept before rolling it out to the other scenes — the
current look is flat-shaded vector art, which reads as illustrated no matter how good
the composition is. Always run `node tools/build-wallpaper.js` after engine/prod-boot
edits.
