// Preload des onglets. Il est chargé pour toutes les pages, mais n'expose
// son API QUE sur les pages internes customnav:// : les sites web n'y ont
// pas accès. Le processus principal revérifie de toute façon l'origine de
// chaque message (isInternalSender).
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'customnav:') {
  const call = (action, ...args) => ipcRenderer.invoke('internal', action, ...args);

  contextBridge.exposeInMainWorld('customNav', {
    getConfig: () => call('get-config'),
    setEngines: (list) => call('set-engines', list),
    resetEngines: () => call('reset-engines'),
    setActiveEngine: (id) => call('set-active-engine', id),
    setHomepage: (homepage) => call('set-homepage', homepage),
    setTheme: (theme) => call('set-theme', theme),
    setRestoreTabs: (on) => call('set-restore-tabs', on),
    setFavorites: (list) => call('set-favorites', list),
    clearBrowsingData: () => call('clear-browsing-data'),
    newPrivateWindow: () => call('new-private-window'),
    // recherche depuis la page d'accueil (newTab : ouvrir dans un nouvel onglet)
    search: (text, engineId, newTab) => call('search', text, engineId, newTab),
    open: (url) => call('open', url),
    // gestionnaire de favoris
    bookmarks: {
      get: () => call('bookmarks-get'),
      addLink: (data) => call('bookmarks-add-link', data),
      addFolder: (data) => call('bookmarks-add-folder', data),
      update: (id, data) => call('bookmarks-update', id, data),
      remove: (id) => call('bookmarks-remove', id),
      move: (id, parentId, index) => call('bookmarks-move', id, parentId, index),
      importSources: () => call('bookmarks-import-sources'),
      importFrom: (browserId) => call('bookmarks-import', browserId),
      setShowBar: (on) => call('bookmarks-set-show-bar', on),
      onChange: (cb) => ipcRenderer.on('internal:bookmarks', (_e, state) => cb(state)),
    },
    // extensions Chrome
    extensions: {
      list: () => call('extensions-list'),
      remove: (id) => call('extensions-remove', id),
      checkUpdates: () => call('extensions-update'),
      openWebStore: () => call('open-web-store'),
      openOptions: (id) => call('open-extension-options', id),
      onChange: (cb) => ipcRenderer.on('internal:extensions', (_e, list) => cb(list)),
    },
    onConfig: (cb) => ipcRenderer.on('internal:config', (_e, config) => cb(config)),
  });
}
