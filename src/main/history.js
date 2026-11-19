// Historique de navigation de la fenêtre normale (jamais des fenêtres privées).
// Enregistré dans history.json (dossier app.getPath('userData')), à part de
// settings.json pour que ce dernier reste petit.
//   entrée : { id, url, title, time }   (time en ms, la plus récente en dernier)
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const MAX_ENTRIES = 20000;
const MAX_AGE = 90 * 24 * 3600 * 1000; // 90 jours, comme Chrome
// Même adresse revisitée peu après (rechargement, retour…) : on met à jour
// l'entrée existante au lieu d'en créer une nouvelle.
const MERGE_WINDOW = 30 * 60 * 1000;

const file = () => path.join(app.getPath('userData'), 'history.json');
let entries = null;
let nextId = 1;
let saveTimer = null;

function load() {
  if (entries) return entries;
  try {
    const data = JSON.parse(fs.readFileSync(file(), 'utf8'));
    entries = Array.isArray(data.entries) ? data.entries.filter((e) => e && typeof e.url === 'string') : [];
  } catch {
    entries = [];
  }
  prune();
  nextId = entries.reduce((m, e) => Math.max(m, e.id || 0), 0) + 1;
  for (const e of entries) if (!e.id) e.id = nextId++;
  return entries;
}

function prune() {
  const limit = Date.now() - MAX_AGE;
  entries = entries.filter((e) => e.time >= limit);
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
}

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!entries) return;
  try {
    fs.writeFileSync(file(), JSON.stringify({ version: 1, entries }));
  } catch (e) {
    console.error("Impossible d'enregistrer l'historique :", e.message);
  }
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 2000);
}

const recordable = (url) => /^https?:\/\//i.test(url || '');

// Une page vient d'être ouverte dans un onglet. Renvoie l'id de l'entrée.
function addVisit(url, title) {
  if (!recordable(url)) return null;
  load();
  const now = Date.now();
  const last = entries[entries.length - 1];
  if (last && last.url === url && now - last.time < MERGE_WINDOW) {
    last.time = now;
    if (title) last.title = title;
    saveSoon();
    return last.id;
  }
  const entry = { id: nextId++, url, title: title || '', time: now };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES + 500) prune();
  saveSoon();
  return entry.id;
}

// Titre connu après coup (page-title-updated)
function setTitle(id, url, title) {
  if (!id || !title) return;
  load();
  for (let i = entries.length - 1; i >= 0 && i >= entries.length - 200; i--) {
    const e = entries[i];
    if (e.id === id) {
      if (e.url === url && e.title !== title) {
        e.title = title;
        saveSoon();
      }
      return;
    }
  }
}

// Recherche, du plus récent au plus ancien, `limit` entrées avant `before`
function list({ query = '', before = Infinity, limit = 200 } = {}) {
  load();
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const max = Math.min(Math.max(1, Number(limit) || 200), 1000);
  const beforeTime = Number(before) || Infinity;
  const out = [];
  for (let i = entries.length - 1; i >= 0 && out.length <= max; i--) {
    const e = entries[i];
    if (e.time >= beforeTime) continue;
    if (words.length) {
      const hay = `${e.title} ${e.url}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
    }
    out.push(e);
  }
  const more = out.length > max;
  return { entries: out.slice(0, max).map((e) => ({ ...e })), more };
}

function remove(ids) {
  if (!Array.isArray(ids)) return { error: 'Liste invalide.' };
  load();
  const set = new Set(ids.map(Number));
  const before = entries.length;
  entries = entries.filter((e) => !set.has(e.id));
  if (entries.length !== before) saveNow();
  return { removed: before - entries.length };
}

// Efface les entrées des dernières `ms` millisecondes (tout si ms absent)
const RANGES = { hour: 3600e3, day: 24 * 3600e3, week: 7 * 24 * 3600e3, month: 30 * 24 * 3600e3 };
function clear(range = 'all') {
  load();
  const before = entries.length;
  if (range === 'all') entries = [];
  else if (RANGES[range]) {
    const limit = Date.now() - RANGES[range];
    entries = entries.filter((e) => e.time < limit);
  } else return { error: 'Période inconnue.' };
  saveNow();
  return { removed: before - entries.length };
}

module.exports = { addVisit, setTitle, list, remove, clear, saveNow };
