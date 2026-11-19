const path = require('path');
const { app, BrowserWindow, Menu, ipcMain, nativeTheme, session } = require('electron');
const { TabManager, PARTITION } = require('./tabs');
const { getEngines, getEngine, iconFor, buildEngineTarget, resolveInput, isHttpUrl } = require('./search');
const internal = require('./internal');
const config = require('./config');
const bookmarks = require('./bookmarks');

// Hauteur initiale de l'interface ; l'interface envoie ensuite sa vraie hauteur.
const CHROME_HEIGHT = 80;

// Dossier des réglages et sessions : toujours %APPDATA%custom-nav, que l'app
// soit lancée avec npm start ou installée (sinon productName « Custom Nav »
// changerait le dossier et ferait perdre réglages et connexions).
app.setPath('userData', path.join(app.getPath('appData'), 'custom-nav'));

const APP_ICON = path.join(__dirname, '..', '..', 'build', 'icon.ico');

// User-agent sans « Electron/x » ni le nom de l'app : certains sites (Google,
// Gemini…) refusent la connexion ou dégradent la page pour un UA Electron.
app.userAgentFallback = app.userAgentFallback
  .replace(/\sElectron\/\S+/, '')
  .replace(/\s(?:Custom Nav|custom-nav)\/\S+/gi, '');

internal.registerScheme();

// Une entrée par fenêtre ouverte : { win, tabs, isPrivate, partition }.
// Il y a au plus une fenêtre normale (celle dont les onglets sont rouverts au
// lancement suivant) et autant de fenêtres privées que l'on veut.
const windows = new Set();
let mainCtx = null; // la fenêtre normale, si elle est ouverte
let privateCount = 0;

const activeEngineId = () => config.getConfig().activeEngine;

function sendToUi(ctx, channel, payload) {
  if (ctx && !ctx.win.isDestroyed()) ctx.win.webContents.send(channel, payload);
}

function sendToAllUis(channel, payload) {
  for (const ctx of windows) sendToUi(ctx, channel, payload);
}

// Fenêtre à laquelle appartient un webContents (interface ou onglet)
function ctxFor(webContents) {
  for (const ctx of windows) {
    if (ctx.win.webContents === webContents || ctx.tabs.tabFor(webContents)) return ctx;
  }
  return null;
}

function enginesState() {
  return {
    activeId: activeEngineId(),
    engines: getEngines().map((e) => ({ id: e.id, name: e.name, type: e.type, icon: iconFor(e) })),
  };
}

// Configuration envoyée aux pages internes (avec les icônes pour l'affichage)
function internalConfig() {
  const cfg = config.getConfig();
  return { ...cfg, engines: cfg.engines.map((e) => ({ ...e, icon: iconFor(e) })) };
}

function applyTheme() {
  nativeTheme.themeSource = config.getConfig().theme; // pilote aussi prefers-color-scheme des pages
}

// Après chaque modification des réglages : tout le monde se met à jour
function configChanged() {
  applyTheme();
  sendToAllUis('engines:state', enginesState());
  for (const ctx of windows) ctx.tabs.broadcastInternal('internal:config', internalConfig());
}

function setActiveEngine(id) {
  config.setActiveEngine(id);
  configChanged();
}

// « Renvoyer vers » : la question est posée à un autre moteur, dans un nouvel
// onglet. Question = texte en cours de saisie dans la barre d'adresse s'il y en
// a un, sinon la dernière question mémorisée pour l'onglet courant.
function resendTo(ctx, engineId, typed) {
  const query = (typed || ctx.tabs.active()?.query || '').trim();
  ctx.tabs.create({ ...buildEngineTarget(getEngine(engineId), query), query: query || null });
}

function openSettings(ctx) {
  ctx.tabs.focusOrCreate(config.SETTINGS_PAGE);
}

function newTab(ctx) {
  ctx.tabs.create();
  ctx.win.webContents.focus();
  sendToUi(ctx, 'ui:focus-address');
}

// --- Favoris ---
function bookmarksState() {
  return { tree: bookmarks.getTree(), showBar: config.getConfig().showBookmarksBar };
}

