'use strict';
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, screen, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const desktop = require('./desktop-win');
const screensaver = require('./screensaver');
const lockscreen = require('./lockscreen');
const pkg = require('../package.json');

// The wallpaper window is focusable:false and never receives real user input, so
// Chromium's default autoplay policy (requires a user gesture) would silently
// block the optional ambient audio from ever starting. Must be set before ready.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// electron-as-wallpaper attaches a BrowserWindow behind the desktop icons
// using the Windows Progman/WorkerW technique. Loaded lazily & defensively.
let wallpaperLib = null;
try { wallpaperLib = require('electron-as-wallpaper'); }
catch (e) { console.warn('[main] electron-as-wallpaper not available:', e.message); }

// Checks GitHub Releases (via the "publish" config baked in at build time) for a
// newer version. Only meaningful in a packaged install — there's nothing to update
// when running from source with `npm start`.
let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; autoUpdater.autoDownload = false; }
catch (e) { console.warn('[main] electron-updater not available:', e.message); }

let cfg = null;
let wpWindows = [];      // wallpaper BrowserWindows (one per targeted display)
let settingsWin = null;
let tray = null;
let manualPause = false;
let pausePollTimer = null;
let normalAppInitialized = false;

// Single instance only.
if (!app.requestSingleInstanceLock()) { app.quit(); }

// Windows invokes a screensaver as `<exe> /s` (run fullscreen), `/p <hwnd>`
// (embed a small preview - not supported, see screensaver.js), or `/c`
// (config). Since the wallpaper app is normally already running (and holds
// the single-instance lock), that invocation almost always arrives here via
// 'second-instance' rather than a fresh app.whenReady() - so both entry
// points route through the same dispatcher.
app.on('second-instance', (_e, argv) => handleLaunch(argv, true));

app.whenReady().then(() => handleLaunch(process.argv, false));
app.on('window-all-closed', (e) => { e.preventDefault(); }); // stay alive in tray

function handleLaunch(argv, alreadyRunning) {
  const mode = screensaver.detectMode(argv).mode;
  if (mode === 's') {
    if (!normalAppInitialized) cfg = cfg || config.load();
    screensaver.runFullscreen(pushConfig, () => { if (!normalAppInitialized) app.exit(0); });
    return;
  }
  if (mode === 'p') {
    // No embedded native preview - just exit so Windows shows a blank
    // thumbnail in the classic Screen Saver Settings dialog (see screensaver.js).
    if (!alreadyRunning) app.exit(0);
    return;
  }
  if (!normalAppInitialized) { init(); normalAppInitialized = true; }
  if (mode === 'c' || alreadyRunning) openSettings();
}

function init() {
  cfg = config.load();
  applyAutostart();
  createWallpaperWindows();
  createTray();
  startPausePolling();
  setupAutoUpdater();
  checkForUpdates(false);
  setInterval(() => checkForUpdates(false), 6 * 60 * 60 * 1000); // every 6h
  applyScreensaverSetting();
  applyLockScreenSetting();
}

// ---- screensaver / lock screen ----
function applyScreensaverSetting() {
  if (!app.isPackaged) {
    if (cfg.useAsScreensaver) {
      cfg.useAsScreensaver = false; config.save(cfg); rebuildTrayMenu();
      dialog.showMessageBox({ type: 'info', title: 'Screensaver',
        message: 'Screensaver integration only works in the installed app, not when running from source.' });
    }
    return;
  }
  if (cfg.useAsScreensaver) screensaver.enable(process.execPath);
  else screensaver.disable();
}

function primaryWallpaperWindow() {
  const pd = screen.getPrimaryDisplay();
  return wpWindows.find((w) => {
    try { const b = w.getBounds(); return b.x === pd.bounds.x && b.y === pd.bounds.y; }
    catch (e) { return false; }
  }) || wpWindows[0];
}

function applyLockScreenSetting() {
  if (cfg.useAsLockScreen) lockscreen.start(primaryWallpaperWindow);
  else lockscreen.stop();
}

// ---- choose the surface(s) to cover ----
// 'all'  -> one window per display, each showing the full scene. A single
//           window spanning the union of every display's bounds doesn't
//           attach reliably behind desktop icons on monitors with different
//           resolutions/DPI, so each monitor gets its own window instead.
// <id>   -> one window on that single display.
function targetBounds() {
  const all = screen.getAllDisplays();
  if (cfg.monitor === 'all') return all.map(d => d.bounds);
  const one = all.find(d => String(d.id) === String(cfg.monitor));
  return [(one || screen.getPrimaryDisplay()).bounds];
}

