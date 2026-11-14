# Vesper hub (optional, free)

One Cloudflare Worker that gives Vesper three extras. The app works fine without it.

1. **Sync**: the same projects and tasks on your phone and laptop.
2. **Claude connector**: Claude chats can read your tasks, run the interview and fill steps and carry a task through the stages: pass each Selah (answer recorded, marked "by Claude", and you can take it back), loop back, finish, and delete after you confirm.
3. **AI proxy**: lets the app use NVIDIA's free API without a key on your phone (NVIDIA blocks direct browser calls).

## Set up (about 10 minutes, no card needed)

1. Sign in at dash.cloudflare.com. **Workers & Pages → Storage & Databases → KV → Create** a namespace called `vesper`.
2. **Workers & Pages → Create → Hello World**, name it `vesper-hub`, **Deploy**, then **Edit code**. Replace everything with the contents of `worker/vesper-hub.js` and **Deploy**.
3. Worker **Settings → Bindings → Add → KV namespace**: variable name exactly `VESPER`, pick your namespace.
4. Worker **Settings → Variables and Secrets** (type Secret):
   - `APP_TOKEN`: a long random text (30+ characters). This is the owner's master key; keep it private.
   - `NVIDIA_API_KEY`: only if you want the AI proxy.
   - `MODELS` (plain variable, optional): comma-separated model names the proxy may use.
5. Your hub address is `https://vesper-hub.<you>.workers.dev`.

## Use it

- **In Vesper**: Overview → **Sync and Claude** → paste the hub address and `APP_TOKEN`. Do the same on each device.
- **AI proxy**: in AI settings use `https://vesper-hub.<you>.workers.dev/v1` as the address and `APP_TOKEN` as the key.
- **Claude**: claude.ai → Settings → Connectors → **Add custom connector**, address `https://vesper-hub.<you>.workers.dev/mcp/<APP_TOKEN>`. Then ask Claude things like "Interview me about my Vesper task Paint the fence" or "What is next on my tasks?". With Claude's Google Calendar, Notion or Drive connectors turned on, it can also move things between them and Vesper.
  Anyone holding that address can read and change your tasks, so keep it private. Change `APP_TOKEN` to cut master-key access. Named tokens are revoked separately.

## Notes

- `worker/vesper-hub.js` is generated from the app's own code. After changing app logic run `node worker/build.js`, then paste the new file.
- Sync merges each step note, tick, Selah answer/pass and task field independently; the newest edit to that item wins. Cleared items and task/project deletions are remembered. Old backups without item timestamps still load, using the task's `updated` time as the fallback.
- Hub saves re-read and merge the latest state inside a per-user, in-process queue. Node file writes (including non-state keys and deletes) also share one atomic-write queue. Run only one Node process per `DATA_DIR`.
- **Cloudflare state limitation:** KV is eventually consistent and has no transactional compare-and-swap. The queue prevents overlapping task-state saves inside one Worker isolate, but it cannot serialize different isolates/regions. Strict global task-state write safety still needs a single writer. The separate named-token authority below does not change where task state is stored.
- Run `node tests/worker.test.js` to test the hub locally.

## Automatic daily snapshots

- Node: the first write on each UTC date snapshots the previous good file under `DATA_DIR/backups/YYYY-MM-DD.json`. On a new install, it snapshots the first value instead. Snapshots include the entire private KV file. They are written atomically, never replaced during that day, and pruned to today plus the previous thirteen UTC dates. Rotation runs on writes; no new snapshot is needed while the data is idle.
- Worker: the first state save each UTC day stores the previous state (or first state on a new account) at `backup:YYYY-MM-DD`, in that person's KV namespace, with a 14-day `expirationTtl`. This also runs on writes, not a scheduled trigger.
- Snapshots are private: there is no HTTP download endpoint. Node's public-file allowlist also rejects encoded traversal paths into data or backups. Keep `DATA_DIR` outside the public asset folders, and protect snapshots as carefully as the primary data.
- These snapshots supplement, rather than replace, device exports and the optional Google Drive backup. They do not provide a cross-region KV transaction or an automatic restore.

## Run it on your own Node.js hosting (Hostinger) instead of Cloudflare

`server.mjs` in the repo root serves the app and the same hub, so one address does everything (for example `https://vesper.soundmind.org.in`). No Cloudflare account needed.

1. In hPanel add the subdomain `vesper.soundmind.org.in` and make sure its free SSL is on.
2. **Websites → Add website → Node.js Apps**. Import the GitHub repo `ZhadowValker/vesper` (or upload the repo files as a zip). Pick Node 20 or newer, startup file `server.mjs`, and use `npm start` if it asks for a start command. Attach it to the subdomain.
3. In the app's **Environment variables** add:
   - `APP_TOKEN`: a long random text (30+ characters). You type this yourself and keep it private.
   - `ORIGINS`: `https://vesper.soundmind.org.in`
   - `DATA_DIR`: a folder outside the web files if the panel allows, otherwise leave it out (data then lives in `data/`, which the server never serves).
   - `NVIDIA_API_KEY` and `MODELS`: only if you want the AI proxy.