// Après chaque modification des favoris : barres et pages internes à jour
function bookmarksChanged() {
  const state = bookmarksState();
  sendToAllUis('bookmarks:state', state);
  for (const ctx of windows) ctx.tabs.broadcastInternal('internal:bookmarks', state);
}

// Ctrl+D / étoile : ajoute la page courante aux favoris, ou l'en retire
function toggleBookmark(ctx) {
  const tab = ctx.tabs.active();
  if (!tab || !isHttpUrl(tab.url)) return;
  if (bookmarks.findByUrl(tab.url)) bookmarks.removeUrl(tab.url);
  else bookmarks.addLink({ title: tab.title, url: tab.url });
  bookmarksChanged();
}

function toggleBookmarksBar() {
  config.setShowBookmarksBar(!config.getConfig().showBookmarksBar);
  bookmarksChanged();
}

function openBookmarksManager(ctx) {
  ctx.tabs.focusOrCreate(config.BOOKMARKS_PAGE);
}

function openBookmark(ctx, node, inNewTab) {
  if (!node || node.type !== 'link' || !isHttpUrl(node.url)) return;
  if (inNewTab) ctx.tabs.create(node.url, { activate: false });
  else ctx.tabs.navigate(node.url);
}

function openAllInFolder(ctx, folder) {
  for (const n of folder.children) if (n.type === 'link') ctx.tabs.create(n.url, { activate: false });
}

// Éléments de menu natif pour une liste de favoris (sous-menus pour les dossiers)
function bookmarkMenuItems(ctx, nodes) {
  if (nodes.length === 0) return [{ label: '(vide)', enabled: false }];
  return nodes.map((n) => {
    const label = (n.title || n.url || '').replace(/&/g, '&&').slice(0, 80);
    if (n.type === 'folder') {
      const links = n.children.filter((c) => c.type === 'link').length;
      return {
        label,
        submenu: [
          ...bookmarkMenuItems(ctx, n.children),
          ...(links ? [{ type: 'separator' }, { label: `Tout ouvrir (${links})`, click: () => openAllInFolder(ctx, n) }] : []),
        ],
      };
    }
    return { label: label || n.url, click: (_item, _win, e) => openBookmark(ctx, n, e?.ctrlKey) };
  });
}

function popupMenu(ctx, template, x, y) {
  Menu.buildFromTemplate(template).popup({ window: ctx.win, x: Math.round(x), y: Math.round(y) });
}

function bookmarkContextMenu(ctx, node) {
  const remove = { label: 'Supprimer', click: () => { bookmarks.remove(node.id); bookmarksChanged(); } };
  const manage = { label: 'Gérer les favoris…', click: () => openBookmarksManager(ctx) };
  if (node.type === 'folder') {
    const links = node.children.filter((c) => c.type === 'link').length;
    return [
      { label: `Tout ouvrir (${links})`, enabled: links > 0, click: () => openAllInFolder(ctx, node) },
      { type: 'separator' }, manage, remove,
    ];
  }
  return [
    { label: 'Ouvrir', click: () => openBookmark(ctx, node, false) },
    { label: 'Ouvrir dans un nouvel onglet', click: () => openBookmark(ctx, node, true) },
    { type: 'separator' }, manage, remove,
  ];
}

// Ctrl+chiffre / Ctrl+Shift+chiffre : on lit `code` (Digit1…) et non `key`,
// pour que ça marche aussi en AZERTY où les chiffres demandent Shift.
function digitIndex(input) {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(input.code || '');
  return m ? Number(m[1]) - 1 : -1;
}

