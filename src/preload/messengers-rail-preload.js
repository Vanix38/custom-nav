// Pont entre la barre des messageries (messengers.html) et le processus principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('messengers', {
  getState: () => ipcRenderer.invoke('messengers:get-state'),
  onState: (cb) => ipcRenderer.on('messengers:state', (_e, state) => cb(state)),
  toggle: (id) => ipcRenderer.send('messengers:toggle', id),
  contextMenu: (id) => ipcRenderer.send('messengers:context-menu', id),
  setOverlay: (dataUrl, description) => ipcRenderer.send('messengers:overlay', dataUrl, description),
});