4. Deploy, then open the subdomain. Vesper loads from there.
5. In Vesper: Overview → Sync and Claude. Hub address is the same subdomain (`https://vesper.soundmind.org.in`), token is your `APP_TOKEN`.
6. Claude connector address: `https://vesper.soundmind.org.in/mcp/<APP_TOKEN>`.

Back up the `data` folder now and then. After you update the code in GitHub, redeploy the app in hPanel.

## Google Calendar link (optional)

With this on, Vesper's "Add to calendar" creates and moves events in your Google Calendar by itself, and Claude can do it too ("schedule a Selah for my Paint task on Friday 6pm"). Only the "see and edit events" permission is asked for. The sign-in is stored in the hub's data file, so keep that file private and back it up carefully. "Disconnect" in Google's account settings (myaccount.google.com/permissions) removes it any time.

1. Go to console.cloud.google.com and create a project named `Vesper`.
2. **APIs & Services → Library**: search "Google Calendar API" and **Enable** it.
3. **OAuth consent screen** (Google Auth Platform): user type **External**; app name `Vesper`; your email as support and developer contact. Add the scope `.../auth/calendar.events`. Add your own Google account under **Test users**.
4. Set the app to **In production** (Publish app). If you leave it in "Testing", Google ends the sign-in after 7 days. In production you will see a "Google hasn't verified this app" warning when you sign in: choose **Advanced → Go to Vesper**. That is expected for your own app with only you as the user.
5. **Credentials → Create credentials → OAuth client ID → Web application**. Under **Authorized redirect URIs** add exactly `https://vesper.soundmind.org.in/google/callback`. Copy the **Client ID** and **Client secret**.
6. In Hostinger's environment variables add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PUBLIC_URL` = `https://vesper.soundmind.org.in`, and optionally `GOOGLE_TZ` (default `Asia/Kolkata`). Redeploy.
7. In Vesper open a task, **Add to calendar**, press **Connect Google**, approve, and you land back in Vesper. After that, **Add to Google Calendar** adds or moves the event. Scheduling the same task and kind again moves the same event instead of adding a copy.

### Choose the calendar

In Vesper: open a task, **Add to calendar**, and use the **Calendar** dropdown. It lists your calendars, plus **+ Create new: Vesper Tasks**, which makes that calendar for you. If the dropdown is missing, press **Connect Google** again once, to give Vesper permission to list and create calendars. Events already added to another calendar stay there; delete them by hand. Advanced: `GOOGLE_CALENDAR_ID` sets a default calendar by its ID.

Add these two permissions under Data Access in Google Cloud before reconnecting: `.../auth/calendar.app.created` and `.../auth/calendar.calendarlist.readonly`.

## Sign in with Google (optional)

Anyone can sign in with Google. Each person gets their own private space on your hub, and a copy of their data is kept in a hidden app folder in their own Google Drive. Your own token and Claude connector keep working exactly as before. People who sign in cannot use your Claude connector or your shared AI key (they can enter their own AI key in AI settings).

Set up (uses the same Google Cloud project as the calendar):
1. **Google Auth Platform → Data Access**: add the scopes `drive.appdata`, `calendar.events`, `calendar.app.created` and `calendar.calendarlist.readonly`. One sign-in now asks for all of them together. (`openid`, `email` and `profile` are already included.)
2. **Branding**: set the **Application home page** to `https://vesper.soundmind.org.in` and **Privacy policy link** to `https://vesper.soundmind.org.in/privacy.html`. Save.
3. **Audience**: press **Publish app**. While it says "Testing", only the test users you listed can sign in.
4. In Hostinger add these variables and redeploy:
   - `OWNER_EMAIL`: your own Google email. When you sign in with that account you open YOUR data, the same as your token does, including the AI proxy.
   - `ALLOWED_EMAILS` (optional): comma-separated emails. If set, only these can sign in. Leave empty to allow anyone.
   - `MAX_USERS` (optional, default 100): sign-ups stop after this many people.
5. In Vesper open **Sync and Claude** and press **Continue with Google**. Open Vesper from your hub address (`https://vesper.soundmind.org.in`) so the sign-in returns to the right place.

Good to know:
- Sign-in only asks for your email and the hidden Drive folder, which Google treats as low risk. The calendar permission is asked for separately, only if you press **Connect Google** in Add to calendar.
- Back up the hub's `data` folder. Each person's data lives there, and in their Drive copy.
- Each person can press **Delete my data** in the Sync dialog. It removes their data from the hub and their Drive copy.
- Every sign-in asks Google for consent again. That is by design for now: it makes sure Google hands over the permission the Drive copy needs.

## A Claude link for each person

Anyone signed in with Google can open the account dialog, press **Create my Claude link** under Hub details, and paste the link into Claude (Settings, Connectors, Add custom connector). The link is `https://your-hub/mcp/u/<token>` and reaches only that person's own projects. It is shown once, works like a password, and **Replace link** or **Turn off** ends the old one. Deleting the account removes it too. Your own owner link (`/mcp/<APP_TOKEN>`) is unchanged.

