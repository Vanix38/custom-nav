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
    // newTab : true (nouvel onglet) ou 'background' (sans l'afficher)
    open: (url, newTab) => call('open', url, newTab),
    // historique de navigation
    historyList: (opts) => call('history-list', opts),
    historyRemove: (ids) => call('history-remove', ids),
    historyClear: (range) => call('history-clear', range),
    onConfig: (cb) => ipcRenderer.on('internal:config', (_e, config) => cb(config)),
  });
}
