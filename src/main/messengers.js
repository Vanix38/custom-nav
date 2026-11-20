// Messageries intégrées (WhatsApp, Discord) : une barre verticale à gauche de
// la fenêtre normale, avec une icône par messagerie. Un clic ouvre la
// messagerie dans un panneau ancré à côté de la barre (les onglets se décalent
// vers la droite) ; un second clic le referme.
//
// Chaque messagerie tourne dans son propre WebContentsView, chargé au démarrage
// et gardé en vie quand le panneau est fermé : les messages arrivent, le badge
// de non-lus se met à jour et les notifications Windows s'affichent même quand
// on ne la regarde pas. Chaque messagerie a sa propre session persistante
// (`persist:messenger-<id>`), séparée de celle des onglets : on reste connecté
// entre les lancements, et « Effacer les données de navigation » ne déconnecte
// pas WhatsApp / Discord.

const fs = require('fs');
const path = require('path');
const { app, WebContentsView, Menu, dialog, session, nativeImage, ipcMain } = require('electron');

const RAIL_WIDTH = 48;
const WIDTHS = { narrow: 420, medium: 640, wide: 900 };
const WIDTH_LABELS = { narrow: 'Étroit', medium: 'Moyen', wide: 'Large', full: 'Toute la fenêtre' };

const MESSENGERS = [
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    url: 'https://web.whatsapp.com/',
    hosts: ['whatsapp.com', 'whatsapp.net'],
    defaultWidth: 'medium',
  },
  {
    id: 'discord',
    name: 'Discord',
    url: 'https://discord.com/app',
    hosts: ['discord.com', 'discordapp.com', 'discord.gg', 'discord.new', 'hcaptcha.com'],
    defaultWidth: 'wide',
  },
];

// Permissions accordées aux messageries : notifications, micro / caméra (notes
// vocales, appels), presse-papiers, plein écran. Le reste est refusé.
const ALLOWED_PERMISSIONS = new Set([
  'notifications',
  'media',
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',
  'speaker-selection',
]);

const partitionFor = (id) => `persist:messenger-${id}`;
const byId = (id) => MESSENGERS.find((m) => m.id === id);

const hostMatches = (url, hosts) => {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'https:') return false;
    return hosts.some((h) => hostname === h || hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
};

// --- État enregistré (dans son propre fichier, pas dans settings.json) ---
const statePath = () => path.join(app.getPath('userData'), 'messengers.json');

function defaultState() {
  return {
    railVisible: true,
    open: null, // messagerie affichée dans le panneau, rouverte au lancement suivant
    items: Object.fromEntries(MESSENGERS.map((m) => [m.id, { enabled: true, width: m.defaultWidth }])),
  };
}

let state = null;
function loadState() {
  const base = defaultState();
  try {
    const saved = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    state = {
      railVisible: saved.railVisible !== false,
      open: byId(saved.open) ? saved.open : null,
      items: Object.fromEntries(MESSENGERS.map((m) => {
        const s = saved.items?.[m.id] || {};
        return [m.id, {
          enabled: s.enabled !== false,
          width: s.width in WIDTHS || s.width === 'full' ? s.width : m.defaultWidth,
        }];
      })),
    };
  } catch {
    state = base;
  }
}

let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
    } catch {
      /* disque plein / dossier en lecture seule : on garde l'état en mémoire */
    }
  }, 300);
}

// --- Sessions des messageries (une seule fois par partition) ---
const preparedSessions = new Set();
function prepareSession(id) {
  if (preparedSessions.has(id)) return;
  preparedSessions.add(id);
  const ses = session.fromPartition(partitionFor(id));
  // Même user-agent que les onglets (Chrome sans « Electron/x ») : WhatsApp Web
  // affiche sinon « Mettez à jour votre navigateur ».
  ses.setUserAgent(app.userAgentFallback);
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
}

// Nombre de non-lus d'après le titre de la page :
// WhatsApp « (3) WhatsApp », Discord « (3) Discord | … » ou « • Discord | … »
// (messages non lus sans mention).
function unreadFromTitle(title) {
  const m = /^\((\d+)\)/.exec(title || '');
  if (m) return { count: Number(m[1]), dot: false };
  if (/^[•●]/.test(title || '')) return { count: 0, dot: true };
  return { count: 0, dot: false };
}

