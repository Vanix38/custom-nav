// Gestion des onglets : chaque onglet est un WebContentsView ajouté à la
// fenêtre principale, sous la barre d'interface (onglets + barre d'outils).

const { WebContentsView } = require('electron');
const { EventEmitter } = require('events');

const PARTITION = 'persist:main'; // garde cookies / connexions entre les lancements

class TabManager extends EventEmitter {
  constructor(win, { topOffset, homeUrl, onWebContentsCreated }) {
    super();
    this.win = win;
    this.topOffset = topOffset;
    this.homeUrl = homeUrl;
    this.onWebContentsCreated = onWebContentsCreated;
    this.tabs = new Map(); // id -> { id, view, title, url, favicon, loading }
    this.order = [];
    this.activeId = null;
    this.nextId = 1;

    win.on('resize', () => this.layout());
  }

  create(url = this.homeUrl, { activate = true } = {}) {
    const view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const id = this.nextId++;
    const tab = { id, view, title: 'Nouvel onglet', url, favicon: null, loading: true };
    this.tabs.set(id, tab);
    this.order.push(id);

    const wc = view.webContents;
    const update = (patch) => {
      Object.assign(tab, patch);
      this.emitState();
    };

    wc.on('page-title-updated', (_e, title) => update({ title }));
    wc.on('page-favicon-updated', (_e, favicons) => update({ favicon: favicons[0] || null }));
    wc.on('did-start-loading', () => update({ loading: true }));
    wc.on('did-stop-loading', () => update({ loading: false }));
    wc.on('did-navigate', (_e, navUrl) => update({ url: navUrl, favicon: null }));
    wc.on('did-navigate-in-page', (_e, navUrl, isMainFrame) => {
      if (isMainFrame) update({ url: navUrl });
    });
    wc.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
      if (isMainFrame && code !== -3 /* ABORTED */) {
        update({ title: `Erreur : ${desc}`, url: failedUrl, loading: false });
      }
    });

    // Liens target=_blank et window.open -> nouvel onglet
    wc.setWindowOpenHandler(({ url: openUrl }) => {
      this.create(openUrl);
      return { action: 'deny' };
    });

    if (this.onWebContentsCreated) this.onWebContentsCreated(wc);

    wc.loadURL(url);
    if (activate) this.activate(id);
    else this.emitState();
    return id;
  }

  activate(id) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    if (this.activeId && this.activeId !== id) {
      const prev = this.tabs.get(this.activeId);
      if (prev) this.win.contentView.removeChildView(prev.view);
    }
    this.activeId = id;
    this.win.contentView.addChildView(tab.view);
    this.layout();
    tab.view.webContents.focus();
    this.emitState();
  }

  close(id = this.activeId) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    const idx = this.order.indexOf(id);
    this.order.splice(idx, 1);
    this.tabs.delete(id);
    this.win.contentView.removeChildView(tab.view);
    tab.view.webContents.close();

    if (this.order.length === 0) {
      this.activeId = null;
      this.create(); // toujours garder au moins un onglet
      return;
    }
    if (this.activeId === id) {
      this.activeId = null;
      this.activate(this.order[Math.min(idx, this.order.length - 1)]);
    } else {
      this.emitState();
    }
  }

  active() {
    return this.tabs.get(this.activeId) || null;
  }

  navigate(url) {
    const tab = this.active();
    if (!tab) return;
    tab.view.webContents.loadURL(url);
    tab.view.webContents.focus();
  }

  goBack() {
    const h = this.active()?.view.webContents.navigationHistory;
    if (h && h.canGoBack()) h.goBack();
  }

  goForward() {
    const h = this.active()?.view.webContents.navigationHistory;
    if (h && h.canGoForward()) h.goForward();
  }

  reload() {
    this.active()?.view.webContents.reload();
  }

  stop() {
    this.active()?.view.webContents.stop();
  }

  layout() {
    const tab = this.active();
    if (!tab) return;
    const [width, height] = this.win.getContentSize();
    tab.view.setBounds({ x: 0, y: this.topOffset, width, height: Math.max(0, height - this.topOffset) });
  }

  getState() {
    const active = this.active();
    const h = active?.view.webContents.navigationHistory;
    return {
      activeId: this.activeId,
      canGoBack: !!h && h.canGoBack(),
      canGoForward: !!h && h.canGoForward(),
      tabs: this.order.map((id) => {
        const t = this.tabs.get(id);
        return { id: t.id, title: t.title, url: t.url, favicon: t.favicon, loading: t.loading };
      }),
    };
  }

  emitState() {
    this.emit('state', this.getState());
  }
}

module.exports = { TabManager, PARTITION };
