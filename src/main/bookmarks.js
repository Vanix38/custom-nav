// Favoris (marque-pages) : un arbre de liens et de dossiers enregistré dans
// settings.json sous la clé `bookmarks`. La racine est la barre de favoris.
//   lien    : { id, type: 'link', title, url }
//   dossier : { id, type: 'folder', title, children: [...] }
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const settings = require('./settings');
const { isHttpUrl } = require('./search');

const ROOT_ID = 'bar';
const MAX_TITLE = 200;

let root = null;

const newId = () => crypto.randomBytes(6).toString('hex');

// Nettoie un arbre lu sur le disque ou importé (ignore ce qui n'est pas valide)
function sanitize(items, depth = 0) {
  if (!Array.isArray(items) || depth > 20) return [];
  const out = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const title = String(it.title || '').slice(0, MAX_TITLE);
    const id = typeof it.id === 'string' && it.id ? it.id : newId();
    if (it.type === 'folder') {
      out.push({ id, type: 'folder', title: title || 'Dossier', children: sanitize(it.children, depth + 1) });
    } else if (isHttpUrl(String(it.url || ''))) {
      out.push({ id, type: 'link', title, url: String(it.url) });
    }
  }
  return out;
}

function load() {
  if (!root) root = { id: ROOT_ID, type: 'folder', title: 'Barre de favoris', children: sanitize(settings.get('bookmarks', [])) };
  return root;
}

function save() {
  settings.set('bookmarks', load().children);
}

// Recherche d'un nœud et de son parent
function find(id, node = load(), parent = null) {
  if (node.id === id) return { node, parent };
  if (node.type !== 'folder') return null;
  for (const child of node.children) {
    const r = find(id, child, node);
    if (r) return r;
  }
  return null;
}

function* walk(node = load()) {
  for (const child of node.children) {
    yield child;
    if (child.type === 'folder') yield* walk(child);
  }
}

const getTree = () => load();

function getNode(id) {
  const r = typeof id === 'string' ? find(id) : null;
  return r && r.parent ? r.node : null; // pas la racine
}

function findByUrl(url) {
  for (const n of walk()) if (n.type === 'link' && n.url === url) return n;
  return null;
}

function folderOrRoot(parentId) {
  const r = parentId ? find(parentId) : null;
  return r && r.node.type === 'folder' ? r.node : load();
}

function cleanTitle(title, fallback) {
  const t = String(title ?? '').trim().slice(0, MAX_TITLE);
  return t || fallback;
}

// --- modifications (renvoient { error } en cas de refus) ---

function addLink({ title, url, parentId } = {}) {
  url = String(url || '').trim();
  if (!isHttpUrl(url)) return { error: "Seules les adresses http:// et https:// peuvent être ajoutées aux favoris." };
  let fallback = url;
  try { fallback = new URL(url).hostname; } catch { /* garde l'URL */ }
  const node = { id: newId(), type: 'link', title: cleanTitle(title, fallback), url };
  folderOrRoot(parentId).children.push(node);
  save();
  return { id: node.id };
}

function addFolder({ title, parentId } = {}) {
  const node = { id: newId(), type: 'folder', title: cleanTitle(title, 'Nouveau dossier'), children: [] };
  folderOrRoot(parentId).children.push(node);
  save();
  return { id: node.id };
}

function update(id, { title, url } = {}) {
  const r = find(id);
  if (!r || r.node === load()) return { error: 'Favori introuvable.' };
  const { node } = r;
  if (title !== undefined) node.title = cleanTitle(title, node.type === 'folder' ? 'Dossier' : node.title);
  if (node.type === 'link' && url !== undefined) {
    url = String(url).trim();
    if (!isHttpUrl(url)) return { error: "L'adresse doit commencer par http:// ou https://." };
    node.url = url;
  }
  save();
  return {};
}

function remove(id) {
  const r = find(id);
  if (!r || !r.parent) return { error: 'Favori introuvable.' };
  r.parent.children.splice(r.parent.children.indexOf(r.node), 1);
  save();
  return {};
}

// Supprime tous les favoris pointant vers cette URL (bouton étoile)
function removeUrl(url) {
  let removed = false;
  const prune = (folder) => {
    folder.children = folder.children.filter((c) => {
      if (c.type === 'link' && c.url === url) { removed = true; return false; }
      if (c.type === 'folder') prune(c);
      return true;
    });
  };
  prune(load());
  if (removed) save();
  return {};
}

// Déplace un nœud dans un dossier, à une position (fin par défaut)
function move(id, parentId, index) {
  const r = find(id);
  if (!r || !r.parent) return { error: 'Favori introuvable.' };
  const target = folderOrRoot(parentId);
  // interdit de mettre un dossier dans lui-même ou dans un de ses sous-dossiers
  if (r.node.type === 'folder' && (target === r.node || find(target.id, r.node))) {
    return { error: 'Impossible de déplacer un dossier dans lui-même.' };
  }
  const from = r.parent.children.indexOf(r.node);
  r.parent.children.splice(from, 1);
  let i = Number.isInteger(index) ? index : target.children.length;
  if (target === r.parent && Number.isInteger(index) && index > from) i -= 1;
  target.children.splice(Math.max(0, Math.min(i, target.children.length)), 0, r.node);
  save();
  return {};
}

// --- import depuis Chrome / Edge / Brave (fichier « Bookmarks » du profil par défaut) ---
const BROWSERS = [
  { id: 'chrome', name: 'Google Chrome', dir: ['Google', 'Chrome', 'User Data'] },
  { id: 'edge', name: 'Microsoft Edge', dir: ['Microsoft', 'Edge', 'User Data'] },
  { id: 'brave', name: 'Brave', dir: ['BraveSoftware', 'Brave-Browser', 'User Data'] },
];

const bookmarksFile = (b) => path.join(process.env.LOCALAPPDATA || '', ...b.dir, 'Default', 'Bookmarks');

function importSources() {
  return BROWSERS.filter((b) => process.env.LOCALAPPDATA && fs.existsSync(bookmarksFile(b))).map(({ id, name }) => ({ id, name }));
}

// Format Chromium : { roots: { bookmark_bar, other, synced } }, nœuds { type: 'url'|'folder', name, url, children }
function fromChromium(nodes) {
  return sanitize((nodes || []).map(function conv(n) {
    if (n.type === 'folder') return { type: 'folder', title: n.name, children: (n.children || []).map(conv) };
    return { type: 'link', title: n.name, url: n.url };
  }));
}

function importFrom(browserId) {
  const b = BROWSERS.find((x) => x.id === browserId);
  if (!b) return { error: 'Navigateur inconnu.' };
  let data;
  try {
    data = JSON.parse(fs.readFileSync(bookmarksFile(b), 'utf8'));
  } catch {
    return { error: `Favoris de ${b.name} introuvables ou illisibles.` };
  }
  const roots = data?.roots || {};
  const children = [
    ...fromChromium(roots.bookmark_bar?.children),
    ...(roots.other?.children?.length ? [{ id: newId(), type: 'folder', title: 'Autres favoris', children: fromChromium(roots.other.children) }] : []),
  ];
  const count = [...walk({ children })].filter((n) => n.type === 'link').length;
  if (count === 0) return { error: `Aucun favori trouvé dans ${b.name}.` };
  load().children.push({ id: newId(), type: 'folder', title: `Importés de ${b.name}`, children });
  save();
  return { count };
}

module.exports = {
  ROOT_ID, getTree, getNode, findByUrl, addLink, addFolder, update, remove, removeUrl, move,
  importSources, importFrom,
};