class MessengerPanel {
  constructor({ win, tabs, openInTab, onShortcut }) {
    this.win = win;
    this.tabs = tabs;
    this.openInTab = openInTab;
    this.onShortcut = onShortcut;
    this.views = new Map(); // id -> { view, unread, loaded }
    this.openId = null;
    this.lastUnreadTotal = 0;

    this.rail = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'messengers-rail-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.rail.setBackgroundColor('#00000000');
    this.rail.webContents.loadFile(path.join(__dirname, '..', 'renderer', 'messengers.html'));
    this.rail.webContents.on('before-input-event', (e, input) => this.handleKeys(e, input));
    this.rail.webContents.once('did-finish-load', () => this.sendState());

    this.onResize = () => this.layout();
    this.onLayout = () => this.layout();
    win.on('resize', this.onResize);
    tabs.on('layout', this.onLayout);

    for (const m of MESSENGERS) if (state.items[m.id].enabled) this.createView(m);
    if (state.railVisible) win.contentView.addChildView(this.rail);
    if (state.open && state.items[state.open].enabled && state.railVisible) this.show(state.open, { focus: false });
    this.layout();
  }

  createView(m) {
    if (this.views.has(m.id)) return this.views.get(m.id);
    prepareSession(m.id);
    const view = new WebContentsView({
      webPreferences: {
        partition: partitionFor(m.id),
        preload: path.join(__dirname, '..', 'preload', 'messenger-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false, // messages et notifications à l'heure, panneau fermé ou non
        spellcheck: true,
      },
    });
    const entry = { view, unread: { count: 0, dot: false }, loaded: false };
    this.views.set(m.id, entry);
    const wc = view.webContents;

    wc.on('page-title-updated', (_e, title) => {
      entry.unread = unreadFromTitle(title);
      this.sendState();
    });
    wc.on('did-finish-load', () => {
      entry.loaded = true;
      this.sendState();
    });
    wc.on('before-input-event', (e, input) => this.handleKeys(e, input));

    // Liens externes (et tout ce qui sort du site de la messagerie) : nouvel
    // onglet du navigateur, dans la session normale.
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) this.openInTab(url);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (e) => {
      if (!hostMatches(e.url, m.hosts)) {
        e.preventDefault();
        if (/^https?:/i.test(e.url)) this.openInTab(e.url);
      }
    });

