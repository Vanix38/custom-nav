// Gestion des onglets : chaque onglet est un WebContentsView ajouté à la
// fenêtre principale, sous la barre d'interface (onglets + barre d'outils).

const path = require('path');
const { WebContentsView } = require('electron');
const { EventEmitter } = require('events');
const { extractQuery } = require('./search');
const { isInternalUrl } = require('./internal');

const PRELOAD = path.join(__dirname, '..', 'preload', 'internal-preload.js');

const PARTITION = 'persist:main'; // garde cookies / connexions entre les lancements

// Script exécuté dans la page pour écrire une question dans son champ de saisie
// (sites qui n'acceptent pas la question dans l'URL). N'envoie rien.
function injectScript({ selector, text }) {
  return `(async () => {
    for (let i = 0; i < 60; i++) {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) {
        el.focus();
        if ('value' in el && el.tagName !== 'DIV') {
          el.value = ${JSON.stringify(text)};
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          document.execCommand('insertText', false, ${JSON.stringify(text)});
        }
        return true;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  })()`;
}

// Normalise une cible : chaîne (URL) ou { url, inject?, query? }
const toTarget = (t) => (typeof t === 'string' ? { url: t } : t);

class TabManager extends EventEmitter {
  constructor(win, { topOffset, partition = PARTITION, getHomeUrl, onWebContentsCreated }) {
    super();
    this.win = win;
    this.topOffset = topOffset;
    this.leftInset = 0; // place réservée à gauche (barre des messageries)
    this.partition = partition;
    this.getHomeUrl = getHomeUrl;
    this.onWebContentsCreated = onWebContentsCreated;
    this.tabs = new Map(); // id -> { id, view, title, url, favicon, loading, query }
    this.order = [];
    this.activeId = null;
    this.nextId = 1;

    win.on('resize', () => this.layout());
  }

  create(target, { activate = true } = {}) {
    const { url = this.getHomeUrl(), inject, query = null } = toTarget(target || {});
    const view = new WebContentsView({
      webPreferences: {
        partition: this.partition,
        preload: PRELOAD, // n'expose rien aux sites web, voir internal-preload.js
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const id = this.nextId++;
    const tab = { id, view, title: 'Nouvel onglet', url, favicon: null, loading: true, query };
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
    wc.on('did-navigate', (_e, navUrl) => {
      // Mémorise la question si la page est une page de résultats connue
      update({ url: navUrl, favicon: null, query: extractQuery(navUrl) || tab.query });
    });
    wc.on('did-navigate-in-page', (_e, navUrl, isMainFrame) => {
      if (isMainFrame) update({ url: navUrl, query: extractQuery(navUrl) || tab.query });
    });
    wc.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
      if (isMainFrame && code !== -3 /* ABORTED */) {
        update({ title: `Erreur : ${desc}`, url: failedUrl, loading: false });
      }
    });

    // Un site web ne peut pas ouvrir une page interne (ni dans un cadre, ni
    // par redirection) : seules l'app et les pages internes elles-mêmes le peuvent.
    const guard = (e) => {
      if (isInternalUrl(e.url) && (!e.isMainFrame || !isInternalUrl(wc.getURL()))) e.preventDefault();
    };
    wc.on('will-frame-navigate', guard);
    wc.on('will-redirect', guard);

    // Liens target=_blank et window.open -> nouvel onglet
    wc.setWindowOpenHandler(({ url: openUrl }) => {
      if (!isInternalUrl(openUrl) || isInternalUrl(wc.getURL())) this.create(openUrl);
      return { action: 'deny' };
    });

    if (this.onWebContentsCreated) this.onWebContentsCreated(wc);

    this.load(tab, { url, inject });
    if (activate) this.activate(id);
    else this.emitState();
    return id;
  }

  load(tab, { url, inject }) {
    const wc = tab.view.webContents;
    if (inject) {
      wc.once('did-finish-load', () => {
        wc.executeJavaScript(injectScript(inject)).catch(() => {});
      });
    }
    wc.loadURL(url).catch(() => {}); // les erreurs sont gérées par did-fail-load
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

  tabFor(webContents) {
    for (const tab of this.tabs.values()) if (tab.view.webContents === webContents) return tab;
    return null;
  }

  // Ouvre un onglet existant sur cette URL s'il y en a un, sinon un nouveau
  focusOrCreate(url) {
    const tab = [...this.tabs.values()].find((t) => t.url === url);
    if (tab) this.activate(tab.id);
    else this.create(url);
  }

  // Ouvre une cible dans l'onglet courant (ou dans `tab`)
  navigate(target, tab = this.active()) {
    if (!tab) return;
    const t = toTarget(target);
    if (t.query) tab.query = t.query;
    this.load(tab, t);
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

  setTopOffset(px) {
    this.topOffset = px;
    this.layout();
    this.emit('layout');
  }

  setLeftInset(px) {
    if (px === this.leftInset) return;
    this.leftInset = px;
    this.layout();
  }

  layout() {
    const tab = this.active();
    if (!tab) return;
    const [width, height] = this.win.getContentSize();
    const x = Math.min(this.leftInset, width);
    tab.view.setBounds({ x, y: this.topOffset, width: width - x, height: Math.max(0, height - this.topOffset) });
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
        return { id: t.id, title: t.title, url: t.url, favicon: t.favicon, loading: t.loading, query: t.query };
      }),
    };
  }

  // Onglets à rouvrir au prochain lancement
  snapshot() {
    return {
      tabs: this.order.map((id) => ({ url: this.tabs.get(id).url, query: this.tabs.get(id).query || null })),
      active: Math.max(0, this.order.indexOf(this.activeId)),
    };
  }

  // Envoie un message à toutes les pages internes ouvertes
  broadcastInternal(channel, payload) {
    for (const tab of this.tabs.values()) {
      const wc = tab.view.webContents;
      if (!wc.isDestroyed() && isInternalUrl(wc.getURL())) wc.send(channel, payload);
    }
  }

  emitState() {
    this.emit('state', this.getState());
  }
}

module.exports = { TabManager, PARTITION };
