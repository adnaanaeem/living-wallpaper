// Preload for the fullscreen SCREENSAVER windows only. Exposes nothing but a
// one-way "dismiss" signal, wired up by screensaver.js's injected listener
// script (mousemove past a threshold / click / wheel).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lwScreensaver', {
  exit: () => ipcRenderer.send('lw-ss-exit')
});
