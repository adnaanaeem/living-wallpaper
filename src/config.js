// Simple JSON config persisted in the app's userData folder.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  units:      { temp: 'C', wind: 'kmh' }, // 'C'|'F', 'kmh'|'mph'
  clock:      '12',        // '12' or '24' hour clock
  clockStyle: 'digital',   // 'digital' or 'analog'
  hudPosition: 'top-right', // top-right|top-left|bottom-right|bottom-left
  scene:      'mountains', // mountains|city|beach|desert|forest|aurora|village|rotate|random
  showHud:    true,
  photo:      null,        // absolute path to a single image, or null
  photos:     null,        // ordered array of image paths for day cross-fade, or null
  location:   null,        // { lat, lon, name } or null => auto (IP)
  monitor:    'all',       // 'all' or a display id (number as string)
  autostart:  false,
  pauseOnFullscreen: true,
  sound:      false,       // ambient rain/wind/cricket audio, off by default
  useAsScreensaver: false, // registers this app as the Windows screensaver (packaged app only)
  useAsLockScreen: false   // periodically sets a scene snapshot as the Windows lock screen picture
};

function file() {
  return path.join(app.getPath('userData'), 'config.json');
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return Object.assign({}, DEFAULTS, raw);
  } catch (e) {
    return Object.assign({}, DEFAULTS);
  }
}

function save(cfg) {
  try {
    fs.writeFileSync(file(), JSON.stringify(cfg, null, 2));
  } catch (e) { /* ignore */ }
  return cfg;
}

// Shape passed into the renderer (photo path -> file URL).
function toUrl(p) { return 'file:///' + p.replace(/\\/g, '/'); }
function toRenderer(cfg) {
  return {
    units:    cfg.units,
    clock:    cfg.clock,
    clockStyle: cfg.clockStyle,
    hudPosition: cfg.hudPosition,
    scene:    cfg.scene,
    showHud:  cfg.showHud,
    photo:    cfg.photo ? toUrl(cfg.photo) : null,
    photos:   (cfg.photos && cfg.photos.length) ? cfg.photos.map(toUrl) : null,
    location: cfg.location,
    theme:    'auto',
    sound:    !!cfg.sound
  };
}

module.exports = { DEFAULTS, load, save, toRenderer };