## Organization and compact connector tools

Tasks also support `mode: "quick"` (12 slides, one notes box per stage) or
`"full"` (default, original 27 slides/34 steps). Pass optional `mode` to
`vesper_create_task`, or change it with `vesper_set_task`; switching preserves
both formats' notes, ticks and Selahs. Overview/get-task report the mode and
mode-specific progress. For Quick tasks, `vesper_next_questions` returns at most
one question per stage; save the answer to the returned `<stage>.quick` slide
with no step (or `step: null`). The same five Selahs and finish policy apply.

All the original tools remain available. New tools:

| Tool | Inputs |
| --- | --- |
| `vesper_rename` | Exactly one of `task` / `project` (id or exact name), plus `name` |
| `vesper_move_task` | `task`, destination `project` |
| `vesper_reorder` | `kind: "projects"` or `"tasks"`; `project` for tasks; either full `order` of ids, or `item` id and 1-based `position` |
| `vesper_list_projects` | None; returns only ids, names and task counts |

`vesper_overview` accepts optional `query`, `project`, `stage` (`vision`,
`research`, `plan`, `execute`, `review`), `status` (`active`, `finished`,
`not started`), `priority` (`P1`–`P4` or `none`), `dueBefore` (YYYY-MM-DD)
and `limit` (default 25, range 1–1000). Filters combine; name search is
case-insensitive and matches both project and task names. `active` means started
and unfinished; due dates must be strictly earlier than `dueBefore`.

The result remains a JSON array of project groups for existing clients, but every
task is one compact JSON line, including its project, current stage, priority,
due date, filled-step count and any check note. Projects/tasks follow manual
order. Existing priority/due tools, finish checks and Markdown exports are unchanged.
Names, membership and order merge per field; equal ranks sort deterministically
by id. Moving an item does not overwrite its notes or other task fields.

## Named owner access tokens

In **Sync and Claude**, save the master key and reopen the screen (or use the
signed-in Google owner account). Under **Named access tokens**, create a labeled
credential, copy it once, and use it for sync, `/mcp/<token>` or the AI proxy.
Closing the screen discards the raw value. Tokens cannot be recovered; revoke
and replace one if it is lost. The list never returns raw values, only id, label,
created time, last-used time and revocation status.

- `APP_TOKEN` remains the master key. Rotating it does not revoke named tokens.
- Only the master key or signed-in owner can create/list/revoke named credentials.
  A named token has owner data access, but cannot manage other credentials or
  create a persistent replacement `/mcp/u/…` link.
- Ordinary Google users and their isolated data/links are unchanged.
- Only SHA-256 token hashes and metadata are stored. Tokens use 256 random bits.
- Every use checks the authority, with no positive authorization cache. After a
  revoke response, new requests using that token are rejected; a request already
  authenticated before revocation may finish. Authority failures deny access.
- Last use is tracked on every request in the authority and persisted at most
  once a minute to avoid repeated KV writes. A restart can lose up to a minute
  of last-use detail, never a persisted revocation. History is capped at 100 tokens.

### Node hosting

No new bindings or services: named-token records use the existing private file
store and one in-process queue. Run one Node process against its `DATA_DIR`;
multiple processes sharing the same file are not supported. The server preserves
the proxy's host/protocol for same-origin hub requests; external app origins can
still be allowed explicitly with `ORIGINS`.

### Cloudflare: required once for named tokens

**Do not put named-token credentials in eventually consistent KV.** KV alone
cannot guarantee immediate cross-region revocation. The Worker exports
`NamedAccessAuthority` and routes all named-token checks/mutations through one
Durable Object, addressed consistently as `vesper-owner-access`. Task data and
daily task snapshots remain in the original `VESPER` KV namespace.

Merge the `ACCESS_TOKENS` binding and `named-access-v1` SQLite class migration from
[`wrangler.example.toml`](wrangler.example.toml) into your Worker configuration.
Keep the **existing** KV namespace id, routes, variables, migration history and
secrets; the example is not a replacement production configuration. Deploy the
rebuilt `vesper-hub.js` with that migration when you choose to release it.
No new app build step is introduced: `node worker/build.js` still generates the
Worker. Without the binding, existing master/Google behavior works, while named
tokens are unavailable with an explicit setup message.

### Token management HTTP API

These routes require the master key or owner Google session as a Bearer header:

- `GET /me/tokens` → `{tokens:[{id,label,created,lastUsed,revoked}]}`
- `POST /me/tokens` with `{label}` → the metadata plus `token`, once (HTTP 201).
- `POST /me/tokens/<id>/revoke` → revokes that hash/id.

Management responses use `Cache-Control: no-store`. Do not log request credentials
or connector URLs. The app only keeps a freshly minted raw token in the open
dialog, never in saved task/sync data or browser storage.
