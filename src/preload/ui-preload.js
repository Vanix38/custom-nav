// Pont sécurisé entre l'interface (renderer) et le processus principal.
// Seule cette API limitée est exposée : pas d'accès à Node dans la page.
const { contextBridge, ipcRenderer } = require('electron');

// Boutons des extensions Chrome (<browser-action-list>), seulement dans la
// fenêtre normale : les fenêtres privées n'ont pas d'extensions.
if (new URLSearchParams(location.search).get('private') !== '1') {
  require('electron-chrome-extensions/browser-action').injectBrowserAction();
}

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
  newPrivateWindow: () => ipcRenderer.send('ui:new-private-window'),
  openExtensions: () => ipcRenderer.send('ui:open-extensions'),

  // moteurs de recherche / IA
  getEngines: () => ipcRenderer.invoke('engines:get-state'),
  onEngines: (cb) => ipcRenderer.on('engines:state', (_e, state) => cb(state)),
  setEngine: (id) => ipcRenderer.send('engines:set-active', id),
  // favoris
  getBookmarks: () => ipcRenderer.invoke('bookmarks:get-state'),
  onBookmarks: (cb) => ipcRenderer.on('bookmarks:state', (_e, state) => cb(state)),
  toggleBookmark: () => ipcRenderer.send('bookmarks:toggle'),
  openBookmark: (id, newTab) => ipcRenderer.send('bookmarks:open', id, newTab),
  manageBookmarks: () => ipcRenderer.send('bookmarks:manage'),
  bookmarkFolderMenu: (id, x, y) => ipcRenderer.send('bookmarks:folder-menu', id, x, y),
  bookmarkOverflowMenu: (ids, x, y) => ipcRenderer.send('bookmarks:overflow-menu', ids, x, y),
  bookmarkContextMenu: (id, x, y) => ipcRenderer.send('bookmarks:context-menu', id, x, y),

  resendTo: (id, fallbackQuery) => ipcRenderer.send('engines:resend', id, fallbackQuery),
  onResendShortcut: (cb) => ipcRenderer.on('ui:resend', (_e, id) => cb(id)),
});
