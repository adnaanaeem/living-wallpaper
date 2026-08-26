'use strict';
// Windows screensaver integration.
//
// A Windows screensaver is just an .exe invoked with a conventional command
// line: `/s` runs it fullscreen, `/p <hwnd>` asks for a small embedded
// preview (the thumbnail in the classic Screen Saver Settings dialog), `/c`
// asks for a config dialog. We reuse this same app/process rather than
// shipping a separate binary - `detectMode()` inspects argv so main.js can
// branch into screensaver behaviour instead of the normal tray/wallpaper init.
//
// `/p` embedding (reparenting our window into a foreign HWND via SetParent)
// was tried and dropped during development: it needs native window-style
// surgery (SetParent + GWL_STYLE + MoveWindow) that segfaulted in isolated
// testing, for a payoff that's just a thumbnail in a legacy Control Panel
// dialog most users never open. `/p` exits immediately instead, leaving that
// thumbnail blank - the real screensaver (`/s`) is unaffected.
//
// There is no supported way to make Windows' registered-screensaver dropdown
// list this app without installing a native .scr stub into System32 (a
// bigger, separately-scoped change). Instead, `enable()` points Windows'
// idle-timer directly at this exe via the same HKCU registry values the
// classic dialog itself writes - functionally identical (Windows launches us
// with `/s` after the idle timeout), just not selectable from that dialog's
// list.

const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const { execFile } = require('child_process');

function detectMode(argv) {
  for (const a of argv) {
    if (/^[/-]s$/i.test(a)) return { mode: 's' };
    if (/^[/-]p/i.test(a)) return { mode: 'p' };
    if (/^[/-]c/i.test(a)) return { mode: 'c' };
  }
  return { mode: null };
}

let ssWindows = [];
let exited = true;

// `pushConfig(win)` mirrors main.js's own helper so the screensaver windows
// get the same scene/weather/photo config as the real wallpaper. `onExit`
// runs once every screensaver window is torn down - the caller decides
// whether that means quitting the whole process (a bare `/s` launch) or just
// cleaning up on top of an already-running tray instance.
function runFullscreen(pushConfig, onExit) {
  if (!exited) return; // already running
  exited = false;

  ssWindows = screen.getAllDisplays().map((d) => {
    const win = new BrowserWindow({
      x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
      frame: false, resizable: false, movable: false, skipTaskbar: true,
      alwaysOnTop: true, autoHideMenuBar: true, show: false, fullscreenable: true,
      webPreferences: {
        preload: path.join(__dirname, 'screensaver-preload.js'),
        contextIsolation: true, backgroundThrottling: false
      }
    });
    win.setMenu(null);
    win.loadFile(path.join(__dirname, 'wallpaper.html'));
    win.webContents.on('did-finish-load', () => {
      pushConfig(win);
      // exit-on-input: mouse move/click/wheel (with a small movement
      // threshold so mouse jitter doesn't instantly dismiss it) is wired
      // from inside the page via screensaver-preload.js; keyboard is
      // reliable straight from Electron regardless of page focus.
      win.webContents.executeJavaScript(
        '(function(){' +
        '  var sx=null, sy=null;' +
        '  function trigger(){ if (window.lwScreensaver) window.lwScreensaver.exit(); }' +
        '  window.addEventListener("mousedown", trigger, { once:true });' +
        '  window.addEventListener("wheel", trigger, { once:true });' +
        '  window.addEventListener("mousemove", function(e){' +
        '    if (sx===null){ sx=e.screenX; sy=e.screenY; return; }' +
        '    if (Math.abs(e.screenX-sx) > 8 || Math.abs(e.screenY-sy) > 8) trigger();' +
        '  });' +
        '})();'
      ).catch(() => {});
      win.setAlwaysOnTop(true, 'screen-saver');
      win.show();
      win.focus();
    });
    win.webContents.on('before-input-event', () => exit());
    return win;
  });

  ipcMain.removeAllListeners('lw-ss-exit');
  ipcMain.once('lw-ss-exit', () => exit());

  function exit() {
    if (exited) return;
    exited = true;
    ssWindows.forEach((w) => { try { w.destroy(); } catch (e) {} });
    ssWindows = [];
    onExit();
  }
}

// ---- registry wiring: makes Windows invoke `<exePath> /s` on idle timeout ----
// HKCU only (no admin needed). ScreenSaveTimeOut is set only if the user
// hasn't already picked one, so this doesn't quietly override an existing
// idle-timeout preference.
const REG_KEY = 'HKCU\\Control Panel\\Desktop';

function enable(exePath) {
  execFile('reg', ['add', REG_KEY, '/v', 'SCRNSAVE.EXE', '/d', exePath, '/f'], () => {});
  execFile('reg', ['add', REG_KEY, '/v', 'ScreenSaveActive', '/d', '1', '/f'], () => {});
  execFile('reg', ['query', REG_KEY, '/v', 'ScreenSaveTimeOut'], (err) => {
    if (err) execFile('reg', ['add', REG_KEY, '/v', 'ScreenSaveTimeOut', '/d', '600', '/f'], () => {});
  });
}

function disable() {
  execFile('reg', ['add', REG_KEY, '/v', 'ScreenSaveActive', '/d', '0', '/f'], () => {});
}

module.exports = { detectMode, runFullscreen, enable, disable };
