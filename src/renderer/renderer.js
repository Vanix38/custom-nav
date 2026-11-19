// Interface du navigateur : dessine les onglets et relaie les actions au
// processus principal via window.nav (exposé par le preload).

const $ = (id) => document.getElementById(id);
const tabsEl = $('tabs');
const address = $('address');
const backBtn = $('back');
const forwardBtn = $('forward');
const reloadBtn = $('reload');

// Fenêtre privée : main.js charge l'interface avec ?private=1
const isPrivate = new URLSearchParams(location.search).get('private') === '1';
if (isPrivate) {
  document.documentElement.classList.add('private');
  $('private-badge').hidden = false;
}

let state = { tabs: [], activeId: null, canGoBack: false, canGoForward: false };
let addressDirty = false; // l'utilisateur est en train de taper

function render() {
  tabsEl.replaceChildren(
    ...state.tabs.map((tab) => {
      const el = document.createElement('div');
      el.className = 'tab' + (tab.id === state.activeId ? ' active' : '');
      el.title = tab.title;
      el.setAttribute('role', 'tab');

      let icon;
      if (tab.loading || !tab.favicon) {
        icon = document.createElement('span');
      } else {
        icon = document.createElement('img');
        icon.src = tab.favicon;
        icon.onerror = () => icon.replaceWith(document.createElement('span'));
      }
      icon.className = 'favicon' + (tab.loading ? ' loading' : '');

      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = tab.title || tab.url;

      const close = document.createElement('button');
      close.className = 'close';
      close.title = 'Fermer (Ctrl+W)';
      close.textContent = '×';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        window.nav.closeTab(tab.id);
      });

      el.append(icon, title, close);
      el.addEventListener('mousedown', (e) => {
        if (e.button === 1) window.nav.closeTab(tab.id); // clic molette
        else if (e.button === 0) window.nav.activateTab(tab.id);
      });
      return el;
    })
  );

  const active = state.tabs.find((t) => t.id === state.activeId);
  backBtn.disabled = !state.canGoBack;
  forwardBtn.disabled = !state.canGoForward;
  reloadBtn.textContent = active?.loading ? '✕' : '↻';
  reloadBtn.title = active?.loading ? 'Arrêter' : 'Recharger (F5)';

  if (!addressDirty || document.activeElement !== address) {
    // la page d'accueil interne affiche une barre d'adresse vide
    address.value = active && !active.url.startsWith('customnav://home') ? active.url : '';
    addressDirty = false;
  }
  const appName = isPrivate ? 'Custom Nav (navigation privée)' : 'Custom Nav';
  document.title = active ? `${active.title} – ${appName}` : appName;
  renderStar(); // appelé après le chargement du script (événements IPC)
}

window.nav.onState((s) => {
  const switched = s.activeId !== state.activeId;
  state = s;
  if (switched) addressDirty = false;
  render();
});

window.nav.onFocusAddress(() => {
  address.focus();
  address.select();
});

$('new-tab').addEventListener('click', () => {
  window.nav.newTab();
});
$('settings').addEventListener('click', () => window.nav.openSettings());
$('private-window').addEventListener('click', () => window.nav.newPrivateWindow());
$('extensions').addEventListener('click', () => window.nav.openExtensions());
if (isPrivate) {
  // pas d'extensions en navigation privée
  $('extension-actions').remove();
  $('extensions').hidden = true;
}
backBtn.addEventListener('click', () => window.nav.back());
forwardBtn.addEventListener('click', () => window.nav.forward());
reloadBtn.addEventListener('click', () => {
  const active = state.tabs.find((t) => t.id === state.activeId);
  if (active?.loading) window.nav.stop();
  else window.nav.reload();
});

address.addEventListener('input', () => { addressDirty = true; });
address.addEventListener('focus', () => address.select());
address.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    addressDirty = false;
    render();
    address.blur();
  }
});

$('address-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const value = address.value.trim();
  if (!value) return;
  addressDirty = false;
  address.blur();
  window.nav.go(value);
});

window.nav.getState().then((s) => { if (s) { state = s; render(); } });

// --- Sélecteur moteurs de recherche / IA ---
const engineSlot = $('engine-slot');
let engines = { activeId: null, engines: [] };

// Texte tapé par l'utilisateur (et pas l'URL affichée de l'onglet)
const typedText = () => (addressDirty ? address.value.trim() : '');

function renderEngines() {
  const items = [];
  engines.engines.forEach((eng, i) => {
    if (i > 0 && eng.type !== engines.engines[i - 1].type) {
      const sep = document.createElement('span');
      sep.className = 'engine-sep';
      items.push(sep);
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'engine' + (eng.id === engines.activeId ? ' active' : '');
    btn.setAttribute('aria-pressed', String(eng.id === engines.activeId));
    const shortcut = i < 9 ? ` (Ctrl+${i + 1})` : '';
    btn.title = `${eng.name}${shortcut}\nShift+clic : renvoyer la question vers ${eng.name} dans un nouvel onglet`;

    const icon = document.createElement('img');
    icon.src = eng.icon;
    icon.alt = '';
    icon.onerror = () => {
      const letter = document.createElement('span');
      letter.className = 'letter';
      letter.textContent = eng.name[0];
      icon.replaceWith(letter);
    };
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = eng.name;
    btn.append(icon, name);

    // garder le focus (et le texte tapé) dans la barre d'adresse
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => {
      if (e.shiftKey) {
        resend(eng.id);
        return;
      }
      window.nav.setEngine(eng.id);
      const text = typedText();
      if (text) {
        // une question est en cours de saisie : on la pose au moteur choisi
        addressDirty = false;
        address.blur();
        window.nav.go(text);
      } else {
        address.focus();
      }
    });
    items.push(btn);
  });
  engineSlot.replaceChildren(...items);

  const active = engines.engines.find((e) => e.id === engines.activeId);
  address.placeholder = active
    ? `${active.type === 'ai' ? 'Demander à' : 'Rechercher sur'} ${active.name} ou saisir une adresse`
    : 'Rechercher ou saisir une adresse';
}

