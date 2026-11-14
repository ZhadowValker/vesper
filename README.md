# Vesper

[![CI](https://github.com/ZhadowValker/vesper/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ZhadowValker/vesper/actions/workflows/ci.yml)

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
| Look | Dusk glass with Dark and Light themes, one colour per stage, fonts bundled in `fonts/` so it works offline | Auto follows the device; the appearance choice stays in this browser |

## Files

```
index.html              app shell
manifest.webmanifest    install details
sw.js                   offline cache (VERSION generated from cached file hashes)
scripts/stamp-sw.mjs     deterministic cache-version stamper (no dependencies)
scripts/check.mjs        tests, syntax and committed generated-file checks
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

Production deploys **only from `main`**, not `vesper-fixes`.
Keep the existing GitHub Pages branch deployment: repository **Settings → Pages
→ Build and deployment → Source: Deploy from a branch → `main` → `/ (root)`**.
Once a reviewed pull request is merged into `main`, Pages deploys that branch as
it does today. The CI workflow adds checks, not a new deployment mechanism.

In this GitHub repository, the files in this folder are at the repository root;
the surrounding Replit `artifacts/vesper` path is not part of the GitHub checkout.

All paths are relative, so it works under a repository sub-path.

Before committing changes, run `node scripts/stamp-sw.mjs` and include the resulting
`sw.js` in your commit; CI checks it. Do not edit `VERSION` by hand. The script
hashes the bytes and relative names of every file in the service worker's `ASSETS`
list (including HTML, fonts and images), plus service-worker code with `VERSION`
masked to avoid hashing itself. `./` resolves to `index.html`. There are no dates,
Git hashes or machine-specific paths in the stamp: running it twice with no file
changes gives exactly the same version. Missing cached files fail explicitly.

## Deploy the Node server on Hostinger

Keep the existing Hostinger app connected to
`ZhadowValker/vesper`, deployment branch **`main`**. Continue using Node 20 or
22, entry file `server.mjs`, start command `npm start`, framework **Other** if
needed, and no application build command (**None**). Do not use `npm run check`
as a hosting build command; CI checks the committed source before merging.

**Manual hPanel redeploy:**

1. Open **Websites → the Vesper website's Dashboard → Deployments → Redeploy**
   (or click **Redeploy** directly on the website dashboard).
2. Review the GitHub source and confirm the selected branch is **`main`**, plus
   the Node version, start/entry settings and existing environment variables.
3. Confirm **Redeploy** (some screens say **Save and Redeploy**). A GitHub-based
   redeploy fetches the latest code from that selected branch; no ZIP upload is
   needed. Check the deployment status and runtime logs afterward.

**Automatic Git deployments, if available for the existing hosting plan/app:**

- Connect/reconnect the existing app through its dashboard's connection menu
  (**Connect Git provider / Connect to GitHub**) and authorize the Hostinger
  GitHub App for **this existing repository**, not a newly cloned copy.
- In **Settings & Redeploy / Build settings**, select **`main`** as the deployment
  branch. Git-connected Node apps enable automatic deployments by default; if
  the dashboard offers an **Auto-deployment** switch, enable it and confirm the
  **Auto-deployment / Connected with GitHub** status.
- Only pushes/PR merges to `main` should redeploy production. Keep other branch
  deployments and any optional pull-request preview deployments disabled for
  this main-only policy. If auto-deploy is unavailable, use the manual flow above.

Preserve the existing secrets and use a persistent `DATA_DIR` outside disposable
deployment/build directories. Hostinger replaces deployment files on redeploy;
back up hub data before a production release. Never commit data or secrets.
This batch does not change hosting settings or deploy anything.

Hostinger references:
[manual redeploy](https://www.hostinger.com/support/how-to-redeploy-a-node-js-application/),
[Git connection and automatic deployments](https://docs.hostinger.com/node.js/git-deployments).

## Run locally

```
python3 -m http.server 8080
```

Open `http://localhost:8080`. Service workers need `localhost` or HTTPS, so do not open `index.html` by double-clicking.

## Dependency-free checks and branch workflow

Use Node **20 or 22**. There are no packages to install: no `npm install` or
`npm ci` is needed. All work stays on **`vesper-fixes`**; never commit directly
to `main`. Before committing:

```sh
git switch vesper-fixes
node worker/build.js
node scripts/stamp-sw.mjs
# Review changes and commit your source plus worker/vesper-hub.js and sw.js.
```

After committing, run:

```sh
npm run check
```

That one command:

1. Rebuilds `worker/vesper-hub.js` and regenerates the `sw.js` hash stamp.
2. Runs `node --check` on every project `.js` and `.mjs` file, including new
   untracked source files; ignored runtime data/dependencies are excluded.
3. Runs `node tests/logic.test.js`, `node tests/worker.test.js` and the
   dependency-free CI regression tests (`node --test tests/ci.test.mjs`).
4. Fails unless both regenerated files match the **committed `HEAD` bytes**,
   not merely the Git index. Staging regenerated files is not enough: include
   them in the commit, then rerun the check. A stale check regenerates local
   outputs so you can inspect and commit them; it never commits or pushes.

Tests use disposable fixtures, never production data. The app remains plain
HTML/CSS/JS with no app build step; these are developer/CI checks only. Individual
test commands above still work for quick checks while editing.

`.github/workflows/ci.yml` runs the same `npm run check` on **every push and every
pull request, all branches**, using separate Node 20 and 22 jobs. It has read-only
repository permissions, needs no secrets, does not install dependencies and
does not deploy. The badge above reports `main`; other branch runs appear in
the repository's Actions tab.

When pushing is authorized, push **`vesper-fixes`**, open a pull request targeting
**`main`**, wait for **Check (Node 20)** and **Check (Node 22)** to pass, review,
then merge. Only that merge releases through the existing `main` deployment
settings. To enforce the policy, the repository owner should protect `main`
(**Settings → Rules → Rulesets**, or **Branches → Branch protection rules**),
require pull requests and both checks, and disallow bypasses/direct pushes.
Branch-based Pages/Hostinger deployments do not automatically wait for CI:
required PR checks are what prevent untested changes reaching `main`.
No GitHub or Hostinger settings are changed by this code.

## Changing the framework

Edit `js/framework.js` only. Stage names, sub-stages, steps and Selah questions all come from that file, and the slides, dashboards and mind maps follow.
`CONFIG.softSelah` controls the Selah pause: `true` warns about unticked steps but lets you continue, `false` blocks Continue until every step in the stage is ticked.

## Known limits of this first version

- Data is stored per browser on one device. Use Export backup and Import backup to move it.
- The slide sorter is still not built.

## Full and Quick tasks

Choose **Full** or **Quick** when creating a task (also in the AI interview setup),
or change **Mode** on its task dashboard and save. Full keeps the original 27
slides and 34 steps. Quick has 12 slides: cover, one notes slide and one Selah
per stage, then recap. Sub-stage names act as short prompts for each stage note.
All five Selahs are still required for normal Finish; early-finish rules are
unchanged. Progress, maps, overview, interview and Markdown understand both modes.

Switching modes never deletes notes, ticks or Selahs. Quick notes use separate
`<stage>.quick` keys; Full-mode step notes remain stored and return when switching
back. Retained Quick notes appear read-only on that stage's Full slides and are
included in recap/export. Older tasks without a mode remain Full. Mode merges as
its own field, and each Quick note uses the existing independent note clock.
Stored slide indexes retain their original Full coordinates to avoid reinterpreting
a cursor edited on another device; the UI shows the correct 12-slide positions.

The in-app AI and `vesper_create_task` accept optional `mode: "full" | "quick"`.
`vesper_set_task` can change mode later. `vesper_next_questions` asks one question
per stage for Quick tasks; save its answer with `vesper_set_note`, slide such as
`vision.quick`, and no step (or `step: null`). Full questions are unchanged.

## Telugu text offline

The display and body font stacks include the bundled **Noto Sans Telugu variable
font** (`fonts/noto-sans-telugu.ttf`, weights 100–900), so Telugu project/task names
and notes render without an external font service, including offline. Both the
font and `fonts/OFL-NotoSansTelugu.txt` are precached by the service worker.
Source: [Google Fonts / Noto Sans Telugu](https://github.com/google/fonts/tree/main/ofl/notosanstelugu);
copyright The Noto Project Authors, licensed under SIL Open Font License 1.1.

## Appearance

Home → **Settings → Appearance** offers **Auto / Dark / Light**. Auto is the
default and follows the device's light/dark setting, including changes while the
app is open. Choosing Dark or Light overrides the device setting and is remembered
only in this browser, never synced with tasks. Both themes retain the dusk-glass
layout; Light uses darker stage colors and readable chips, controls and mind maps.
Both theme files and the preference helper are available offline.

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
