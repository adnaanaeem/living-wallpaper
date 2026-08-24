// Preload for the SETTINGS window. Exposes a minimal, safe IPC surface.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('LW', {
  getConfig:  ()        => ipcRenderer.invoke('lw:get-config'),
  setConfig:  (patch)   => ipcRenderer.invoke('lw:set-config', patch),
  pickPhoto:  ()        => ipcRenderer.invoke('lw:pick-photo'),
  pickPhotos: ()        => ipcRenderer.invoke('lw:pick-photos'),
  clearPhoto: ()        => ipcRenderer.invoke('lw:clear-photo'),
  getDisplays:()        => ipcRenderer.invoke('lw:get-displays'),
  geocode:    (query)   => ipcRenderer.invoke('lw:geocode', query),
  setLocation:(loc)     => ipcRenderer.invoke('lw:set-location', loc),
  close:      ()        => ipcRenderer.invoke('lw:close-settings')
});
