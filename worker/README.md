# Vesper hub (optional, free)

One Cloudflare Worker that gives Vesper three extras. The app works fine without it.

1. **Sync**: the same projects and tasks on your phone and laptop.
2. **Claude connector**: Claude chats can read your tasks, run the interview and fill steps (never pass a Selah, never delete).
3. **AI proxy**: lets the app use NVIDIA's free API without a key on your phone (NVIDIA blocks direct browser calls).

## Set up (about 10 minutes, no card needed)

1. Sign in at dash.cloudflare.com. **Workers & Pages → Storage & Databases → KV → Create** a namespace called `vesper`.
2. **Workers & Pages → Create → Hello World**, name it `vesper-hub`, **Deploy**, then **Edit code**. Replace everything with the contents of `worker/vesper-hub.js` and **Deploy**.
3. Worker **Settings → Bindings → Add → KV namespace**: variable name exactly `VESPER`, pick your namespace.
4. Worker **Settings → Variables and Secrets** (type Secret):
   - `APP_TOKEN`: a long random text (30+ characters). This is the only thing that protects your data.
   - `NVIDIA_API_KEY`: only if you want the AI proxy.
   - `MODELS` (plain variable, optional): comma-separated model names the proxy may use.
5. Your hub address is `https://vesper-hub.<you>.workers.dev`.

## Use it

- **In Vesper**: Overview → **Sync and Claude** → paste the hub address and `APP_TOKEN`. Do the same on each device.
- **AI proxy**: in AI settings use `https://vesper-hub.<you>.workers.dev/v1` as the address and `APP_TOKEN` as the key.
- **Claude**: claude.ai → Settings → Connectors → **Add custom connector**, address `https://vesper-hub.<you>.workers.dev/mcp/<APP_TOKEN>`. Then ask Claude things like "Interview me about my Vesper task Paint the fence" or "What is next on my tasks?". With Claude's Google Calendar, Notion or Drive connectors turned on, it can also move things between them and Vesper.
  Anyone holding that address can read and change your tasks, so keep it private. Change `APP_TOKEN` to cut access.

## Notes

- `worker/vesper-hub.js` is generated from the app's own code. After changing app logic run `node worker/build.js`, then paste the new file.
- Sync merges by newest edit per task, and deletions are remembered. Edits made on two devices at the same moment to the same task keep the newest one.
- Run `node tests/worker.test.js` to test the hub locally.

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
