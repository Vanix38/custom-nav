// Barre latérale : une icône par intégration (messagerie ou site) avec son badge
// de non-lus. Clic : ouvre / ferme le panneau ; clic droit : menu.
const rail = document.getElementById('rail');
const buttons = new Map();

// Icône : dessin intégré (WhatsApp, Discord), icône du site mise en cache,
// sinon première lettre sur la couleur de l'intégration.
function iconFor(m) {
  const tpl = m.preset && !m.customIcon ? document.getElementById(`icon-${m.preset}`) : null;
  if (tpl) return tpl.content.cloneNode(true);
  if (m.icon) {
    const img = document.createElement('img');
    img.className = 'site-icon';
    img.alt = '';
    img.src = m.icon;
    return img;
  }
  const letter = document.createElement('span');
  letter.className = 'letter-icon';
  letter.textContent = (m.name || '?')[0].toUpperCase();
  if (m.color) letter.style.background = m.color;
  return letter;
}

function buttonFor(m) {
  let btn = buttons.get(m.id);
  const iconKey = `${m.preset}|${m.customIcon}|${m.icon}|${m.name}`;
  if (btn && btn.dataset.iconKey === iconKey) return btn;
  if (!btn) {
    btn = document.createElement('button');
    btn.className = 'messenger';
    btn.dataset.id = m.id;
    const icon = document.createElement('span');
    icon.className = 'icon';
    btn.appendChild(icon);
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.hidden = true;
    btn.appendChild(badge);
    btn.addEventListener('click', () => window.messengers.toggle(m.id));
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.messengers.contextMenu(m.id);
    });
    buttons.set(m.id, btn);
  }
  btn.dataset.iconKey = iconKey;
  btn.querySelector('.icon').replaceChildren(iconFor(m));
  return btn;
}

// clic droit ailleurs sur la barre : gérer / masquer la barre
rail.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.messengers.contextMenu('');
});

// Pastille de la barre des tâches Windows : nombre total de non-lus
let lastOverlay = null;
function updateOverlay(total) {
  const key = String(total);
  if (key === lastOverlay) return;
  lastOverlay = key;
  if (total <= 0) {
    window.messengers.setOverlay(null, '');
    return;
  }
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e5484d';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${total > 9 ? 16 : 20}px "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(total > 99 ? '99+' : String(total), size / 2, size / 2 + 1);
  window.messengers.setOverlay(canvas.toDataURL('image/png'), `${total} message(s) non lu(s)`);
}

function render(state) {
  let total = 0;
  const ids = new Set(state.messengers.map((m) => m.id));
  for (const [id, btn] of buttons) {
    if (!ids.has(id)) {
      btn.remove();
      buttons.delete(id);
    }
  }
  const ordered = state.messengers.map(buttonFor);
  rail.replaceChildren(...ordered);
  for (const m of state.messengers) {
    const btn = buttons.get(m.id);
    const { count, dot } = m.unread;
    if (m.enabled) total += count;
    btn.classList.toggle('open', state.openId === m.id);
    btn.classList.toggle('disabled', !m.enabled);
    btn.setAttribute('aria-pressed', String(state.openId === m.id));

    let title = m.name;
    if (!m.enabled) title += ' (désactivé, cliquer pour l\'activer)';
    else if (count > 0) title += ` – ${count} non lu${count > 1 ? 's' : ''}`;
    else if (dot) title += ' – nouveaux messages';
    btn.title = title;

    const badge = btn.querySelector('.badge');
    badge.hidden = !m.enabled || (count === 0 && !dot);
    badge.classList.toggle('dot', count === 0 && dot);
    badge.textContent = count > 0 ? (count > 99 ? '99+' : String(count)) : '';
  }
  updateOverlay(total);
}

window.messengers.onState(render);
window.messengers.getState().then(render);