// Raccourcis clavier, interceptés à la fois dans l'interface et dans les pages
function handleShortcuts(webContents) {
  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const ctx = ctxFor(webContents);
    if (!ctx) return;
    const { tabs } = ctx;
    const ctrl = input.control || input.meta;
    const key = input.key.toLowerCase();
    const digit = digitIndex(input);
    const engines = getEngines();
    let handled = true;

    if (ctrl && digit >= 0 && digit < engines.length) {
      if (input.shift) {
        // passe par l'interface, qui connaît le texte en cours de saisie
        sendToUi(ctx, 'ui:resend', engines[digit].id);
      } else {
        setActiveEngine(engines[digit].id);
      }
    } else if (ctrl && input.shift && key === 'n') {
      createWindow({ isPrivate: true });
    } else if (ctrl && !input.shift && key === 'n') {
      openNormalWindow();
    } else if (ctrl && !input.shift && key === 'd') {
      toggleBookmark(ctx);
    } else if (ctrl && input.shift && key === 'b') {
      toggleBookmarksBar();
    } else if (ctrl && input.shift && key === 'o') {
      openBookmarksManager(ctx);
    } else if (ctrl && !input.shift && key === 't') {
      newTab(ctx);
    } else if (ctrl && key === 'w') {
      tabs.close();
    } else if (ctrl && key === 'l') {
      ctx.win.webContents.focus();
      sendToUi(ctx, 'ui:focus-address');
    } else if (ctrl && key === ',') {
      openSettings(ctx);
    } else if (key === 'f5' || (ctrl && key === 'r')) {
      tabs.reload();
    } else if (input.alt && key === 'arrowleft') {
      tabs.goBack();
    } else if (input.alt && key === 'arrowright') {
      tabs.goForward();
    } else if (ctrl && key === 'tab') {
      const i = tabs.order.indexOf(tabs.activeId);
      const n = tabs.order.length;
      tabs.activate(tabs.order[(i + (input.shift ? n - 1 : 1)) % n]);
    } else {
      handled = false;
    }
    if (handled) event.preventDefault();
  });
}

// --- Session : onglets rouverts au prochain lancement ---
// Seule la fenêtre normale est enregistrée : rien de ce qui se passe dans une
// fenêtre privée n'est écrit sur le disque.
let saveTimer = null;
function saveSessionSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSessionNow, 1000);
}
function saveSessionNow() {
  clearTimeout(saveTimer);
  if (!mainCtx) return;
  config.saveSession(config.getConfig().restoreTabs ? mainCtx.tabs.snapshot() : null);
}

function openInitialTabs(ctx, restore) {
  const last = restore && config.getConfig().restoreTabs ? config.getLastSession() : null;
  const saved = (last?.tabs || []).filter((t) => isHttpUrl(t.url) || internal.isInternalUrl(t.url));
  if (saved.length === 0) {
    newTab(ctx);
    return;
  }
  const ids = saved.map((t) => ctx.tabs.create({ url: t.url, query: t.query }, { activate: false }));
  ctx.tabs.activate(ids[Math.min(last.active || 0, ids.length - 1)]);
}

const windowBackground = (isPrivate) => {
  if (isPrivate) return nativeTheme.shouldUseDarkColors ? '#221c30' : '#dcd5ee';
  return nativeTheme.shouldUseDarkColors ? '#1e1f24' : '#e9eaee';
};

// Ctrl+N : ramène la fenêtre normale (ou la rouvre si elle a été fermée)
function openNormalWindow() {
  if (!mainCtx) {
    createWindow({ restore: false });
    return;
  }
  if (mainCtx.win.isMinimized()) mainCtx.win.restore();
  mainCtx.win.focus();
}

// Fenêtre normale (session persistante `persist:main`) ou privée : session en
// mémoire seulement (pas de préfixe « persist: »), propre à la fenêtre et vidée
// dès sa fermeture ; ses onglets ne sont jamais enregistrés.
function createWindow({ isPrivate = false, restore = true } = {}) {
  if (!isPrivate && mainCtx) {
    openNormalWindow();
    return mainCtx;
  }
  const partition = isPrivate ? `private-${Date.now()}-${++privateCount}` : PARTITION;
  if (isPrivate) internal.handleProtocol(session.fromPartition(partition));

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 600,
    minHeight: 400,
    title: isPrivate ? 'Custom Nav – Navigation privée' : 'Custom Nav',
    icon: APP_ICON,
    backgroundColor: windowBackground(isPrivate),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'ui-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenu(null);

  const tabs = new TabManager(win, {
    topOffset: CHROME_HEIGHT,
    partition,
    // en privé, toujours la page d'accueil interne (elle affiche le bandeau « privé »)
    getHomeUrl: () => (isPrivate ? config.HOME_PAGE : config.homeUrl()),
    onWebContentsCreated: handleShortcuts,
  });
  const ctx = { win, tabs, isPrivate, partition };
  windows.add(ctx);
  if (!isPrivate) mainCtx = ctx;

  tabs.on('state', (state) => {
    sendToUi(ctx, 'tabs:state', state);
    if (!isPrivate) saveSessionSoon();
  });

  handleShortcuts(win.webContents);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), {
    query: isPrivate ? { private: '1' } : {},
  });
  win.webContents.once('did-finish-load', () => openInitialTabs(ctx, !isPrivate && restore));

  if (!isPrivate) win.on('close', saveSessionNow);
  win.on('closed', () => {
    windows.delete(ctx);
    if (mainCtx === ctx) mainCtx = null;
    if (isPrivate) {
      const ses = session.fromPartition(partition);
      ses.clearStorageData().catch(() => {});
      ses.clearCache().catch(() => {});
      ses.clearAuthCache().catch(() => {});
    }
  });
  return ctx;
}

