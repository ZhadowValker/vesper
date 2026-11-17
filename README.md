# Vesper

[![CI](https://github.com/ZhadowValker/vesper/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ZhadowValker/vesper/actions/workflows/ci.yml)

Vision, Research, Plan, Execute, Review, with a **Selah** pause at the end of each stage.
An **Area** groups work (Ministry, Work, Home). A **Project** belongs to one Area
and has the full Vesper flow: 27 slides, 34 steps and five Selahs. A simple
**Task** has a title, done tick, priority, due date and short note, without slides.
Tasks live in Inbox, directly in an Area, or inside a Project. Projects never nest.

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

### Persistent hub data and backups

Set `DATA_DIR` in hPanel to an **absolute, persistent directory outside the
deployment/release folder**, not a directory replaced by a Git redeploy. All Node
copies must use that same directory on the same machine and local filesystem.
Several upgraded server processes can now safely share it: an exclusive process
lock covers writes, deletes and hub read/merge/save operations. Writes still use
atomic rename; dead-process locks are recovered automatically, while a live
owner is never evicted just because it is slow. Contention times out after five
seconds rather than writing unlocked. This is not a distributed/network-filesystem
lock.

Before upgrading, stop **all old server copies** (old versions do not honor the
new lock), back up the existing data directory, and point the new copies at the
same persistent `DATA_DIR`. Existing plain-string records need no migration.
New expiring entries carry private expiry metadata in the same JSON file.

To download a hub backup, use hPanel **Files → File Manager**, navigate to
`DATA_DIR/backups`, select a dated `YYYY-MM-DD.json` snapshot and choose
**Download** (or download it over your usual SFTP connection). If this directory
is outside File Manager's scope, use SFTP/SSH; never move it into a public folder.
Snapshots keep the previous good file once per UTC day, with 14-day retention;
`pre-v2.json` is kept separately. These are private full-hub recovery copies
(potentially containing credentials), not public links or browser-import exports:
store them securely. The app's **Export backup** remains the portable notebook
export. Node now honors valid KV expiry hints, cleans up expired entries under
the lock (including after restart), and retains embedded sign-in/session expiry
checks. Successful Google login callbacks can repeat the same unused hand-off
for at most two minutes; consuming it also deletes the completed-state record.

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

- Data is stored per browser unless optional hub Sync is enabled. Export backups regularly.
- The slide sorter is still not built.

## Areas, Projects and simple Tasks (state version 2)

**New** asks Task or Project. A Task needs only a title and defaults to Inbox.
A Project needs a title and an Area. Home shows Inbox, Areas, Resume and mixed
Project/Task sorting and priority filtering; an Area shows its Projects and loose
Tasks. A Project has its mind map, slide player and own Task list. Priority and due
date remain on **Save details**. Simple Tasks can be edited, ticked, moved and
reordered independently. Sort/filter and Auto/Dark/Light preferences stay local.

**Make this a project** promotes an open Task in its Area (Inbox asks which Area;
a Project's Task becomes a sibling Project). Title, priority and due carry over;
the note becomes Vision → Why's first step. Both records retain provenance and
the original Task leaves Task lists. **Make this a task** is allowed only for a
Project with no notes, ticks or passed Selahs. Its contained Tasks move to the
Area, so none are lost. Open Tasks never block Project Finish; confirmation
mentions them alongside unpassed Selahs. Forced connector/AI Finish still needs
`force:true` and a short `reason`.

Quick mode is removed, replaced by simple Tasks. Old Quick flows become Full
Projects without deleting their separate stage notes. Those notes are read-only
on the **first Full slide of the matching stage**, and remain in recap/export.
No old flow is automatically converted into a simple Task.

### Upgrading a version 1 notebook or live hub

1. **Back up before upgrading**: export every important browser notebook and copy
   the live Node `DATA_DIR` (or export the Worker's KV data). Keep a rollback copy
   of the old server/Worker as well. This branch does not deploy production.
2. Pause writes while upgrading the hub, then update the app and hub together.
   Node writes `DATA_DIR/backups/pre-v2.json` before its first stored-v1 migration;
   the Worker writes a private `migration:v1` snapshot per user. These pre-v2
   snapshots do not expire. A failed snapshot prevents the migration write.
3. **All devices should reload**, including installed/offline PWAs. Version 1
   backups still import automatically. Old groups become Areas; old flow decks
   become Projects with the same ids, notes, ticks, Selahs, order, metadata and
   finish state. Browser migration first keeps `vesper.pre-v2` locally.
4. The hub always stores v2. Old-client uploads are migrated **before merging**;
   old clients receive a v1-compatible projection, so they cannot erase simple
   Tasks they cannot see. Do not keep using old clients for new-model work.

Sync merges Areas, Projects and Tasks per record/field, with atomic Task location
and independent done/note clocks. Flow notes/ticks/Selahs keep their independent
clocks; old values fall back to the record's updated time. Newer deletion
tombstones beat older edits. Daily backups still rotate after 14 days. Cloudflare
KV remains eventually consistent: the merge/queue cannot provide a cross-isolate
transaction guarantee. Use a single Node hub for stronger in-process ordering.
Rolling back requires restoring the pre-upgrade data, not just deploying old code.

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

The **AI** button opens chat (`js/ai/panel.js`); its settings configure the model.
The assistant creates Areas, Full Projects and simple Tasks; it can update, move
and promote Tasks. Project flow actions fill notes/ticks, pass Selah only with your
answer, loop back, finish or reopen. Deletion needs your explicit confirmation.
Changes have Undo while nothing else has changed. Chat stays in `vesper.chat`,
separate from notebook data.

### Interview mode

The **Interview** tab selects an Area and a Full Project (or creates them), never
a simple Task. It asks one plain question per empty step (all 34), cleans your
answers into notes, and falls back to your original words if AI fails. "Skip"
and "stop" work without AI. Selah reminders link to the pause but never pass it.

## Hub: sync, Claude connector, export, calendar (optional)

A free Cloudflare Worker (`worker/vesper-hub.js`, setup in `worker/README.md`) adds:

- **Sync** between devices (Overview → Sync and Claude).
- **Claude connector**: Claude chats read your tasks, run the interview and fill steps. Claude can also pass each Selah (with your answer recorded and marked "Passed by Claude"), loop back, finish and, after you say yes, delete, so you can start a task in Claude and carry it through every stage.
- **Send elsewhere**: copy, download or share any task or project as Markdown (Notion, Docs, GitHub, email).
- **Add to calendar**: from a task, open Google Calendar with the entry filled in, or download an .ics file. With the optional Google link on the hub (`worker/README.md`), Vesper and Claude add and move events by themselves.
- **Sign in with Google** (optional): each person gets a private space, with a copy saved in their own Google Drive. See `worker/README.md`.

### Connector tools (version 2)

- `vesper_create_area(name)`; `vesper_create_project(area,title,priority?,due?)`.
- `vesper_create_task(title,area?|project?,priority?,due?,note?)` creates a
  **simple Task**. Omit location for Inbox.
- `vesper_update_task(task,title?,done?,priority?,due?,note?)`.
- `vesper_move_task(task,inbox:true|area|project)`, `vesper_promote_task(task,area?)`,
  `vesper_demote_project(project)`, `vesper_move_project(project,area)`.
- `vesper_list_areas` returns Area ids/names and Project/loose-Task counts.
  **`vesper_list_projects` is a deprecated alias of list_areas**, not Full Projects.
- `vesper_get_project`, `vesper_set_project` (priority/due; null clears) and all
  existing flow tools (`vesper_get_task`, `vesper_next_questions`, `vesper_set_note`,
  `vesper_tick`, `vesper_pass_selah`, `vesper_loop_back`, `vesper_finish`,
  `vesper_schedule`, `vesper_delete`, `vesper_set_task`) take **`project`**.
  The old **`task` argument remains a Project alias** on these flow tools.
- `vesper_rename(area|project,name)` (old `task` aliases Project);
  `vesper_reorder(kind:areas|projects|tasks,order|item+position)` takes an Area for
  Projects, or one Inbox/Area/Project location for Tasks. Positions are 1-based.
  `vesper_delete_area` and `vesper_delete_simple_task` require `confirm:true`.
- `vesper_overview` returns mixed one-line records with a `kind` column. Filters:
  `query`, `kind:project|task`, `area`, `project`, `stage`, `status`, `priority`,
  `dueBefore` (exclusive), `limit` (25 default, max 1000). Active Projects are
  started/unfinished; active Tasks are not done. Not-started applies to Projects.
  Stage filters exclude simple Tasks. Names must be unique or use ids.
- `vesper_framework` explains the model and returns the five-stage framework.

Manual Up/Down order, membership, names and metadata merge independently.
Equal ranks tie-break by id. Area Markdown includes its Projects and loose Tasks;
Project Markdown includes its own Tasks.

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
