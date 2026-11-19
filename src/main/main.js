const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { TabManager } = require('./tabs');
const { ENGINES, DEFAULT_ENGINE_ID, getEngine, iconFor, buildEngineTarget, resolveInput } = require('./search');
const settings = require('./settings');

// Hauteur initiale de l'interface ; l'interface envoie ensuite sa vraie hauteur.
const CHROME_HEIGHT = 80;

// User-agent sans « Electron/x » ni le nom de l'app : certains sites (Google,
// Gemini…) refusent la connexion ou dégradent la page pour un UA Electron.
app.userAgentFallback = app.userAgentFallback
  .replace(/\sElectron\/\S+/, '')
  .replace(new RegExp(`\\s${app.getName()}/\\S+`), '');

let win = null;
let tabs = null;
let activeEngineId = DEFAULT_ENGINE_ID;

function sendToUi(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function enginesState() {
  return {
    activeId: activeEngineId,
    engines: ENGINES.map((e) => ({ id: e.id, name: e.name, type: e.type, icon: iconFor(e) })),
  };
}

function setActiveEngine(id) {
  activeEngineId = getEngine(id).id;
  settings.set('activeEngine', activeEngineId);
  sendToUi('engines:state', enginesState());
}

// « Renvoyer vers » : la question est posée à un autre moteur, dans un nouvel
// onglet. Question = texte en cours de saisie dans la barre d'adresse s'il y en
// a un, sinon la dernière question mémorisée pour l'onglet courant.
function resendTo(engineId, typed) {
  const query = (typed || tabs.active()?.query || '').trim();
  const engine = getEngine(engineId);
  tabs.create({ ...buildEngineTarget(engine, query), query: query || null });
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
    let handled = true;

    if (ctrl && digit >= 0 && digit < ENGINES.length) {
      if (input.shift) {
        // passe par l'interface, qui connaît le texte en cours de saisie
        sendToUi('ui:resend', ENGINES[digit].id);
      } else {
        setActiveEngine(ENGINES[digit].id);
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

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 600,
    minHeight: 400,
    title: 'Custom Nav',
    backgroundColor: '#1e1f24',
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
    getHomeUrl: () => getEngine(activeEngineId).home,
    onWebContentsCreated: handleShortcuts,
  });
  tabs.on('state', (state) => sendToUi('tabs:state', state));

  handleShortcuts(win.webContents);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.once('did-finish-load', () => tabs.create());

  win.on('closed', () => {
    win = null;
    tabs = null;
  });
}

// --- IPC : actions venant de l'interface ---
ipcMain.on('tabs:new', (_e, input) => {
  if (!tabs) return;
  tabs.create(input ? resolveInput(input, activeEngineId) : undefined);
  if (!input) {
    win.webContents.focus();
    sendToUi('ui:focus-address');
  }
});
ipcMain.on('tabs:close', (_e, id) => tabs?.close(id));
ipcMain.on('tabs:activate', (_e, id) => tabs?.activate(id));
ipcMain.on('nav:go', (_e, input) => tabs?.navigate(resolveInput(input, activeEngineId)));
ipcMain.on('nav:back', () => tabs?.goBack());
ipcMain.on('nav:forward', () => tabs?.goForward());
ipcMain.on('nav:reload', () => tabs?.reload());
ipcMain.on('nav:stop', () => tabs?.stop());
ipcMain.on('ui:chrome-height', (_e, px) => {
  if (Number.isFinite(px) && px > 0) tabs?.setTopOffset(Math.round(px));
});
ipcMain.on('engines:set-active', (_e, id) => setActiveEngine(id));
ipcMain.on('engines:resend', (_e, id, fallback) => tabs && resendTo(id, fallback));
ipcMain.handle('tabs:get-state', () => tabs?.getState() ?? null);
ipcMain.handle('engines:get-state', () => enginesState());

app.whenReady().then(() => {
  activeEngineId = getEngine(settings.get('activeEngine', DEFAULT_ENGINE_ID)).id;
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
