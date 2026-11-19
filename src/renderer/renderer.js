// Interface du navigateur : dessine les onglets et relaie les actions au
// processus principal via window.nav (exposé par le preload).

const $ = (id) => document.getElementById(id);
const tabsEl = $('tabs');
const address = $('address');
const backBtn = $('back');
const forwardBtn = $('forward');
const reloadBtn = $('reload');

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
    address.value = active?.url || '';
    addressDirty = false;
  }
  document.title = active ? `${active.title} – Custom Nav` : 'Custom Nav';
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
