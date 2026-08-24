'use strict';
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, screen, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const desktop = require('./desktop-win');
const pkg = require('../package.json');

// electron-as-wallpaper attaches a BrowserWindow behind the desktop icons
// using the Windows Progman/WorkerW technique. Loaded lazily & defensively.
let wallpaperLib = null;
try { wallpaperLib = require('electron-as-wallpaper'); }
catch (e) { console.warn('[main] electron-as-wallpaper not available:', e.message); }

let cfg = null;
let wpWindows = [];      // wallpaper BrowserWindows (one per targeted display)
let settingsWin = null;
let tray = null;
let manualPause = false;
let pausePollTimer = null;

// Single instance only.
if (!app.requestSingleInstanceLock()) { app.quit(); }

app.on('second-instance', () => openSettings());

app.whenReady().then(init);
app.on('window-all-closed', (e) => { e.preventDefault(); }); // stay alive in tray

function init() {
  cfg = config.load();
  applyAutostart();
  createWallpaperWindows();
  createTray();
  startPausePolling();
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
    { type: 'separator' },
    { label: manualPause ? 'Resume' : 'Pause', click: () => { manualPause = !manualPause; rebuildTrayMenu(); } },
    { label: 'Reload wallpaper', click: () => createWallpaperWindows() },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: !!cfg.autostart,
      click: (mi) => { cfg.autostart = mi.checked; config.save(cfg); applyAutostart(); } },
    { type: 'separator' },
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
  Object.assign(cfg, patch || {});
  config.save(cfg);
  applyAutostart();
  rebuildTrayMenu();
  if (monitorChanged) createWallpaperWindows(); else pushConfig();
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
