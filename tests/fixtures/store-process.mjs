// Separate-process file-store exerciser. Only temporary synthetic test data.
import { createFileStore } from '../../server-store.mjs';

const [dir, mode, prefix = '', count = '50'] = process.argv.slice(2);
const store = createFileStore(dir);
if (mode === 'writes') {
  for (let i = 0; i < Number(count); i++) {
    await store.put(`${prefix}:${i}`, JSON.stringify({ writer: prefix, i }));
    await store.delete(`remove:${prefix}:${i}`);
  }
} else if (mode === 'login-write') {
  await store.put('gauth:synthetic', JSON.stringify({ kind: 'login', exp: Date.now() + 120000 }), { expirationTtl: 120 });
} else if (mode === 'login-read') {
  process.stdout.write(JSON.stringify(await store.get('gauth:synthetic', 'json')));
} else if (mode === 'crash' || mode === 'hold') {
  await store.transaction(async () => {
    process.send({ locked: true });
    if (mode === 'crash') process.exit(0);
    await new Promise((resolve) => process.once('message', resolve));
  });
} else if (mode === 'increment') {
  for (let i = 0; i < Number(count); i++) await store.transaction(async () => {
    const value = Number(await store.get('counter')) || 0;
    await new Promise((resolve) => setTimeout(resolve, 1));
    await store.put('counter', String(value + 1));
  });
} else if (mode === 'hub-sync') {
  const { default: hub } = await import('../../worker/vesper-hub.js');
  const state = { version: 2, areas: [], projects: [], tasks: [
    { id: prefix, title: prefix, updated: Date.now(), location: { kind: 'inbox' }, note: 'Keep', done: false },
  ], deleted: {} };
  const response = await hub.fetch(new Request('https://hub.example/sync', {
    method: 'PUT', headers: { Origin: 'https://zhadowvalker.github.io', Authorization: 'Bearer synthetic-test', 'Content-Type': 'application/json', 'X-Vesper-Version': '2' },
    body: JSON.stringify({ state }),
  }), { APP_TOKEN: 'synthetic-test', VESPER: store });
  if (!response.ok) throw new Error(`Synthetic sync failed: ${response.status}`);
} else if (mode === 'access-create') {
  const { createAccessToken } = await import('../../worker/access-tokens.js');
  await createAccessToken(store, prefix); // Never print the generated test credential.
} else if (mode === 'login-callback') {
  const { default: hub } = await import('../../worker/vesper-hub.js');
  globalThis.fetch = async (url) => {
    if (String(url) !== 'https://oauth2.googleapis.com/token') throw new Error('Unexpected test upstream');
    await store.transaction(async () => {
      await store.put('synthetic:exchanges', String((Number(await store.get('synthetic:exchanges')) || 0) + 1));
    });
    await new Promise((resolve) => setTimeout(resolve, 75));
    const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    return new Response(JSON.stringify({ id_token: `${b64({ alg: 'RS256' })}.${b64({
      aud: 'synthetic-client', sub: 'synthetic-owner', email: 'owner@example.invalid', email_verified: true,
    })}.sig` }), { headers: { 'Content-Type': 'application/json' } });
  };
  const response = await hub.fetch(new Request(`https://hub.example/google/callback?state=${prefix}&code=synthetic-code`), {
    VESPER: store, APP_TOKEN: 'synthetic-test', GOOGLE_CLIENT_ID: 'synthetic-client',
    GOOGLE_CLIENT_SECRET: 'synthetic-secret', OWNER_EMAIL: 'owner@example.invalid', PUBLIC_URL: 'https://hub.example',
  });
  process.stdout.write(JSON.stringify({ status: response.status, location: response.headers.get('Location'), text: await response.text() }));
} else throw new Error('Unknown test action');
