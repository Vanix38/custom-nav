// Bloqueur de publicités et de traqueurs intégré, basé sur le moteur open source
// de Ghostery (@ghostery/adblocker-electron, licence MPL-2.0), compatible avec
// les listes EasyList / uBlock Origin.
//
// On n'utilise pas `blocker.enableBlockingInSession()` : il enregistre des
// gestionnaires IPC globaux et ne supporte donc qu'une seule session, alors
// qu'il faut bloquer dans la session normale ET dans chaque fenêtre privée. Le
// câblage est fait ici, avec en plus la liste des sites autorisés et le
// compteur d'éléments bloqués par onglet.
const fs = require('fs');
const path = require('path');
const { app, ipcMain, webContents: allWebContents } = require('electron');
const { ElectronBlocker, adsAndTrackingLists } = require('@ghostery/adblocker-electron');
const { createRequire } = require('module');
// preload des filtres cosmétiques, résolu depuis le paquet du moteur (non exporté)
const PRELOAD_PATH = createRequire(require.resolve('@ghostery/adblocker-electron')).resolve('@ghostery/adblocker-electron-preload');
const settings = require('./settings');

const MAX_AGE = 3 * 24 * 3600 * 1000; // listes rafraîchies tous les 3 jours
const cacheFile = () => path.join(app.getPath('userData'), 'adblock-engine.bin');

let blocker = null;
let listsDate = null; // date des listes chargées
let loadError = null;
const sessions = new Map(); // session -> id du preload de filtres cosmétiques
let onBlocked = () => {};

// --- réglages : { enabled, allowlist: [hôtes] } ---
function getSettings() {
  const s = settings.get('adblock', {});
  return {
    enabled: s.enabled !== false,
    allowlist: Array.isArray(s.allowlist) ? s.allowlist.filter((h) => typeof h === 'string') : [],
  };
}

function saveSettings(patch) {
  settings.set('adblock', { ...getSettings(), ...patch });
}

const hostOf = (url) => {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
};

// Le site affiché dans l'onglet est-il dans la liste des sites autorisés ?
function isAllowed(pageUrl) {
  const host = hostOf(pageUrl);
  if (!host) return false;
  return getSettings().allowlist.some((h) => host === h || host.endsWith('.' + h));
}

// Faut-il bloquer pour cette page ?
const shouldBlock = (pageUrl) => !!blocker && getSettings().enabled && !isAllowed(pageUrl);

// URL de la page principale de l'onglet qui fait la requête
function pageUrlFor(details) {
  const wc = details.webContents || (details.webContentsId ? allWebContents.fromId(details.webContentsId) : null);
  if (!wc || wc.isDestroyed()) return details.referrer || '';
  // pendant le chargement d'une nouvelle page, getURL() peut encore être l'ancienne :
  // pour les sous-cadres on préfère la page affichée, c'est ce que voit l'utilisateur
  return wc.getURL() || details.referrer || '';
}

function onBeforeRequest(details, callback) {
  if (details.resourceType === 'mainFrame' || !shouldBlock(pageUrlFor(details))) {
    callback({});
    return;
  }
  blocker.onBeforeRequest(details, (response) => {
    if (response.cancel || response.redirectURL) onBlocked(details.webContentsId);
    callback(response);
  });
}

function onHeadersReceived(details, callback) {
  if (!shouldBlock(details.url)) {
    callback({});
    return;
  }
  blocker.onHeadersReceived(details, callback);
}

// Filtres cosmétiques (masquage des emplacements de pub) : appelés par le
// preload du moteur dans chaque page, pour toutes les sessions bloquées.
function registerIpc() {
  ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', (event, url, msg) => {
    if (!sessions.has(event.sender.session) || !shouldBlock(event.sender.getURL() || url)) return undefined;
    return blocker.onInjectCosmeticFilters(event, url, msg);
  });
  ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', (event) => {
    if (!blocker || !sessions.has(event.sender.session)) return false;
    return blocker.onIsMutationObserverEnabled(event);
  });
}

function attach(ses) {
  if (!blocker || sessions.has(ses)) return;
  const preloadId = ses.registerPreloadScript({ type: 'frame', filePath: PRELOAD_PATH });
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, onBeforeRequest);
  ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, onHeadersReceived);
  sessions.set(ses, preloadId);
}

// Sessions à protéger : attachées dès que le moteur est prêt
const pending = new Set();
function addSession(ses) {
  if (blocker) attach(ses);
  else pending.add(ses);
}

function removeSession(ses) {
  pending.delete(ses);
  sessions.delete(ses); // session privée fermée : ses gestionnaires disparaissent avec elle
}

async function readCache() {
  try {
    const stat = await fs.promises.stat(cacheFile());
    const engine = ElectronBlocker.deserialize(new Uint8Array(await fs.promises.readFile(cacheFile())));
    return { engine, date: stat.mtime };
  } catch {
    return null;
  }
}

// Listes de filtres (publicités + traqueurs) : EasyList, EasyPrivacy, filtres
// uBlock Origin, Peter Lowe (copies maintenues par Ghostery) + Liste FR pour les
// sites français. Compilées localement (1 à 2 s) puis mises en cache sur le disque.
const LISTS = [...adsAndTrackingLists, 'https://easylist-downloads.adblockplus.org/liste_fr.txt'];

async function download() {
  const engine = await ElectronBlocker.fromLists(fetch, LISTS, { enableCompression: true });
  await fs.promises.writeFile(cacheFile(), engine.serialize());
  return { engine, date: new Date() };
}

function useEngine({ engine, date }) {
  blocker = engine;
  listsDate = date;
  loadError = null;
  for (const ses of pending) attach(ses);
  pending.clear();
}

async function init({ onBlockedRequest } = {}) {
  if (onBlockedRequest) onBlocked = onBlockedRequest;
  registerIpc();
  const cached = await readCache();
  if (cached) useEngine(cached);
  if (!cached || Date.now() - cached.date.getTime() > MAX_AGE) {
    try {
      useEngine(await download());
    } catch (e) {
      loadError = `Téléchargement des listes impossible : ${e.message || e}`;
      console.error(loadError);
    }
  }
}

// Mise à jour manuelle depuis les réglages (le nouveau moteur remplace l'ancien
// sans réenregistrer les gestionnaires : ils lisent `blocker` à chaque appel)
async function updateLists() {
  try {
    const fresh = await download();
    blocker = fresh.engine;
    listsDate = fresh.date;
    loadError = null;
    if (pending.size) useEngine(fresh);
    return {};
  } catch (e) {
    return { error: `Téléchargement des listes impossible : ${e.message || e}` };
  }
}

function status() {
  const s = getSettings();
  return {
    ...s,
    ready: !!blocker,
    listsDate: listsDate ? listsDate.toISOString() : null,
    error: loadError,
  };
}

function setEnabled(on) {
  saveSettings({ enabled: !!on });
  return {};
}

// Autorise (ou bloque à nouveau) les pubs sur un site
function setAllowed(hostOrUrl, allowed) {
  const host = hostOrUrl.includes('://') ? hostOf(hostOrUrl) : String(hostOrUrl).trim().toLowerCase().replace(/^www\./, '');
  if (!host || !/^[a-z0-9.-]+$/.test(host)) return { error: 'Site invalide.' };
  const list = getSettings().allowlist.filter((h) => h !== host);
  if (allowed) list.push(host);
  saveSettings({ allowlist: list.sort() });
  return {};
}

module.exports = { init, addSession, removeSession, status, setEnabled, setAllowed, updateLists, isAllowed, hostOf };
