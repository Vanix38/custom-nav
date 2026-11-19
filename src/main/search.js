// Résolution de ce que l'utilisateur tape dans la barre d'adresse.
// Les moteurs sont décrits par un gabarit d'URL où {q} est remplacé par la
// requête encodée. L'étape 2 (sélecteur moteurs / IA) ajoutera simplement des
// entrées à cette liste (ex. Claude, ChatGPT, Perplexity, Bing, DuckDuckGo…).

const ENGINES = [
  { id: 'google', name: 'Google', type: 'search', url: 'https://www.google.com/search?q={q}' },
];

const DEFAULT_ENGINE_ID = 'google';
const HOME_URL = 'https://www.google.com/';

function getEngine(id) {
  return ENGINES.find((e) => e.id === id) || ENGINES.find((e) => e.id === DEFAULT_ENGINE_ID);
}

function buildSearchUrl(query, engineId = DEFAULT_ENGINE_ID) {
  return getEngine(engineId).url.replace('{q}', encodeURIComponent(query));
}

function looksLikeUrl(text) {
  if (/\s/.test(text)) return false;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(text)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(text)) return true;
  // domaine.tld[/chemin]
  return /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(text);
}

// Transforme le texte saisi en URL : URL complète, domaine nu, ou recherche.
function resolveInput(input, engineId = DEFAULT_ENGINE_ID) {
  const text = String(input || '').trim();
  if (!text) return HOME_URL;
  if (/^(https?|file|about|view-source):/i.test(text)) return text;
  if (looksLikeUrl(text)) {
    const isLocal = /^(localhost|127\.|\d{1,3}(\.\d{1,3}){3})/i.test(text);
    return (isLocal ? 'http://' : 'https://') + text;
  }
  return buildSearchUrl(text, engineId);
}

module.exports = { ENGINES, DEFAULT_ENGINE_ID, HOME_URL, getEngine, buildSearchUrl, resolveInput };
