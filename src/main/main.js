const path = require('path');
const { app, BrowserWindow, ipcMain, nativeTheme, session } = require('electron');
const { TabManager, PARTITION } = require('./tabs');
const { getEngines, getEngine, iconFor, buildEngineTarget, resolveInput, isHttpUrl } = require('./search');
const internal = require('./internal');
const config = require('./config');
const history = require('./history');

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

function openHistory(ctx) {
  ctx.tabs.focusOrCreate(config.HISTORY_PAGE);
}

function newTab(ctx) {
  ctx.tabs.create();
  ctx.win.webContents.focus();
  sendToUi(ctx, 'ui:focus-address');
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
    } else if (ctrl && !input.shift && key === 't') {
      newTab(ctx);
    } else if (ctrl && key === 'w') {
      tabs.close();
    } else if (ctrl && key === 'l') {
      ctx.win.webContents.focus();
      sendToUi(ctx, 'ui:focus-address');
    } else if (ctrl && key === ',') {
      openSettings(ctx);
    } else if (ctrl && !input.shift && key === 'h') {
      openHistory(ctx);
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

  // Historique : seulement la fenêtre normale, rien n'est écrit en navigation privée
  if (!isPrivate) {
    tabs.on('visit', (tab, { inPage }) => {
      tab.historyId = history.addVisit(tab.url, inPage ? tab.title : '');
    });
    tabs.on('title', (tab) => history.setTitle(tab.historyId, tab.url, tab.title));
  }

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
ipcMain.on('ui:open-history', fromUi((ctx) => openHistory(ctx)));
ipcMain.on('ui:new-private-window', fromUi(() => createWindow({ isPrivate: true })));
ipcMain.on('engines:set-active', fromUi((_ctx, id) => setActiveEngine(id)));
ipcMain.on('engines:resend', fromUi((ctx, id, typed) => resendTo(ctx, id, typed)));
ipcMain.handle('tabs:get-state', fromUi(({ tabs }) => tabs.getState()));
ipcMain.handle('engines:get-state', fromUi(() => enginesState()));

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
  'history-list': (opts) => history.list(opts || {}),
  'history-remove': (ids) => history.remove(ids),
  'history-clear': (range) => history.clear(range),
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
    if (args[1] || !tab) tabs.create(url, { activate: args[1] !== 'background' });
    else tabs.navigate(url, tab);
    return {};
  }

  const fn = INTERNAL_ACTIONS[action];
  if (!fn) throw new Error(`Action inconnue : ${action}`);
  const result = await fn(...args);
  if (CHANGES_CONFIG.has(action) && !result?.error) configChanged();
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

app.on('before-quit', () => history.saveNow());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
