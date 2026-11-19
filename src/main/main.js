const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { TabManager } = require('./tabs');
const { resolveInput, HOME_URL } = require('./search');

// Hauteur de l'interface (barre d'onglets + barre d'outils), doit
// correspondre à --chrome-height dans src/renderer/styles.css
const CHROME_HEIGHT = 80;

let win = null;
let tabs = null;

function sendToUi(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Raccourcis clavier, interceptés à la fois dans l'interface et dans les pages
function handleShortcuts(webContents) {
  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    const key = input.key.toLowerCase();
    let handled = true;

    if (ctrl && !input.shift && key === 't') {
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
    homeUrl: HOME_URL,
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
  tabs.create(input ? resolveInput(input) : undefined);
  if (!input) {
    win.webContents.focus();
    sendToUi('ui:focus-address');
  }
});
ipcMain.on('tabs:close', (_e, id) => tabs?.close(id));
ipcMain.on('tabs:activate', (_e, id) => tabs?.activate(id));
ipcMain.on('nav:go', (_e, input) => tabs?.navigate(resolveInput(input)));
ipcMain.on('nav:back', () => tabs?.goBack());
ipcMain.on('nav:forward', () => tabs?.goForward());
ipcMain.on('nav:reload', () => tabs?.reload());
ipcMain.on('nav:stop', () => tabs?.stop());
ipcMain.handle('tabs:get-state', () => tabs?.getState() ?? null);

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
