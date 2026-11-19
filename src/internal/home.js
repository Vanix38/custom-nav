// Page d'accueil des nouveaux onglets : recherche + pastilles + favoris.
const api = window.customNav;
const q = document.getElementById('q');
const enginesEl = document.getElementById('engines');
const favoritesEl = document.getElementById('favorites');
const activeIcon = document.getElementById('active-icon');
let cfg = null;

function icon(src, label, cls) {
  const img = document.createElement('img');
  img.className = cls;
  img.alt = '';
  img.src = src;
  img.onerror = () => {
    const span = document.createElement('span');
    span.className = cls + ' letter-icon';
    span.textContent = (label || '?')[0].toUpperCase();
    img.replaceWith(span);
  };
  return img;
}

const faviconFor = (url) => {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`;
  } catch {
    return '';
  }
};

function render() {
  const active = cfg.engines.find((e) => e.id === cfg.activeEngine) || cfg.engines[0];
  q.placeholder = `${active.type === 'ai' ? 'Demander à' : 'Rechercher sur'} ${active.name}…`;
  activeIcon.src = active.icon;

  enginesEl.replaceChildren(...cfg.engines.map((e, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pill' + (e.id === active.id ? ' active' : '');
    b.title = `${e.name}${i < 9 ? ` (Ctrl+${i + 1})` : ''}\nShift+clic : ouvrir dans un nouvel onglet`;
    const name = document.createElement('span');
    name.textContent = e.name;
    b.append(icon(e.icon, e.name, 'engine-icon'), name);
    b.addEventListener('mousedown', (ev) => ev.preventDefault()); // garde le focus dans la recherche
    b.addEventListener('click', async (ev) => {
      const text = q.value.trim();
      if (ev.shiftKey) {
        api.search(text, e.id, true);
        return;
      }
      await api.setActiveEngine(e.id);
      if (text) api.search(text, e.id, false);
      else q.focus();
    });
    return b;
  }));

  favoritesEl.replaceChildren(...cfg.favorites.map((f) => {
    const a = document.createElement('a');
    a.className = 'fav';
    a.href = f.url;
    a.title = f.url;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = f.name;
    a.append(icon(faviconFor(f.url), f.name, ''), name);
    return a;
  }));
}

document.getElementById('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = q.value.trim();
  if (text) api.search(text, null, false);
});

api.onConfig((c) => { cfg = c; render(); });
api.getConfig().then((c) => { cfg = c; render(); });
