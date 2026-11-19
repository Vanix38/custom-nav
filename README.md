# Custom Nav

Navigateur de bureau perso (Windows), fait maison avec [Electron](https://www.electronjs.org/).
Objectif : passer très facilement d'un moteur de recherche ou d'une IA (Claude, etc.) à l'autre.

## Lancer

Prérequis : [Node.js](https://nodejs.org/) 22.12 ou plus récent.

```bash
npm install
npm start
```

`npm install` télécharge aussi le binaire Electron (script `postinstall`).

## Fonctionnalités

- Barre d'onglets : nouvel onglet, fermeture (bouton × ou clic molette), changement d'onglet
- Boutons précédent / suivant / recharger (devient « arrêter » pendant le chargement)
- Barre d'adresse : une URL (`github.com`, `https://…`, `localhost:3000`) ou du texte → recherche avec le moteur / l'IA actif
- Les liens `target=_blank` et `window.open` s'ouvrent dans un nouvel onglet
- Connexions conservées entre les lancements (session persistante `persist:main`)

### Sélecteur moteurs de recherche / IA

À gauche de la barre d'adresse, une pastille par moteur ou IA (le moteur actif affiche son nom) :

- **Moteurs** : Google, DuckDuckGo, Bing, YouTube, Wikipédia (fr)
- **IA** : Claude, ChatGPT, Perplexity, Le Chat (Mistral), Gemini

Utilisation :

- **Clic** sur une pastille (ou `Ctrl+1` … `Ctrl+9`) : choisit le moteur actif, retenu au prochain lancement. Si une question est en cours de saisie dans la barre d'adresse, elle est aussitôt posée au moteur choisi.
- **Entrée** dans la barre d'adresse : recherche avec le moteur actif (sauf si c'est une URL).
- **Renvoyer vers** — **Shift+clic** sur une pastille (ou `Ctrl+Shift+1` … `Ctrl+Shift+9`) : ouvre un **nouvel onglet** avec la même question posée à ce moteur. La question utilisée est le texte en cours de saisie s'il y en a un, sinon la dernière question de l'onglet courant (mémorisée par onglet ; une recherche faite directement dans la page Google, Bing… est aussi reconnue).

Comment la question arrive dans chaque IA :

| IA | Méthode | Comportement constaté |
| --- | --- | --- |
| Claude | URL `claude.ai/new?q=` | connexion requise ; la question est conservée à travers la page de connexion (pré-remplissage une fois connecté non vérifié lors des tests, faits sans compte) |
| ChatGPT | URL `chatgpt.com/?q=` | la question est **envoyée automatiquement**, même sans compte |
| Perplexity | URL `perplexity.ai/search?q=` | lance la recherche (une vérification anti-robot Cloudflare peut s'afficher la première fois) |
| Le Chat | URL `chat.mistral.ai/chat?q=` | connexion requise |
| Gemini | **injection** | Gemini ignore la question dans l'URL : l'app ouvre `gemini.google.com/app` puis écrit la question dans le champ de saisie une fois la page chargée. Elle **n'est pas envoyée** automatiquement (appuie sur Entrée) : cliquer à la place de l'utilisateur serait fragile dès que Gemini change son interface. |

Le user-agent envoyé aux sites est celui d'un Chrome standard (sans « Electron »), sinon Google refuse parfois la connexion.

### Raccourcis

| Raccourci | Action |
| --- | --- |
| `Ctrl+T` | Nouvel onglet |
| `Ctrl+W` | Fermer l'onglet |
| `Ctrl+L` | Aller à la barre d'adresse |
| `F5` / `Ctrl+R` | Recharger |
| `Alt+←` / `Alt+→` | Précédent / suivant |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Onglet suivant / précédent |
| `Ctrl+1` … `Ctrl+9` | Choisir le moteur / l'IA (ordre des pastilles ; la 10e, Gemini, n'a pas de raccourci) |
| `Ctrl+Shift+1` … `Ctrl+Shift+9` | Renvoyer la question vers ce moteur / cette IA (nouvel onglet) |
| `Shift+clic` sur une pastille | Renvoyer la question vers ce moteur / cette IA |

## Structure

```
src/
  main/
    main.js      fenêtre principale, raccourcis, IPC
    tabs.js      gestion des onglets (un WebContentsView par onglet)
    search.js    liste des moteurs / IA + transformation saisie → URL
    settings.js  réglages persistants (moteur actif) dans settings.json
  preload/
    ui-preload.js  API limitée exposée à l'interface (contextIsolation)
  renderer/
    index.html, styles.css, renderer.js   interface (onglets, barre d'outils)
```

Sécurité : les pages web tournent sans accès à Node (`nodeIntegration: false`,
`contextIsolation: true`, `sandbox: true`).

## Feuille de route

1. ~~Squelette du navigateur~~
2. ~~Sélecteur moteurs de recherche / IA~~ — pour ajouter un moteur, une entrée dans `ENGINES` (`src/main/search.js`)
3. Personnalisation : liste éditable, page d'accueil, thème clair/sombre, sessions persistantes
4. Installeur `.exe`