function resend(engineId) {
  const text = typedText();
  addressDirty = false;
  address.blur();
  window.nav.resendTo(engineId, text);
}

window.nav.onEngines((s) => { engines = s; renderEngines(); });
window.nav.onResendShortcut((id) => resend(id));
window.nav.getEngines().then((s) => { engines = s; renderEngines(); });

// --- Favoris : étoile de la barre d'adresse + barre de favoris ---
const star = $('star');
const bmBar = $('bookmarks-bar');
const bmItems = $('bookmarks-items');
const bmMore = $('bookmarks-more');
let bm = { tree: { children: [] }, showBar: true };
let bookmarkedUrls = new Set();
let hiddenIds = []; // favoris qui ne tiennent pas dans la barre (menu »)

function collectUrls(node, out) {
  for (const c of node.children || []) {
    if (c.type === 'link') out.add(c.url);
    else collectUrls(c, out);
  }
  return out;
}

function faviconFor(url) {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`;
  } catch {
    return '';
  }
}

function renderStar() {
  const active = state.tabs.find((t) => t.id === state.activeId);
  const url = active?.url || '';
  const can = /^https?:\/\//i.test(url);
  const on = can && bookmarkedUrls.has(url);
  star.disabled = !can;
  star.textContent = on ? '★' : '☆';
  star.setAttribute('aria-pressed', String(on));
  star.title = on ? 'Retirer des favoris (Ctrl+D)' : 'Ajouter aux favoris (Ctrl+D)';
}

function bookmarkButton(node) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'bm';
  b.dataset.id = node.id;
  let ico;
  if (node.type === 'folder') {
    ico = document.createElement('span');
    ico.className = 'ico';
    ico.textContent = '📁';
    b.title = node.title;
  } else {
    ico = document.createElement('img');
    ico.alt = '';
    ico.src = faviconFor(node.url);
    ico.onerror = () => {
      const s = document.createElement('span');
      s.className = 'ico';
      s.textContent = '☆';
      ico.replaceWith(s);
    };
    b.title = node.title ? `${node.title}\n${node.url}` : node.url;
  }
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = node.title || (node.type === 'link' ? node.url : 'Dossier');
  b.append(ico, label);

  b.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
  b.addEventListener('click', (e) => {
    const r = b.getBoundingClientRect();
    if (node.type === 'folder') window.nav.bookmarkFolderMenu(node.id, r.left, r.bottom);
    else window.nav.openBookmark(node.id, e.ctrlKey || e.metaKey);
  });
  b.addEventListener('auxclick', (e) => {
    if (e.button === 1 && node.type === 'link') window.nav.openBookmark(node.id, true); // clic molette
  });
  b.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.nav.bookmarkContextMenu(node.id, e.clientX, e.clientY);
  });
  return b;
}

// Les favoris qui dépassent sont masqués et proposés dans le menu »
function layoutBookmarks() {
  const buttons = [...bmItems.querySelectorAll('.bm')];
  const overflowing = () => {
    const limit = bmItems.getBoundingClientRect().right + 0.5;
    return buttons.filter((b) => b.getBoundingClientRect().right > limit);
  };
  buttons.forEach((b) => b.classList.remove('overflow'));
  bmMore.hidden = true;
  let hidden = overflowing();
  if (hidden.length) {
    bmMore.hidden = false; // le bouton » prend de la place : on remesure
    hidden = overflowing();
  }
  hidden.forEach((b) => b.classList.add('overflow'));
  hiddenIds = hidden.map((b) => b.dataset.id);
}

function renderBookmarks() {
  bookmarkedUrls = collectUrls(bm.tree, new Set());
  bmBar.hidden = !bm.showBar;
  const nodes = bm.tree.children || [];
  if (nodes.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'empty';
    empty.append('Ajoute la page courante avec ☆ ou Ctrl+D. ');
    const link = document.createElement('a');
    link.textContent = 'Importer depuis Chrome ou Edge…';
    link.addEventListener('click', () => window.nav.manageBookmarks());
    empty.append(link);
    bmItems.replaceChildren(empty);
  } else {
    bmItems.replaceChildren(...nodes.map(bookmarkButton));
  }
  layoutBookmarks();
  renderStar();
}

star.addEventListener('mousedown', (e) => e.preventDefault());
star.addEventListener('click', () => window.nav.toggleBookmark());
bmMore.addEventListener('click', () => {
  const r = bmMore.getBoundingClientRect();
  window.nav.bookmarkOverflowMenu(hiddenIds, r.left, r.bottom);
});
new ResizeObserver(layoutBookmarks).observe(bmItems);

window.nav.onBookmarks((s) => { bm = s; renderBookmarks(); });
window.nav.getBookmarks().then((s) => { if (s) { bm = s; renderBookmarks(); } });

// La zone des pages commence sous l'interface : on transmet sa hauteur réelle
const chromeEl = $('chrome');
new ResizeObserver(() => window.nav.setChromeHeight(chromeEl.offsetHeight)).observe(chromeEl);
