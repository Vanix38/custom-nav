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

## Fonctionnalités (étape 1)

- Barre d'onglets : nouvel onglet, fermeture (bouton × ou clic molette), changement d'onglet
- Boutons précédent / suivant / recharger (devient « arrêter » pendant le chargement)
- Barre d'adresse : une URL (`github.com`, `https://…`, `localhost:3000`) ou du texte → recherche Google
- Les liens `target=_blank` et `window.open` s'ouvrent dans un nouvel onglet
- Connexions conservées entre les lancements (session persistante `persist:main`)

### Raccourcis

| Raccourci | Action |
| --- | --- |
| `Ctrl+T` | Nouvel onglet |
| `Ctrl+W` | Fermer l'onglet |
| `Ctrl+L` | Aller à la barre d'adresse |
| `F5` / `Ctrl+R` | Recharger |
| `Alt+←` / `Alt+→` | Précédent / suivant |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Onglet suivant / précédent |

## Structure

```
src/
  main/
    main.js      fenêtre principale, raccourcis, IPC
    tabs.js      gestion des onglets (un WebContentsView par onglet)
    search.js    liste des moteurs + transformation saisie → URL
  preload/
    ui-preload.js  API limitée exposée à l'interface (contextIsolation)
  renderer/
    index.html, styles.css, renderer.js   interface (onglets, barre d'outils)
```

Sécurité : les pages web tournent sans accès à Node (`nodeIntegration: false`,
`contextIsolation: true`, `sandbox: true`).

## Feuille de route

1. ~~Squelette du navigateur~~
2. Sélecteur moteurs de recherche / IA (ouvre un onglet avec la question pré-remplie) — les moteurs se déclarent dans `src/main/search.js`, l'emplacement du sélecteur est `#engine-slot` dans l'interface
3. Personnalisation : liste éditable, page d'accueil, thème clair/sombre, sessions persistantes
4. Installeur `.exe`
