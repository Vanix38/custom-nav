// Page Historique : liste par jour, recherche, suppression d'entrées ou d'une période.
const api = window.customNav;
const $ = (id) => document.getElementById(id);

const PAGE_SIZE = 200;
let entries = []; // entrées affichées, de la plus récente à la plus ancienne
let more = false;
let query = '';
const selected = new Set();
let lastChecked = null; // pour Shift+clic sur les cases (sélection d'une plage)
let requestNo = 0;

function setStatus(text, kind = '') {
  $('status').textContent = text || '';
  $('status').className = 'status' + (kind ? ' ' + kind : '');
}

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...children);
  return e;
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

function iconFor(url, label) {
  const img = el('img', { className: 'icon', alt: '' });
  img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostOf(url))}&sz=32`;
  img.onerror = () => {
    img.replaceWith(el('span', { className: 'icon letter-icon', textContent: (label || '?')[0].toUpperCase() }));
  };
  return img;
}

const startOfDay = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const dayFormat = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

function dayLabel(dayStart) {
  const today = startOfDay(Date.now());
  const label = dayFormat.format(dayStart);
  if (dayStart === today) return `Aujourd'hui – ${label}`;
  if (dayStart === startOfDay(today - 1)) return `Hier – ${label}`;
  return label[0].toUpperCase() + label.slice(1);
}

// Ouvre une entrée : ici, en nouvel onglet ou en arrière-plan
function open(url, ev) {
  if (ev.ctrlKey || ev.metaKey || ev.button === 1) api.open(url, 'background');
  else if (ev.shiftKey) api.open(url, true);
  else api.open(url);
}

function renderSelection() {
  const n = selected.size;
  $('selection-bar').hidden = n === 0;
  $('selection-count').textContent = `${n} élément${n > 1 ? 's' : ''} sélectionné${n > 1 ? 's' : ''}`;
  for (const row of $('list').querySelectorAll('.entry')) {
    const on = selected.has(Number(row.dataset.id));
    row.classList.toggle('selected', on);
    row.querySelector('input').checked = on;
  }
}

function entryRow(e) {
  const row = el('div', { className: 'entry' });
  row.dataset.id = e.id;
  const title = e.title || e.url;

  const check = el('input', { type: 'checkbox', title: 'Sélectionner' });
  check.setAttribute('aria-label', `Sélectionner « ${title} »`);
  check.addEventListener('click', (ev) => {
    const ids = entries.map((x) => x.id);
    if (ev.shiftKey && lastChecked !== null && ids.includes(lastChecked)) {
      const [a, b] = [ids.indexOf(lastChecked), ids.indexOf(e.id)].sort((x, y) => x - y);
      for (const id of ids.slice(a, b + 1)) {
        if (check.checked) selected.add(id);
        else selected.delete(id);
      }
    } else if (check.checked) selected.add(e.id);
    else selected.delete(e.id);
    lastChecked = e.id;
    renderSelection();
  });

  const link = el('a', { className: 'link', href: e.url, title: `${title}\n${e.url}` },
    el('span', { className: 'title', textContent: title }),
    el('span', { className: 'host', textContent: hostOf(e.url) }));
  link.addEventListener('click', (ev) => {
    ev.preventDefault();
    open(e.url, ev);
  });
  link.addEventListener('auxclick', (ev) => {
    if (ev.button !== 1) return;
    ev.preventDefault();
    open(e.url, ev);
  });

  const remove = el('button', { type: 'button', className: 'remove', textContent: '✕', title: "Retirer de l'historique" });
  remove.setAttribute('aria-label', `Retirer « ${title} » de l'historique`);
  remove.addEventListener('click', () => removeIds([e.id]));

  row.append(check, el('span', { className: 'time', textContent: timeFormat.format(e.time) }), iconFor(e.url, title), link, remove);
  return row;
}

function render() {
  const list = $('list');
  if (entries.length === 0) {
    list.replaceChildren(el('div', {
      className: 'empty',
      textContent: query ? `Aucune page trouvée pour « ${query} ».` : "L'historique est vide.",
    }));
  } else {
    const days = [];
    for (const e of entries) {
      const d = startOfDay(e.time);
      if (!days.length || days[days.length - 1].day !== d) days.push({ day: d, items: [] });
      days[days.length - 1].items.push(e);
    }
    list.replaceChildren(...days.map(({ day, items }) =>
      el('section', { className: 'day' }, el('h2', { textContent: dayLabel(day) }), ...items.map(entryRow))));
  }
  $('more').hidden = !more;
  renderSelection();
}

async function load({ append = false } = {}) {
  const no = ++requestNo;
  const before = append && entries.length ? entries[entries.length - 1].time : undefined;
  const res = await api.historyList({ query, before, limit: PAGE_SIZE });
  if (no !== requestNo) return; // une recherche plus récente est en cours
  entries = append ? entries.concat(res.entries) : res.entries;
  more = res.more;
  if (!append) {
    // garde seulement la sélection encore visible
    const visible = new Set(entries.map((e) => e.id));
    for (const id of [...selected]) if (!visible.has(id)) selected.delete(id);
  }
  render();
}

async function removeIds(ids) {
  const res = await api.historyRemove(ids);
  if (res?.error) {
    setStatus(res.error, 'error');
    return;
  }
  for (const id of ids) selected.delete(id);
  const gone = new Set(ids);
  entries = entries.filter((e) => !gone.has(e.id));
  render();
  setStatus(`${res.removed} page${res.removed > 1 ? 's' : ''} retirée${res.removed > 1 ? 's' : ''} de l'historique.`, 'ok');
}

let filterTimer = null;
$('filter').addEventListener('input', () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => {
    query = $('filter').value.trim();
    setStatus('');
    load();
  }, 150);
});

$('more').addEventListener('click', () => load({ append: true }));
$('delete-selected').addEventListener('click', () => removeIds([...selected]));
$('cancel-selection').addEventListener('click', () => {
  selected.clear();
  renderSelection();
});

$('clear-open').addEventListener('click', () => {
  $('clear-confirm').hidden = false;
  $('clear-range').focus();
});
$('clear-no').addEventListener('click', () => {
  $('clear-confirm').hidden = true;
});
$('clear-yes').addEventListener('click', async () => {
  const res = await api.historyClear($('clear-range').value);
  $('clear-confirm').hidden = true;
  if (res?.error) {
    setStatus(res.error, 'error');
    return;
  }
  selected.clear();
  setStatus(`Historique effacé (${res.removed} page${res.removed > 1 ? 's' : ''}).`, 'ok');
  load();
});

// Échap : vide la recherche, puis la sélection
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  if (!$('clear-confirm').hidden) $('clear-confirm').hidden = true;
  else if ($('filter').value) {
    $('filter').value = '';
    $('filter').dispatchEvent(new Event('input'));
  } else if (selected.size) {
    selected.clear();
    renderSelection();
  }
});

// L'historique change pendant que la page est ouverte : on recharge en revenant dessus
// (sauf si une sélection est en cours ou si plusieurs pages ont été chargées)
function refresh() {
  if (!document.hidden && selected.size === 0 && entries.length <= PAGE_SIZE) load();
}
document.addEventListener('visibilitychange', refresh);
window.addEventListener('focus', refresh);

api.getConfig().then((c) => {
  if (c.isPrivate) $('private-note').hidden = false;
});
load();
