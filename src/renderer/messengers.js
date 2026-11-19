// Barre verticale des messageries : une icône par messagerie avec son badge
// de non-lus. Clic : ouvre / ferme le panneau ; clic droit : menu.
const rail = document.getElementById('rail');
const buttons = new Map();

function iconFor(id) {
  const tpl = document.getElementById(`icon-${id}`);
  return tpl ? tpl.content.cloneNode(true) : document.createTextNode(id[0].toUpperCase());
}

function buttonFor(m) {
  let btn = buttons.get(m.id);
  if (btn) return btn;
  btn = document.createElement('button');
  btn.className = 'messenger';
  btn.dataset.id = m.id;
  btn.appendChild(iconFor(m.id));
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.hidden = true;
  btn.appendChild(badge);
  btn.addEventListener('click', () => window.messengers.toggle(m.id));
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.messengers.contextMenu(m.id);
  });
  rail.appendChild(btn);
  buttons.set(m.id, btn);
  return btn;
}

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
  for (const m of state.messengers) {
    const btn = buttonFor(m);
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