nativeTheme.on('updated', () => {
  for (const ctx of windows) {
    if (!ctx.win.isDestroyed()) ctx.win.setBackgroundColor(windowBackground(ctx.isPrivate));
  }
});

// --- IPC : actions venant de l'interface (barre d'onglets / d'outils) ---
// Ces canaux ne sont exposés qu'au preload de l'interface : on vérifie quand
// même que l'expéditeur est bien l'interface d'une de nos fenêtres.
const fromUi = (handler) => (event, ...args) => {
  for (const ctx of windows) {
    if (event.sender === ctx.win.webContents) return handler(ctx, ...args);
  }
  return undefined;
};

ipcMain.on('tabs:new', fromUi((ctx, input) => {
  if (input) ctx.tabs.create(resolveInput(input, activeEngineId()));
  else newTab(ctx);
}));
ipcMain.on('tabs:close', fromUi(({ tabs }, id) => tabs.close(id)));
ipcMain.on('tabs:activate', fromUi(({ tabs }, id) => tabs.activate(id)));
ipcMain.on('nav:go', fromUi(({ tabs }, input) => tabs.navigate(resolveInput(input, activeEngineId()))));
ipcMain.on('nav:back', fromUi(({ tabs }) => tabs.goBack()));
ipcMain.on('nav:forward', fromUi(({ tabs }) => tabs.goForward()));
ipcMain.on('nav:reload', fromUi(({ tabs }) => tabs.reload()));
ipcMain.on('nav:stop', fromUi(({ tabs }) => tabs.stop()));
ipcMain.on('ui:chrome-height', fromUi(({ tabs }, px) => {
  if (Number.isFinite(px) && px > 0) tabs.setTopOffset(Math.round(px));
}));
ipcMain.on('ui:open-settings', fromUi((ctx) => openSettings(ctx)));
ipcMain.on('ui:new-private-window', fromUi(() => createWindow({ isPrivate: true })));
ipcMain.on('engines:set-active', fromUi((_ctx, id) => setActiveEngine(id)));
ipcMain.on('engines:resend', fromUi((ctx, id, typed) => resendTo(ctx, id, typed)));
ipcMain.handle('tabs:get-state', fromUi(({ tabs }) => tabs.getState()));
ipcMain.handle('engines:get-state', fromUi(() => enginesState()));