function createWallpaperWindows() {
  destroyWallpaperWindows();
  for (const b of targetBounds()) {
    const win = new BrowserWindow({
      x: b.x, y: b.y, width: b.width, height: b.height,
      frame: false, transparent: false, resizable: false, movable: false,
      skipTaskbar: true, focusable: false, hasShadow: false, fullscreenable: false,
      type: process.platform === 'win32' ? undefined : 'desktop',
      webPreferences: { backgroundThrottling: false, contextIsolation: true }
    });
    win.setMenu(null);
    // Electron/Chromium can create a window on a non-primary monitor with the
    // wrong initial DPI context when monitors have different scale factors,
    // leaving it undersized on that display. Re-asserting bounds after
    // creation forces a correct re-layout for the monitor it's actually on.
    win.setBounds(b);
    win.loadFile(path.join(__dirname, 'wallpaper.html'));

    win.webContents.on('did-finish-load', () => {
      win.setBounds(b);
      pushConfig(win);
      attachBehindIcons(win);
    });
    wpWindows.push(win);
  }
}

function attachBehindIcons(win) {
  if (process.platform !== 'win32' || !wallpaperLib) return;
  try {
    wallpaperLib.attach(win, {
      transparent: false,
      forwardKeyboardInput: false,
      forwardMouseInput: false
    });
  } catch (e) {
    console.warn('[main] attach failed (window will sit on desktop):', e.message);
    win.setAlwaysOnTop(false);
  }
}

function destroyWallpaperWindows() {
  for (const w of wpWindows) {
    try { if (wallpaperLib && process.platform === 'win32') wallpaperLib.detach(w); } catch (e) {}
    try { w.destroy(); } catch (e) {}
  }
  wpWindows = [];
}

// ---- push current config into every wallpaper renderer ----
function pushConfig(win) {
  const data = JSON.stringify(config.toRenderer(cfg));
  const js = 'window.LW_CONFIG=' + data + ';'
    + 'window.dispatchEvent(new CustomEvent("lw-config",{detail:window.LW_CONFIG}));';
  (win ? [win] : wpWindows).forEach(w => {
    try { w.webContents.executeJavaScript(js); } catch (e) {}
  });
}

function broadcast(eventName) {
  wpWindows.forEach(w => {
    try { w.webContents.executeJavaScript('window.dispatchEvent(new CustomEvent("' + eventName + '"))'); } catch (e) {}
  });
}

// ---- pause polling (game / fullscreen) ----
function startPausePolling() {
  if (pausePollTimer) clearInterval(pausePollTimer);
  pausePollTimer = setInterval(() => {
    const shouldPause = manualPause || (cfg.pauseOnFullscreen && desktop.isForegroundFullscreen());
    broadcast(shouldPause ? 'lw-pause' : 'lw-resume');
  }, 3000);
}

// ---- auto-update (GitHub Releases) ----
function setupAutoUpdater() {
  if (!autoUpdater) return;
  autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox({
      type: 'info', buttons: ['Download', 'Later'], defaultId: 0, cancelId: 1,
      title: 'Update available',
      message: 'Living Wallpaper ' + info.version + ' is available (you have ' + app.getVersion() + ').',
      detail: 'Download it now? It installs the next time you restart the app.'
    }).then((r) => { if (r.response === 0) autoUpdater.downloadUpdate(); });
  });
  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox({
      type: 'info', buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1,
      title: 'Update ready',
      message: 'The update has been downloaded. Restart now to install it?'
    }).then((r) => { if (r.response === 0) autoUpdater.quitAndInstall(); });
  });
  autoUpdater.on('error', (e) => console.warn('[updater]', e.message));
}

function checkForUpdates(manual) {
  if (!autoUpdater || !app.isPackaged) {
    if (manual) dialog.showMessageBox({ type: 'info', title: 'Check for updates',
      message: 'Updates are only available in the installed app, not when running from source.' });
    return;
  }
  autoUpdater.checkForUpdates().catch((e) => {
    if (manual) dialog.showMessageBox({ type: 'error', title: 'Check for updates',
      message: 'Could not check for updates.', detail: e.message });
  });
}

// ---- tray ----
function createTray() {
  const icon = trayIcon();
  tray = new Tray(icon);
  tray.setToolTip('Living Wallpaper');
  rebuildTrayMenu();
  tray.on('double-click', openSettings);
}

function rebuildTrayMenu() {
  const menu = Menu.buildFromTemplate([
    { label: 'Settings…', click: openSettings },
    { label: 'Preview…', click: openPreview },
    { type: 'separator' },
    { label: manualPause ? 'Resume' : 'Pause', click: () => { manualPause = !manualPause; rebuildTrayMenu(); } },
    { label: 'Reload wallpaper', click: () => createWallpaperWindows() },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: !!cfg.autostart,
      click: (mi) => { cfg.autostart = mi.checked; config.save(cfg); applyAutostart(); } },
    { type: 'separator' },
    { label: 'Check for Updates…', click: () => checkForUpdates(true) },
    { label: 'About…', click: openAbout },
    { label: 'Quit', click: () => { destroyWallpaperWindows(); tray.destroy(); app.exit(0); } }
  ]);
  tray.setContextMenu(menu);
}

function trayIcon() {
  const p = path.join(__dirname, '..', 'assets', 'tray.png');
  if (fs.existsSync(p)) return nativeImage.createFromPath(p);
  // 1x1 fallback so the app still runs without an icon asset
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
}

// ---- settings window ----
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 480, height: 900, resizable: true, minHeight: 560, title: 'Living Wallpaper — Settings',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  settingsWin.setMenu(null);
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

