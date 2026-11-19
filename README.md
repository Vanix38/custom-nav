# Custom Nav

Navigateur de bureau perso (Windows), fait maison avec [Electron](https://www.electronjs.org/).
Objectif : passer très facilement d'un moteur de recherche ou d'une IA (Claude, etc.) à l'autre.

## Installer / mettre à jour

1. Générer l'installeur (voir ci-dessous) ou récupérer `dist/Custom-Nav-Setup-<version>.exe`.
2. Lancer l'installeur. L'installation se fait **pour l'utilisateur courant, sans droits
   administrateur** ; le dossier est modifiable (par défaut
   `%LOCALAPPDATA%ProgramsCustom Nav`). Raccourcis créés sur le Bureau et dans le menu Démarrer.
3. **Windows SmartScreen** peut avertir au premier lancement de l'installeur, car il n'est pas signé
   (usage perso) : cliquer sur **« Informations complémentaires »** puis **« Exécuter quand même »**.

Pour **mettre à jour**, relancer simplement l'installeur d'une version plus récente par-dessus.

Les réglages, onglets et connexions sont dans `%APPDATA%custom-nav` : ils sont conservés lors
des mises à jour **et** de la désinstallation (Paramètres Windows > Applications > Custom Nav, ou
`Uninstall Custom Nav.exe` dans le dossier d'installation). Pour repartir de zéro, supprimer ce
dossier à la main après désinstallation. Le même dossier est utilisé par `npm start`.

### Générer l'installeur

```bash
npm install
npm run dist
```

Résultat : `dist/Custom-Nav-Setup-<version>.exe` (NSIS, Windows x64, via
[electron-builder](https://www.electron.build/)). Le dossier `dist/` n'est pas versionné.

L'icône est générée depuis `build/icon.svg` : après l'avoir modifiée, `npm run icon` régénère
`build/icon.ico` (multi-tailles) et `build/icon.png`.

## Lancer depuis les sources

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
- Page d'accueil interne pour les nouveaux onglets : grande barre de recherche, pastilles moteurs / IA et raccourcis
- Page de réglages (bouton ⚙ ou `Ctrl+,`) : moteurs / IA, page d'accueil, raccourcis, thème, session
- Navigation privée (bouton lunettes ou `Ctrl+Shift+N`), voir ci-dessous
- Favoris : étoile dans la barre d'adresse, barre de favoris, dossiers, import depuis Chrome / Edge / Brave, voir ci-dessous

### Favoris

- **☆ / `Ctrl+D`** : ajoute la page courante à la barre de favoris, ou l'en retire si elle y est déjà
  (l'étoile devient ★).
- **Barre de favoris** sous la barre d'outils (`Ctrl+Shift+B` pour l'afficher / la masquer) : clic pour
  ouvrir dans l'onglet courant, `Ctrl+clic` ou clic molette pour un nouvel onglet, clic sur un dossier
  pour son menu (sous-dossiers, « Tout ouvrir »), clic droit pour ouvrir / supprimer / gérer. Les favoris
  qui ne tiennent pas dans la largeur passent dans le menu **»**.
- **Gestionnaire** (`Ctrl+Shift+O`, ou « ★ Favoris » sur la page d'accueil, `customnav://bookmarks/`) :
  recherche, renommer, changer l'adresse, créer des dossiers (imbriqués), déplacer, réordonner, supprimer.
  Tout est enregistré immédiatement dans `settings.json` (clé `bookmarks`).
- **Import** depuis Google Chrome, Microsoft Edge ou Brave (profil par défaut, s'il est installé) : copie
  leurs favoris dans un dossier « Importés de … », sans rien modifier dans l'autre navigateur. Seules les
  adresses `http://` et `https://` sont reprises.

Les tuiles sous la recherche de la page d'accueil sont des **raccourcis** à part, réglables dans les réglages.

### Extensions Chrome

Le bouton pièce de puzzle (à droite de la barre d'adresse) ouvre `customnav://extensions/` : liste des
extensions installées, options, suppression, recherche de mises à jour, et un lien vers le Chrome Web Store.

- Sur le **Chrome Web Store**, le bouton « Ajouter à Chrome » (affiché « Ajouter à Custom Nav » ou similaire)
  installe l'extension après une confirmation qui résume ses autorisations. Le Store affiche aussi un bandeau
  « Passez à Chrome » : il peut être ignoré. Seules les extensions **Manifest V3** sont acceptées.
- Les boutons des extensions apparaissent à droite de la barre d'adresse (clic = popup de l'extension).
- Les éléments ajoutés au **clic droit** par les extensions apparaissent dans le menu contextuel des pages
  (qui propose aussi : ouvrir le lien dans un nouvel onglet, copier, coller, inspecter…).
- Mises à jour automatiques au lancement puis toutes les 5 heures. Fichiers dans `%APPDATA%\custom-nav\Extensions`.
- **Aucune extension en navigation privée.**

Tout repose sur [electron-chrome-extensions](https://github.com/samuelmaddock/electron-browser-shell) et
electron-chrome-web-store. Electron n'est pas Chrome : beaucoup d'API d'extensions manquent. Constaté lors des tests :

| Extension | Résultat |
| --- | --- |
| Dark Reader | fonctionne (bouton, popup, pages assombries) |
| uBlock Origin Lite | s'installe mais **ne bloque rien** : `declarativeNetRequest` n'existe pas dans Electron, et son service worker plante (`chrome.commands` absent) |

Ne fonctionnent pas non plus : les autres bloqueurs de pub Manifest V3 (même API), `chrome.identity` (connexion
Google), `chrome.history`, `chrome.bookmarks`, `chrome.downloads`, les captures d'onglet et le remplacement de la
page Nouvel onglet. Le reste (clic droit, onglets, cookies, notifications, raccourcis) marche plus ou moins selon
l'extension : à essayer au cas par cas.

### Navigation privée

`Ctrl+Shift+N` (ou le bouton lunettes à droite de la barre d'adresse) ouvre une
**fenêtre privée**, reconnaissable à sa teinte violette, au badge « Navigation privée » dans la barre
d'onglets et au titre de la fenêtre.

- Chaque fenêtre privée a sa propre session **en mémoire uniquement** (pas de préfixe `persist:`) :
  cookies, connexions, cache et stockage des sites ne sont jamais écrits sur le disque, ne sont pas
  partagés avec la fenêtre normale ni avec les autres fenêtres privées, et sont vidés dès la
  fermeture de la fenêtre.
- Ses onglets ne sont **pas enregistrés** ni rouverts au lancement suivant (seule la fenêtre normale
  l'est). Les nouveaux onglets privés ouvrent toujours la page d'accueil Custom Nav.
- Les réglages (moteur actif, liste des moteurs, thème…) restent communs : les modifier depuis une
  fenêtre privée les enregistre comme d'habitude.
- `Ctrl+N` ramène la fenêtre normale (ou la rouvre si elle a été fermée).

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
| `Ctrl+Shift+N` | Nouvelle fenêtre privée |
| `Ctrl+D` | Ajouter / retirer la page des favoris |
| `Ctrl+Shift+B` | Afficher / masquer la barre de favoris |
| `Ctrl+Shift+O` | Gestionnaire de favoris |
| `Ctrl+N` | Revenir à la fenêtre normale (la rouvre si elle est fermée) |
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
    main.js      fenêtres (normale et privées), raccourcis, IPC
    tabs.js      gestion des onglets (un WebContentsView par onglet)
    search.js    liste des moteurs / IA, validation, transformation saisie → URL
    config.js    réglages (valeurs par défaut, validation, session)
    bookmarks.js favoris (arbre liens / dossiers, import Chrome / Edge / Brave)
    extensions.js extensions Chrome et Chrome Web Store (session normale uniquement)
    settings.js  lecture / écriture de settings.json
    internal.js  protocole customnav:// des pages internes
  preload/
    ui-preload.js        API de l'interface (barre d'onglets / d'outils)
    internal-preload.js  API des pages internes (n'existe que sur customnav://)
  renderer/
    index.html, styles.css, renderer.js   interface (onglets, barre d'outils)
  internal/
    home.*, settings.*, bookmarks.*, extensions.*, common.css   pages internes
build/        icône (icon.svg source, icon.ico, icon.png)
scripts/      make-icon.js (génération de l'icône)
```

Sécurité :

- les pages web tournent sans accès à Node (`nodeIntegration: false`, `contextIsolation: true`,
  `sandbox: true`) ; seule l'interface (fichier local `index.html`, qui ne peut pas naviguer ailleurs) a un
  preload non sandboxé, pour charger les boutons d'extensions ;
- l'API des réglages (`window.customNav`) n'est exposée qu'aux pages `customnav://`, et le processus
  principal vérifie à chaque message que l'expéditeur est bien une page interne (cadre principal) ;
- un site web ne peut pas ouvrir une page `customnav://` (navigation, redirection, cadre ou
  `window.open` sont bloqués).

## Feuille de route

1. ~~Squelette du navigateur~~
2. ~~Sélecteur moteurs de recherche / IA~~ — pour ajouter un moteur, une entrée dans `ENGINES` (`src/main/search.js`)
3. ~~Personnalisation : liste éditable, page d'accueil, thème clair/sombre, sessions~~
4. ~~Installeur `.exe`~~
