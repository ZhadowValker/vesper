# Vesper

Vision, Research, Plan, Execute, Review, with a **Selah** pause at the end of each stage.
Each task is a deck of 27 slides. Decks live in projects. There are three dashboards: main, project and deck.

## Technology decision

| Choice | Decision | Why |
| --- | --- | --- |
| Hosting | GitHub Pages | Static files only, free, deploys on push |
| Language | Plain HTML, CSS and JavaScript (ES modules) | No build step, nothing to install, easy to edit later |
| Structure | One `index.html` shell plus JS modules, not many HTML pages | Instant slide changes, one cached shell for offline use |
| Routing | Hash routes (`#/p/…`, `#/d/…/s/12`) | GitHub Pages has no server fallback, so path URLs would 404 on reload |
| Storage | `localStorage`, one JSON document, behind `js/store.js` | Works offline with no backend. Swap to IndexedDB later by changing one file |
| Offline and install | `sw.js` plus `manifest.webmanifest` | Makes it an installable PWA |
| Look | Dusk glass: dark translucent panels, one colour per stage, fonts bundled in `fonts/` so it works offline | One stylesheet. Dark only for now |

## Files

```
index.html              app shell
manifest.webmanifest    install details
sw.js                   offline cache (bump VERSION when you change files)
css/app.css             all styles
icons/                  app icons
fonts/                  Bricolage Grotesque and Figtree (variable, latin)
js/framework.js         THE FRAMEWORK AS DATA: stages, sub-stages, steps, Selah questions
js/store.js             data storage, export and import
js/nav.js, js/app.js    router
js/mindmaps.js          project and deck mind maps (SVG)
js/views/home.js        main dashboard
js/views/project.js     project dashboard
js/views/deck.js        deck dashboard
js/views/slide.js       slide player (cover, sub-stage, Selah, recap)
tests/logic.test.js     tests for framework, store and mind maps
```

## Deploy to GitHub Pages

1. Create a repository and put every file in this folder at the repository root.
2. Push to the `main` branch.
3. In the repository go to Settings, then Pages. Set Source to "Deploy from a branch", branch `main`, folder `/ (root)`.
4. Open `https://<your-username>.github.io/<repository>/`.

All paths are relative, so it works under a repository sub-path.

When you change any file after the first deploy, edit `VERSION` at the top of `sw.js` (for example `vesper-v2`) so installed copies refresh.

## Run locally

```
python3 -m http.server 8080
```

Open `http://localhost:8080`. Service workers need `localhost` or HTTPS, so do not open `index.html` by double-clicking.

## Test

```
node tests/logic.test.js
```

## Changing the framework

Edit `js/framework.js` only. Stage names, sub-stages, steps and Selah questions all come from that file, and the slides, dashboards and mind maps follow.
`CONFIG.softSelah` controls the Selah pause: `true` warns about unticked steps but lets you continue, `false` blocks Continue until every step in the stage is ticked.

## Known limits of this first version

- Names for projects and decks are typed into the browser's simple prompt box. A proper form comes later.
- Data is stored per browser on one device. Use Export backup and Import backup to move it.
- The quick mode and a slide sorter are not built yet.
