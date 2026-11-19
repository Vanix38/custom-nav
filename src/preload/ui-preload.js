// Pont sécurisé entre l'interface (renderer) et le processus principal.
// Seule cette API limitée est exposée : pas d'accès à Node dans la page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nav', {
  // onglets / navigation
  newTab: (input) => ipcRenderer.send('tabs:new', input),
  closeTab: (id) => ipcRenderer.send('tabs:close', id),
  activateTab: (id) => ipcRenderer.send('tabs:activate', id),
  go: (input) => ipcRenderer.send('nav:go', input),
  back: () => ipcRenderer.send('nav:back'),
  forward: () => ipcRenderer.send('nav:forward'),
  reload: () => ipcRenderer.send('nav:reload'),
  stop: () => ipcRenderer.send('nav:stop'),
  getState: () => ipcRenderer.invoke('tabs:get-state'),
  onState: (cb) => ipcRenderer.on('tabs:state', (_e, state) => cb(state)),
  onFocusAddress: (cb) => ipcRenderer.on('ui:focus-address', () => cb()),
  setChromeHeight: (px) => ipcRenderer.send('ui:chrome-height', px),
  openSettings: () => ipcRenderer.send('ui:open-settings'),

  // moteurs de recherche / IA
  getEngines: () => ipcRenderer.invoke('engines:get-state'),
  onEngines: (cb) => ipcRenderer.on('engines:state', (_e, state) => cb(state)),
  setEngine: (id) => ipcRenderer.send('engines:set-active', id),
  resendTo: (id, fallbackQuery) => ipcRenderer.send('engines:resend', id, fallbackQuery),
  onResendShortcut: (cb) => ipcRenderer.on('ui:resend', (_e, id) => cb(id)),
});