    wc.loadURL(m.url).catch(() => {});
    return entry;
  }

  destroyView(id) {
    const entry = this.views.get(id);
    if (!entry) return;
    if (this.openId === id) this.hide();
    this.views.delete(id);
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
  }

  // Ouvre / ferme le panneau d'une messagerie
  toggle(id) {
    if (this.openId === id) this.hide();
    else this.show(id);
  }

  show(id, { focus = true } = {}) {
    const m = byId(id);
    if (!m) return;
    if (!state.items[id].enabled) {
      state.items[id].enabled = true;
      saveState();
    }
    if (!state.railVisible) this.setRailVisible(true);
    const entry = this.createView(m);
    if (this.openId && this.openId !== id) {
      const prev = this.views.get(this.openId);
      if (prev) this.win.contentView.removeChildView(prev.view);
    }
    this.openId = id;
    this.win.contentView.addChildView(entry.view);
    state.open = id;
    saveState();
    this.layout();
    if (focus) entry.view.webContents.focus();
    this.sendState();
  }

  hide() {
    if (!this.openId) return;
    const entry = this.views.get(this.openId);
    if (entry) this.win.contentView.removeChildView(entry.view);
    this.openId = null;
    state.open = null;
    saveState();
    this.layout();
    this.tabs.active()?.view.webContents.focus();
    this.sendState();
  }

  setRailVisible(visible) {
    if (state.railVisible === visible) return;
    state.railVisible = visible;
    saveState();
    if (visible) {
      this.win.contentView.addChildView(this.rail);
    } else {
      this.hide();
      this.win.contentView.removeChildView(this.rail);
    }
    this.layout();
    this.sendState();
  }

  toggleRail() {
    this.setRailVisible(!state.railVisible);
  }

  panelWidth(id, available) {
    const w = state.items[id].width;
    if (w === 'full') return available;
    // laisse toujours au moins 320 px aux onglets
    return Math.max(0, Math.min(WIDTHS[w], available - 320));
  }

  layout() {
    if (this.win.isDestroyed()) return;
    const [width, height] = this.win.getContentSize();
    const top = this.tabs.topOffset;
    const h = Math.max(0, height - top);
    let left = 0;
    if (state.railVisible) {
      this.rail.setBounds({ x: 0, y: top, width: RAIL_WIDTH, height: h });
      left = RAIL_WIDTH;
    }
    if (this.openId) {
      const entry = this.views.get(this.openId);
      const w = this.panelWidth(this.openId, width - left);
      entry.view.setBounds({ x: left, y: top, width: w, height: h });
      left += w;
    }
    this.tabs.setLeftInset(left);
  }

  handleKeys(event, input) {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    const key = input.key.toLowerCase();
    if (ctrl && input.shift && key === 'm') {
      this.toggleRail();
      event.preventDefault();
    } else if (key === 'f5' || (ctrl && key === 'r')) {
      // recharge la messagerie affichée, pas l'onglet
      if (this.openId) this.views.get(this.openId)?.view.webContents.reload();
      event.preventDefault();
    } else if (ctrl && key === 'w') {
      // Ctrl+W dans une messagerie referme le panneau, pas un onglet
      this.hide();
      event.preventDefault();
    } else if (this.onShortcut && !input.alt) {
      // autres raccourcis du navigateur (Ctrl+T, Ctrl+L, Ctrl+1…)
      this.onShortcut(event, input);
    }
  }

  // Menu du clic droit sur une icône de la barre
  showContextMenu(id) {
    const m = byId(id);
    if (!m) return;
    const item = state.items[id];
    const entry = this.views.get(id);
    const template = [
      { label: this.openId === id ? `Fermer ${m.name}` : `Ouvrir ${m.name}`, click: () => this.toggle(id) },
      { label: 'Recharger', enabled: !!entry, click: () => entry?.view.webContents.reload() },
      { type: 'separator' },
      {
        label: 'Largeur du panneau',
        submenu: Object.entries(WIDTH_LABELS).map(([value, label]) => ({
          label,
          type: 'radio',
          checked: item.width === value,
          click: () => {
            item.width = value;
            saveState();
            this.layout();
          },
        })),
      },
      { type: 'separator' },
      item.enabled
        ? { label: `Désactiver ${m.name}`, click: () => this.setEnabled(id, false) }
        : { label: `Activer ${m.name}`, click: () => this.setEnabled(id, true) },
      { label: 'Se déconnecter…', click: () => this.logout(m) },
      { type: 'separator' },
      { label: 'Masquer la barre des messageries (Ctrl+Shift+M)', click: () => this.setRailVisible(false) },
    ];
    Menu.buildFromTemplate(template).popup({ window: this.win });
  }

  setEnabled(id, enabled) {
    state.items[id].enabled = enabled;
    saveState();
    if (enabled) this.createView(byId(id));
    else this.destroyView(id);
    this.sendState();
  }

  async logout(m) {
    const { response } = await dialog.showMessageBox(this.win, {
      type: 'question',
      buttons: ['Se déconnecter', 'Annuler'],
      defaultId: 1,
      cancelId: 1,
      title: `Se déconnecter de ${m.name}`,
      message: `Se déconnecter de ${m.name} ?`,
      detail: 'Les cookies et données locales de cette messagerie dans Explora seront effacés. '
        + 'Il faudra vous reconnecter (pour WhatsApp : rescanner le QR code).',
    });
    if (response !== 0) return;
    const ses = session.fromPartition(partitionFor(m.id));
    await ses.clearStorageData().catch(() => {});
    await ses.clearCache().catch(() => {});
    const entry = this.views.get(m.id);
    if (entry) {
      entry.unread = { count: 0, dot: false };
      entry.view.webContents.loadURL(m.url).catch(() => {});
    }
    this.sendState();
  }

  // Clic sur une notification d'une messagerie : on ramène la fenêtre et on
  // ouvre le panneau correspondant.
  notificationClicked(webContents) {
    for (const [id, entry] of this.views) {
      if (entry.view.webContents === webContents) {
        if (this.win.isMinimized()) this.win.restore();
        this.win.show();
        this.win.focus();
        if (this.openId !== id) this.show(id);
        return;
      }
    }
  }

  ownsWebContents(wc) {
    if (wc === this.rail.webContents) return true;
    for (const entry of this.views.values()) if (entry.view.webContents === wc) return true;
    return false;
  }

  getState() {
    return {
      railVisible: state.railVisible,
      openId: this.openId,
      messengers: MESSENGERS.map((m) => {
        const entry = this.views.get(m.id);
        return {
          id: m.id,
          name: m.name,
          enabled: state.items[m.id].enabled,
          unread: entry ? entry.unread : { count: 0, dot: false },
        };
      }),
    };
  }

  sendState() {
    const s = this.getState();
    if (!this.rail.webContents.isDestroyed()) this.rail.webContents.send('messengers:state', s);

    // Barre des tâches : clignote quand un nouveau message arrive fenêtre en
    // arrière-plan (la pastille de nombre est dessinée par la barre, voir
    // setOverlay).
    const total = s.messengers.reduce((n, m) => n + (m.enabled ? m.unread.count : 0), 0);
    if (total > this.lastUnreadTotal && !this.win.isDestroyed() && !this.win.isFocused()) {
      this.win.flashFrame(true);
    }
    this.lastUnreadTotal = total;
  }

  setOverlay(dataUrl, description) {
    if (this.win.isDestroyed() || process.platform !== 'win32') return;
    const img = dataUrl ? nativeImage.createFromDataURL(dataUrl) : null;
    this.win.setOverlayIcon(img && !img.isEmpty() ? img : null, description || '');
  }

  destroy() {
    clearTimeout(saveTimer);
    try {
      fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
    } catch {
      /* ignoré */
    }
    this.win.removeListener('resize', this.onResize);
    this.tabs.removeListener('layout', this.onLayout);
    for (const id of [...this.views.keys()]) {
      const entry = this.views.get(id);
      this.views.delete(id);
      if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
    }
    if (!this.rail.webContents.isDestroyed()) this.rail.webContents.close();
  }
}

