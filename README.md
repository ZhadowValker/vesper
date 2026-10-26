# Vesper

Vision, Research, Plan, Execute, Review, with a **Selah** pause at the end of each stage.
Words used in the app: a **Project** holds **Tasks**. Each task is played as a **deck** of 27 **slides**. There are three dashboards: main, project and task.

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
js/sample.js            the book-writing sample (4 tasks, every step and slide filled)
js/nav.js, js/app.js    router
js/util.js              helpers, icons and the in-app dialogs (ask, confirmBox, notice)
js/mindmaps.js          project and deck mind maps (SVG)
js/views/home.js        main dashboard
js/views/project.js     project dashboard
js/views/deck.js        task dashboard (the tree)
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

- Data is stored per browser on one device. Use Export backup and Import backup to move it.
- The quick mode and a slide sorter are not built yet.

## Optional AI helpers

Off until you open **AI** on the home screen and add an address, a key and a model. Settings stay in this browser only (`vesper.ai`) and are not part of Export backup.

- **Help me with this** (every step slide): drafts text for the step notes. Nothing is saved until you press Use.
- **Review this stage** (Selah slides): points out gaps. It never moves a task on.
- Works with any OpenAI-style chat endpoint (`<address>/chat/completions`). If the browser blocks the call, point the address at a small proxy or OpenRouter.
- Code: `js/ai/` (`settings.js`, `client.js` network only, `prompts.js` pure, `ui.js` dialogs).

## Chat is the home screen

`#/` is a chat (`js/views/chat.js`). The old dashboard is at `#/overview`. With AI set up, you talk in plain words and the assistant (`js/ai/agent.js`) creates projects and tasks, fills step notes, ticks steps and moves a task forward. It cannot pass a Selah, delete anything or finish a task. Every turn that changes something has an Undo (only while nothing else has changed). Chat history is in `vesper.chat`, separate from task data.