// ---- preview window ----
// Lets a user scrub the full 24h cycle and test weather/temperature without
// waiting for real time to pass. Self-contained (same file as the dev demo,
// see tools/build-wallpaper.js) — no IPC bridge needed.
let previewWin = null;
function openPreview() {
  if (previewWin && !previewWin.isDestroyed()) { previewWin.focus(); return; }
  previewWin = new BrowserWindow({
    width: 1100, height: 700, minWidth: 640, minHeight: 420,
    title: 'Living Wallpaper — Preview',
    webPreferences: { contextIsolation: true }
  });
  previewWin.setMenu(null);
  previewWin.loadFile(path.join(__dirname, 'preview.html'));
  previewWin.on('closed', () => { previewWin = null; });
}

// ---- about window ----
let aboutWin = null;
function openAbout() {
  if (aboutWin && !aboutWin.isDestroyed()) { aboutWin.focus(); return; }
  aboutWin = new BrowserWindow({
    width: 360, height: 460, resizable: false, minimizable: false, maximizable: false,
    title: 'About Living Wallpaper',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  aboutWin.setMenu(null);
  aboutWin.loadFile(path.join(__dirname, 'about.html'));
  aboutWin.on('closed', () => { aboutWin = null; });
}

function applyAutostart() {
  try {
    app.setLoginItemSettings({ openAtLogin: !!cfg.autostart, args: ['--hidden'] });
  } catch (e) {}
}

// ---- IPC from settings window ----
ipcMain.handle('lw:get-config', () => cfg);
ipcMain.handle('lw:set-config', (_e, patch) => {
  const monitorChanged = patch && 'monitor' in patch && patch.monitor !== cfg.monitor;
  const ssChanged = patch && 'useAsScreensaver' in patch && patch.useAsScreensaver !== cfg.useAsScreensaver;
  const lsChanged = patch && 'useAsLockScreen' in patch && patch.useAsLockScreen !== cfg.useAsLockScreen;
  Object.assign(cfg, patch || {});
  config.save(cfg);
  applyAutostart();
  rebuildTrayMenu();
  if (monitorChanged) createWallpaperWindows(); else pushConfig();
  if (ssChanged) applyScreensaverSetting();
  if (lsChanged) applyLockScreenSetting();
  return cfg;
});
ipcMain.handle('lw:pick-photo', async () => {
  const r = await dialog.showOpenDialog({
    title: 'Choose a wallpaper photo',
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths[0]) return cfg;
  cfg.photo = r.filePaths[0]; cfg.photos = null;
  config.save(cfg); pushConfig();
  return cfg;
});
ipcMain.handle('lw:pick-photos', async () => {
  const r = await dialog.showOpenDialog({
    title: 'Choose photos in time order (midnight → evening) for the day cross-fade',
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }],
    properties: ['openFile', 'multiSelections']
  });
  if (r.canceled || !r.filePaths.length) return cfg;
  cfg.photos = r.filePaths; cfg.photo = null;
  config.save(cfg); pushConfig();
  return cfg;
});
ipcMain.handle('lw:clear-photo', () => { cfg.photo = null; cfg.photos = null; config.save(cfg); pushConfig(); return cfg; });
ipcMain.handle('lw:get-displays', () => screen.getAllDisplays().map(d => ({
  id: String(d.id), label: d.bounds.width + '×' + d.bounds.height + (d.internal ? ' (built-in)' : ''),
  primary: d.id === screen.getPrimaryDisplay().id
})));
ipcMain.handle('lw:geocode', async (_e, query) => {
  try {
    const url = 'https://geocoding-api.open-meteo.com/v1/search?count=1&name=' + encodeURIComponent(query);
    const res = await fetch(url); const j = await res.json();
    const hit = j.results && j.results[0];
    if (!hit) return null;
    cfg.location = { lat: hit.latitude, lon: hit.longitude, name: hit.name + (hit.country_code ? ', ' + hit.country_code : '') };
    config.save(cfg); pushConfig();
    return cfg.location;
  } catch (e) { return null; }
});
ipcMain.handle('lw:set-location', (_e, loc) => {
  if (loc && typeof loc.lat === 'number') {
    cfg.location = { lat: loc.lat, lon: loc.lon,
      name: loc.name || (loc.lat.toFixed(2) + ', ' + loc.lon.toFixed(2)) };
  } else {
    cfg.location = null;
  }
  config.save(cfg); pushConfig();
  return cfg;
});
ipcMain.handle('lw:close-settings', () => { if (settingsWin) settingsWin.close(); });
ipcMain.handle('lw:get-app-info', () => ({
  name: pkg.productName || pkg.name,
  version: app.getVersion(),
  description: pkg.description,
  author: pkg.author && pkg.author.name,
  authorUrl: 'https://github.com/' + (pkg.author && pkg.author.name),
  homepage: pkg.homepage
}));
ipcMain.handle('lw:open-external', (_e, url) => {
  if (typeof url === 'string' && /^https:\/\/github\.com\//.test(url)) shell.openExternal(url);
});