// --- Point d'entrée : une barre de messageries pour la fenêtre normale ---
let panel = null;
let ipcReady = false;

function setupIpc() {
  if (ipcReady) return;
  ipcReady = true;
  const fromRail = (fn) => (event, ...args) => {
    if (panel && event.sender === panel.rail.webContents) return fn(...args);
    return undefined;
  };
  ipcMain.handle('messengers:get-state', fromRail(() => panel.getState()));
  ipcMain.on('messengers:toggle', fromRail((id) => panel.toggle(String(id))));
  ipcMain.on('messengers:context-menu', fromRail((id) => panel.showContextMenu(String(id))));
  ipcMain.on('messengers:overlay', fromRail((dataUrl, description) => {
    panel.setOverlay(typeof dataUrl === 'string' ? dataUrl : null, String(description || ''));
  }));
  ipcMain.on('messenger:notification-click', (event) => {
    if (panel) panel.notificationClicked(event.sender);
  });
}

// Attache la barre à la fenêtre normale. `openInTab(url)` ouvre un lien dans
// un onglet ; `onShortcut(event, input)` relaie les autres raccourcis clavier.
function attach({ win, tabs, openInTab, onShortcut }) {
  if (!state) loadState();
  setupIpc();
  if (panel) panel.destroy();
  panel = new MessengerPanel({ win, tabs, openInTab, onShortcut });
  win.on('closed', () => {
    if (panel && panel.win === win) {
      panel.destroy();
      panel = null;
    }
  });
  return panel;
}

const toggleRail = () => panel?.toggleRail();
const ownsWebContents = (wc) => !!panel && panel.ownsWebContents(wc);

module.exports = { attach, toggleRail, ownsWebContents, MESSENGERS, unreadFromTitle };
