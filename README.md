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
sw.js                   offline cache (VERSION generated from cached file hashes)
scripts/stamp-sw.mjs     deterministic cache-version stamper (no dependencies)
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

Before committing changes, run `node scripts/stamp-sw.mjs` and include the resulting
`sw.js` in your commit; CI checks it. Do not edit `VERSION` by hand. The script
hashes the bytes and relative names of every file in the service worker's `ASSETS`
list (including HTML, fonts and images), plus service-worker code with `VERSION`
masked to avoid hashing itself. `./` resolves to `index.html`. There are no dates,
Git hashes or machine-specific paths in the stamp: running it twice with no file
changes gives exactly the same version. Missing cached files fail explicitly.

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

## AI assistant (optional)

The dashboard stays the home screen. The **AI** button (home, task and slide pages) opens a chat panel (`js/ai/panel.js`). The settings icon inside the panel opens the address, key and model form. With AI set up you talk in plain words and the assistant (`js/ai/agent.js`) creates projects and tasks, fills step notes, ticks steps and moves a task forward. It can also pass a Selah (only with your answer to that stage's question, saved on the Selah slide and marked "Passed by Vesper AI", with a "Take this Selah back" button), loop back, finish or reopen a task, and delete a task or project after you say yes. Each turn that changes something has an Undo (only while nothing else has changed). Chat history is in `vesper.chat`, separate from task data.

### Interview mode

The **Interview** tab in the AI panel asks the questions and fills the notes. Pick a project and task (or make new ones); the app asks one plain question per empty step in framework order (`js/ai/questions.js`, all 34). The AI only turns each answer into clean notes (`js/ai/interview.js`) and may fill other empty steps when an answer clearly covers them; if it fails, the person's own words are saved. "Skip" and "stop" work without the AI. At the end of each stage it reminds you of the Selah question and links to it, but never passes it.

## Hub: sync, Claude connector, export, calendar (optional)

A free Cloudflare Worker (`worker/vesper-hub.js`, setup in `worker/README.md`) adds:

- **Sync** between devices (Overview → Sync and Claude).
- **Claude connector**: Claude chats read your tasks, run the interview and fill steps. Claude can also pass each Selah (with your answer recorded and marked "Passed by Claude"), loop back, finish and, after you say yes, delete, so you can start a task in Claude and carry it through every stage.
- **Send elsewhere**: copy, download or share any task or project as Markdown (Notion, Docs, GitHub, email).
- **Add to calendar**: from a task, open Google Calendar with the entry filled in, or download an .ics file. With the optional Google link on the hub (`worker/README.md`), Vesper and Claude add and move events by themselves.
- **Sign in with Google** (optional): each person gets a private space, with a copy saved in their own Google Drive. See `worker/README.md`.

### Organizing tasks and connector tools

Task dashboards now have **Rename task** and **Move task**. A project dashboard has
**Rename project**, task **Up/Down** controls, and the main dashboard has project
**Up/Down** controls. Choose **Manual order** to follow the saved order; priority,
due-date and recently-changed sorting remain available as browser-only preferences.
Names, project membership and each item's order have independent merge clocks.
Older saved data still works. Concurrent equal ranks use the item id as a stable
tie-breaker; no tasks are removed or duplicated to resolve an order conflict.

The in-app AI supports `rename`, `move_task` and `reorder` actions. Claude has:

- `vesper_rename`: exactly one `task` or `project`, plus `name`.
- `vesper_move_task`: `task` and destination `project`.
- `vesper_reorder`: `kind` (`projects` or `tasks`), and `project` for tasks.
  Supply either every item id in `order`, or an `item` id and 1-based `position`.
- `vesper_list_projects`: only project ids, names and task counts.
- `vesper_overview`: optional `query` (project/task names), `project` (id or exact
  name), `stage`, `status`, `priority`, `dueBefore` and `limit` (default 25).
  Output stays valid grouped JSON for existing clients, with one compact JSON
  line per task: name, project, stage, priority, due date, filled steps and any
  check note. Filters combine. Active means started and unfinished; `not started`
  and `finished` are separate statuses. `dueBefore` is an exclusive cutoff.

### Separate tokens for devices and Claude

Save the owner's `APP_TOKEN` in **Sync and Claude**, then reopen that screen and
use **Named access tokens**. Give each token a label, create it, and copy its value
before closing. It is shown only once. The list shows label, created time, last use
and revoked status. **Revoke** ends that token's access without changing the
master key or other tokens. Never share a token or connector address publicly.

Use a named token anywhere you previously used `APP_TOKEN`: sync settings,
`https://your-hub/mcp/<token>`, or the owner's AI proxy key. Storage contains only
SHA-256 hashes and metadata, never recoverable raw token values. Named tokens
cannot manage credentials or mint replacement Google-style connector links.
Google users keep their existing private spaces and separate `/mcp/u/…` links.

Node hosting needs no new setup. On Cloudflare, named tokens require the
`ACCESS_TOKENS` Durable Object binding and migration described in
[`worker/README.md`](worker/README.md). This provides immediate authoritative
revocation across regions instead of relying on eventually consistent KV.
Without the binding, master-key and Google access still work; named-token
operations fail closed with a setup message. Nothing is deployed automatically.
