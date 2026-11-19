const path = require('path');
const { app, BrowserWindow, ipcMain, nativeTheme, session } = require('electron');
const { TabManager, PARTITION } = require('./tabs');
const { getEngines, getEngine, iconFor, buildEngineTarget, resolveInput, isHttpUrl } = require('./search');
const internal = require('./internal');
const config = require('./config');

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

let win = null;
let tabs = null;

const activeEngineId = () => config.getConfig().activeEngine;

function sendToUi(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
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
  sendToUi('engines:state', enginesState());
  tabs?.broadcastInternal('internal:config', internalConfig());
}

function setActiveEngine(id) {
  config.setActiveEngine(id);
  configChanged();
}

// « Renvoyer vers » : la question est posée à un autre moteur, dans un nouvel
// onglet. Question = texte en cours de saisie dans la barre d'adresse s'il y en
// a un, sinon la dernière question mémorisée pour l'onglet courant.
function resendTo(engineId, typed) {
  const query = (typed || tabs.active()?.query || '').trim();
  tabs.create({ ...buildEngineTarget(getEngine(engineId), query), query: query || null });
}

function openSettings() {
  tabs.focusOrCreate(config.SETTINGS_PAGE);
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
    const ctrl = input.control || input.meta;
    const key = input.key.toLowerCase();
    const digit = digitIndex(input);
    const engines = getEngines();
    let handled = true;

    if (ctrl && digit >= 0 && digit < engines.length) {
      if (input.shift) {
        // passe par l'interface, qui connaît le texte en cours de saisie
        sendToUi('ui:resend', engines[digit].id);
      } else {
        setActiveEngine(engines[digit].id);
      }
    } else if (ctrl && !input.shift && key === 't') {
      tabs.create();
      win.webContents.focus();
      sendToUi('ui:focus-address');
    } else if (ctrl && key === 'w') {
      tabs.close();
    } else if (ctrl && key === 'l') {
      win.webContents.focus();
      sendToUi('ui:focus-address');
    } else if (ctrl && key === ',') {
      openSettings();
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
let saveTimer = null;
function saveSessionSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSessionNow, 1000);
}
function saveSessionNow() {
  clearTimeout(saveTimer);
  if (!tabs) return;
  config.saveSession(config.getConfig().restoreTabs ? tabs.snapshot() : null);
}

function openInitialTabs() {
  const last = config.getConfig().restoreTabs ? config.getLastSession() : null;
  const saved = (last?.tabs || []).filter((t) => isHttpUrl(t.url) || internal.isInternalUrl(t.url));
  if (saved.length === 0) {
    tabs.create();
    win.webContents.focus();
    sendToUi('ui:focus-address');
    return;
  }
  const ids = saved.map((t) => tabs.create({ url: t.url, query: t.query }, { activate: false }));
  tabs.activate(ids[Math.min(last.active || 0, ids.length - 1)]);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 600,
    minHeight: 400,
    title: 'Custom Nav',
    icon: APP_ICON,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1f24' : '#e9eaee',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'ui-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenu(null);

  tabs = new TabManager(win, {
    topOffset: CHROME_HEIGHT,
    getHomeUrl: () => config.homeUrl(),
    onWebContentsCreated: handleShortcuts,
  });
  tabs.on('state', (state) => {
    sendToUi('tabs:state', state);
    saveSessionSoon();
  });

  handleShortcuts(win.webContents);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.once('did-finish-load', openInitialTabs);

  win.on('close', saveSessionNow);
  win.on('closed', () => {
    win = null;
    tabs = null;
  });
}

nativeTheme.on('updated', () => {
  if (win && !win.isDestroyed()) win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1e1f24' : '#e9eaee');
});

// --- IPC : actions venant de l'interface (barre d'onglets / d'outils) ---
// Ces canaux ne sont exposés qu'au preload de l'interface : on vérifie quand
// même que l'expéditeur est bien la fenêtre principale.
const fromUi = (handler) => (event, ...args) => {
  if (win && event.sender === win.webContents && tabs) return handler(...args);
  return undefined;
};

ipcMain.on('tabs:new', fromUi((input) => {
  tabs.create(input ? resolveInput(input, activeEngineId()) : undefined);
  if (!input) {
    win.webContents.focus();
    sendToUi('ui:focus-address');
  }
}));
ipcMain.on('tabs:close', fromUi((id) => tabs.close(id)));
ipcMain.on('tabs:activate', fromUi((id) => tabs.activate(id)));
ipcMain.on('nav:go', fromUi((input) => tabs.navigate(resolveInput(input, activeEngineId()))));
ipcMain.on('nav:back', fromUi(() => tabs.goBack()));
ipcMain.on('nav:forward', fromUi(() => tabs.goForward()));
ipcMain.on('nav:reload', fromUi(() => tabs.reload()));
ipcMain.on('nav:stop', fromUi(() => tabs.stop()));
ipcMain.on('ui:chrome-height', fromUi((px) => {
  if (Number.isFinite(px) && px > 0) tabs.setTopOffset(Math.round(px));
}));
ipcMain.on('ui:open-settings', fromUi(() => openSettings()));
ipcMain.on('engines:set-active', fromUi((id) => setActiveEngine(id)));
ipcMain.on('engines:resend', fromUi((id, typed) => resendTo(id, typed)));
ipcMain.handle('tabs:get-state', fromUi(() => tabs.getState()));
ipcMain.handle('engines:get-state', fromUi(() => enginesState()));

// --- IPC : pages internes (accueil, réglages) ---
const INTERNAL_ACTIONS = {
  'get-config': () => internalConfig(),
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
  if (!internal.isInternalSender(event) || !tabs) throw new Error('Accès refusé');
  const tab = tabs.tabFor(event.sender);

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
