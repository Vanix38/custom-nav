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
- Page d'accueil interne pour les nouveaux onglets : grande barre de recherche, pastilles moteurs / IA et favoris
- Page de réglages (bouton ⚙ ou `Ctrl+,`) : moteurs / IA, page d'accueil, favoris, thème, session

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

### Réglages

Ouverts dans un onglet (`customnav://settings/`), enregistrés dans `settings.json` du dossier
utilisateur de l'app (`%APPDATA%custom-navsettings.json`).

- **Moteurs de recherche et IA** : ajouter (nom, URL avec `{q}` ou `%s` à la place de la question,
  catégorie moteur / IA, option « Injection dans la page » avec un sélecteur CSS facultatif),
  modifier, supprimer, réordonner avec ▲ ▼ (l'ordre définit `Ctrl+1` … `Ctrl+9`), choisir le moteur
  par défaut, puis **Enregistrer**. « Réinitialiser la liste » (à confirmer d'un 2e clic) remet la
  liste d'origine. Seules les URL `http://` et `https://` sont acceptées.
- **Page d'accueil** : la page Custom Nav, ou une adresse de ton choix. Les **favoris** affichés sur la
  page d'accueil sont éditables.
- **Apparence** : suivre Windows, clair ou sombre. Le choix s'applique à l'interface, aux pages internes
  et est transmis aux sites (`prefers-color-scheme`).
- **Session et données** : « Rouvrir les onglets du dernier lancement » (activé par défaut), et
  « Effacer les données de navigation » (cookies, cache, stockage des sites ; confirmation dans la page).

### Raccourcis

| Raccourci | Action |
| --- | --- |
| `Ctrl+T` | Nouvel onglet |
| `Ctrl+W` | Fermer l'onglet |
| `Ctrl+L` | Aller à la barre d'adresse |
| `Ctrl+,` | Réglages |
| `F5` / `Ctrl+R` | Recharger |
| `Alt+←` / `Alt+→` | Précédent / suivant |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Onglet suivant / précédent |
| `Ctrl+1` … `Ctrl+9` | Choisir le moteur / l'IA (ordre des pastilles, modifiable dans les réglages ; au-delà du 9e, pas de raccourci) |
| `Ctrl+Shift+1` … `Ctrl+Shift+9` | Renvoyer la question vers ce moteur / cette IA (nouvel onglet) |
| `Shift+clic` sur une pastille | Renvoyer la question vers ce moteur / cette IA |

## Structure

```
src/
  main/
    main.js      fenêtre principale, raccourcis, IPC
    tabs.js      gestion des onglets (un WebContentsView par onglet)
    search.js    liste des moteurs / IA, validation, transformation saisie → URL
    config.js    réglages (valeurs par défaut, validation, session)
    settings.js  lecture / écriture de settings.json
    internal.js  protocole customnav:// des pages internes
  preload/
    ui-preload.js        API de l'interface (barre d'onglets / d'outils)
    internal-preload.js  API des pages internes (n'existe que sur customnav://)
  renderer/
    index.html, styles.css, renderer.js   interface (onglets, barre d'outils)
  internal/
    home.*, settings.*, common.css        pages d'accueil et de réglages
```

Sécurité :

- les pages web tournent sans accès à Node (`nodeIntegration: false`, `contextIsolation: true`,
  `sandbox: true`) ;
- l'API des réglages (`window.customNav`) n'est exposée qu'aux pages `customnav://`, et le processus
  principal vérifie à chaque message que l'expéditeur est bien une page interne (cadre principal) ;
- un site web ne peut pas ouvrir une page `customnav://` (navigation, redirection, cadre ou
  `window.open` sont bloqués).

## Feuille de route

1. ~~Squelette du navigateur~~
2. ~~Sélecteur moteurs de recherche / IA~~ — pour ajouter un moteur, une entrée dans `ENGINES` (`src/main/search.js`)
3. ~~Personnalisation : liste éditable, page d'accueil, thème clair/sombre, sessions~~
4. Installeur `.exe`