ipcMain.handle('bookmarks:get-state', fromUi(() => bookmarksState()));
ipcMain.on('bookmarks:toggle', fromUi((ctx) => toggleBookmark(ctx)));
ipcMain.on('bookmarks:open', fromUi((ctx, id, inNewTab) => openBookmark(ctx, bookmarks.getNode(id), !!inNewTab)));
ipcMain.on('bookmarks:manage', fromUi((ctx) => openBookmarksManager(ctx)));
// Menus natifs : dossier de la barre, favoris qui ne tiennent pas (»), clic droit
ipcMain.on('bookmarks:folder-menu', fromUi((ctx, id, x, y) => {
  const node = bookmarks.getNode(id);
  if (node?.type !== 'folder') return;
  const links = node.children.filter((c) => c.type === 'link').length;
  popupMenu(ctx, [
    ...bookmarkMenuItems(ctx, node.children),
    ...(links ? [{ type: 'separator' }, { label: `Tout ouvrir (${links})`, click: () => openAllInFolder(ctx, node) }] : []),
  ], x, y);
}));
ipcMain.on('bookmarks:overflow-menu', fromUi((ctx, ids, x, y) => {
  const nodes = (Array.isArray(ids) ? ids : []).map((id) => bookmarks.getNode(id)).filter(Boolean);
  popupMenu(ctx, bookmarkMenuItems(ctx, nodes), x, y);
}));
ipcMain.on('bookmarks:context-menu', fromUi((ctx, id, x, y) => {
  const node = bookmarks.getNode(id);
  if (node) popupMenu(ctx, bookmarkContextMenu(ctx, node), x, y);
}));

// --- IPC : pages internes (accueil, réglages) ---
const INTERNAL_ACTIONS = {
  'set-engines': (list) => config.setEngines(list),
  'reset-engines': () => config.resetEngines(),
  'set-active-engine': (id) => config.setActiveEngine(id),
  'set-homepage': (homepage) => config.setHomepage(homepage),
  'set-theme': (theme) => config.setTheme(theme),
  'set-restore-tabs': (on) => {
    const r = config.setRestoreTabs(on);
    saveSessionNow();
    return r;
  },
  'set-favorites': (list) => config.setFavorites(list),
  // gestionnaire de favoris (customnav://bookmarks/)
  'bookmarks-get': () => bookmarksState(),
  'bookmarks-add-link': (data) => bookmarks.addLink(data),
  'bookmarks-add-folder': (data) => bookmarks.addFolder(data),
  'bookmarks-update': (id, data) => bookmarks.update(id, data),
  'bookmarks-remove': (id) => bookmarks.remove(id),
  'bookmarks-move': (id, parentId, index) => bookmarks.move(id, parentId, index),
  'bookmarks-import-sources': () => bookmarks.importSources(),
  'bookmarks-import': (browserId) => bookmarks.importFrom(browserId),
  'bookmarks-set-show-bar': (on) => config.setShowBookmarksBar(on),
  'clear-browsing-data': async () => {
    const ses = session.fromPartition(PARTITION);
    await ses.clearStorageData(); // cookies, localStorage, IndexedDB, service workers…
    await ses.clearCache();
    await ses.clearAuthCache();
    return { ok: true };
  },
};
const CHANGES_CONFIG = new Set(['set-engines', 'reset-engines', 'set-active-engine', 'set-homepage', 'set-theme', 'set-restore-tabs', 'set-favorites']);

ipcMain.handle('internal', async (event, action, ...args) => {
  const ctx = ctxFor(event.sender);
  if (!internal.isInternalSender(event) || !ctx) throw new Error('Accès refusé');
  const { tabs } = ctx;
  const tab = tabs.tabFor(event.sender);

  if (action === 'get-config') return { ...internalConfig(), isPrivate: ctx.isPrivate };
  if (action === 'new-private-window') {
    createWindow({ isPrivate: true });
    return {};
  }
  if (action === 'search') {
    const [text, engineId, newTab] = args;
    const target = resolveInput(String(text || ''), engineId || activeEngineId());
    if (newTab || !tab) tabs.create(target);
    else tabs.navigate(target, tab);
    return {};
  }
  if (action === 'open') {
    const url = String(args[0] || '');
    if (!isHttpUrl(url)) return { error: 'Adresse invalide.' };
    tabs.navigate(url, tab || undefined);
    return {};
  }

  const fn = INTERNAL_ACTIONS[action];
  if (!fn) throw new Error(`Action inconnue : ${action}`);
  const result = await fn(...args);
  if (CHANGES_CONFIG.has(action) && !result?.error) configChanged();
  if (action.startsWith('bookmarks-') && action !== 'bookmarks-get' && action !== 'bookmarks-import-sources' && !result?.error) {
    bookmarksChanged();
  }
  return result;
});

app.whenReady().then(() => {
  config.load();
  internal.handleProtocol(session.fromPartition(PARTITION));
  applyTheme();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
