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
