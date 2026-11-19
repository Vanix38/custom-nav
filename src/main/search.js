// Moteurs de recherche et IA, et transformation de la saisie en URL.
//
// Chaque entrée :
//   id      identifiant stable (sert aux réglages)
//   name    nom affiché
//   type    'ai' ou 'search'
//   url     gabarit de recherche, {q} = question encodée
//   home    page d'accueil (ouverte quand il n'y a pas de question)
//   inject  (facultatif) pour les sites qui n'acceptent pas la question dans
//           l'URL : on ouvre `url` puis on écrit la question dans le champ
//           `selector` une fois la page chargée, SANS l'envoyer.
//
// Liste volontairement en données simples : l'étape 3 la rendra éditable.

const ENGINES = [
  { id: 'google', name: 'Google', type: 'search', url: 'https://www.google.com/search?q={q}', home: 'https://www.google.com/' },
  { id: 'duckduckgo', name: 'DuckDuckGo', type: 'search', url: 'https://duckduckgo.com/?q={q}', home: 'https://duckduckgo.com/' },
  { id: 'bing', name: 'Bing', type: 'search', url: 'https://www.bing.com/search?q={q}', home: 'https://www.bing.com/' },
  { id: 'youtube', name: 'YouTube', type: 'search', url: 'https://www.youtube.com/results?search_query={q}', home: 'https://www.youtube.com/' },
  { id: 'wikipedia', name: 'Wikipédia', type: 'search', url: 'https://fr.wikipedia.org/w/index.php?search={q}', home: 'https://fr.wikipedia.org/' },
  { id: 'claude', name: 'Claude', type: 'ai', url: 'https://claude.ai/new?q={q}', home: 'https://claude.ai/new' },
  { id: 'chatgpt', name: 'ChatGPT', type: 'ai', url: 'https://chatgpt.com/?q={q}', home: 'https://chatgpt.com/' },
  { id: 'perplexity', name: 'Perplexity', type: 'ai', url: 'https://www.perplexity.ai/search?q={q}', home: 'https://www.perplexity.ai/' },
  { id: 'mistral', name: 'Le Chat', type: 'ai', url: 'https://chat.mistral.ai/chat?q={q}', home: 'https://chat.mistral.ai/chat' },
  {
    id: 'gemini', name: 'Gemini', type: 'ai',
    url: 'https://gemini.google.com/app', home: 'https://gemini.google.com/app',
    inject: { selector: 'rich-textarea .ql-editor, .ql-editor[contenteditable="true"]' },
  },
];

const DEFAULT_ENGINE_ID = 'google';

function getEngine(id) {
  return ENGINES.find((e) => e.id === id) || ENGINES.find((e) => e.id === DEFAULT_ENGINE_ID);
}

function iconFor(engine) {
  const host = new URL(engine.home).hostname;
  return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
}

// Ce qu'il faut ouvrir pour poser `query` à `engine` : { url, inject? }
function buildEngineTarget(engine, query) {
  if (!query) return { url: engine.home };
  if (engine.inject) return { url: engine.url, inject: { selector: engine.inject.selector, text: query } };
  return { url: engine.url.replace('{q}', encodeURIComponent(query)) };
}

// Retrouve la question dans une URL de résultats (ex. google.com/search?q=…)
function extractQuery(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  for (const e of ENGINES) {
    if (!e.url.includes('{q}')) continue;
    const t = new URL(e.url.replace('{q}', '__Q__'));
    if (t.hostname !== u.hostname || t.pathname !== u.pathname) continue;
    for (const [key, val] of t.searchParams) {
      if (val === '__Q__' && u.searchParams.get(key)) return u.searchParams.get(key);
    }
  }
  return null;
}

function looksLikeUrl(text) {
  if (/\s/.test(text)) return false;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(text)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(text)) return true;
  return /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(text);
}

// Saisie de la barre d'adresse -> { url, inject?, query? }
// URL ou domaine : ouvert tel quel. Sinon : question pour le moteur actif.
function resolveInput(input, engineId = DEFAULT_ENGINE_ID) {
  const text = String(input || '').trim();
  const engine = getEngine(engineId);
  if (!text) return { url: engine.home };
  if (/^(https?|file|about|view-source):/i.test(text)) return { url: text };
  if (looksLikeUrl(text)) {
    const isLocal = /^(localhost|\d{1,3}(\.\d{1,3}){3})/i.test(text);
    return { url: (isLocal ? 'http://' : 'https://') + text };
  }
  return { ...buildEngineTarget(engine, text), query: text };
}

module.exports = { ENGINES, DEFAULT_ENGINE_ID, getEngine, iconFor, buildEngineTarget, extractQuery, resolveInput };
