// Tests the built hub Worker (worker/vesper-hub.js) with a fake KV: auth, sync merge, Claude connector tools.
import assert from 'node:assert/strict';
import hub from '../worker/vesper-hub.js';

const kv = new Map();
const env = { APP_TOKEN: 'tok-123', VESPER: { get: async (k, t) => (kv.has(k) ? (t === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } } };
env.GOOGLE_CLIENT_ID = 'cid'; env.GOOGLE_CLIENT_SECRET = 'csecret'; env.PUBLIC_URL = 'https://vesper.test'; env.GOOGLE_TZ = 'Asia/Kolkata';
const ORIGIN = 'https://zhadowvalker.github.io';
let n = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); n++; } catch (e) { failed++; console.error('FAIL', name, '\n', e); } };

const call = (path, { method = 'GET', headers = {}, body } = {}) =>
  hub.fetch(new Request('https://hub.example' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
const rpc = async (method, params, id = 1) => (await call('/mcp/tok-123', { method: 'POST', body: { jsonrpc: '2.0', id, method, params } })).json();
const tool = async (name, args) => { const r = await rpc('tools/call', { name, arguments: args }); return r.result; };
const txt = (r) => JSON.parse(r.content[0].text);
const app = { Origin: ORIGIN, Authorization: 'Bearer tok-123', 'Content-Type': 'application/json' };

await test('sync needs origin and token', async () => {
  assert.equal((await call('/sync', { headers: { Authorization: 'Bearer tok-123' } })).status, 403);
  assert.equal((await call('/sync', { headers: { Origin: ORIGIN, Authorization: 'Bearer nope' } })).status, 401);
  assert.equal((await call('/sync', { headers: { Origin: 'https://evil.example', Authorization: 'Bearer tok-123' } })).status, 403);
  assert.equal((await call('/sync', { method: 'OPTIONS', headers: { Origin: ORIGIN } })).status, 204);
});

await test('sync merges and returns newest', async () => {
  const p = { id: 'p1', name: 'Home', created: 1, updated: 5 };
  const d = { id: 'd1', projectId: 'p1', title: 'Paint', created: 1, updated: 5, slide: 0, reached: 0, ticks: {}, notes: {}, selah: {}, passes: 1, loops: 0, finished: null, timer: null };
  let r = await (await call('/sync', { method: 'PUT', headers: app, body: { state: { projects: [p], decks: [d], deleted: {} } } })).json();
  assert.equal(r.state.decks.length, 1);
  const older = { ...d, updated: 3, title: 'Old' };
  r = await (await call('/sync', { method: 'PUT', headers: app, body: { state: { projects: [p], decks: [older], deleted: {} } } })).json();
  assert.equal(r.state.decks[0].title, 'Paint');
  r = await (await call('/sync', { method: 'PUT', headers: app, body: { state: { projects: [p], decks: [], deleted: { d1: 9 } } } })).json();
  assert.equal(r.state.decks.length, 0);
  const bad = await call('/sync', { method: 'PUT', headers: app, body: { nope: 1 } });
  assert.equal(bad.status, 400);
});

await test('connector auth', async () => {
  assert.equal((await call('/mcp/wrong', { method: 'POST', body: {} })).status, 401);
  const ok = await call('/mcp', { method: 'POST', headers: { Authorization: 'Bearer tok-123' }, body: { jsonrpc: '2.0', id: 1, method: 'ping' } });
  assert.equal(ok.status, 200);
});

await test('initialize, list, notifications', async () => {
  const i = await rpc('initialize', { protocolVersion: '2025-06-18' });
  assert.equal(i.result.serverInfo.name, 'vesper');
  const l = await rpc('tools/list');
  const names = l.result.tools.map((t) => t.name);
  assert.ok(names.includes('vesper_set_note') && names.includes('vesper_next_questions'));
  assert.ok(!names.some((x) => /selah|delete/.test(x)));
  const note = await call('/mcp/tok-123', { method: 'POST', body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  assert.equal(note.status, 202);
  assert.equal((await rpc('nope')).error.code, -32601);
});

await test('create, interview, fill, no Selah', async () => {
  const fw = txt(await tool('vesper_framework', {}));
  assert.equal(fw.length, 5);
  assert.equal((await tool('vesper_create_project', { name: 'Garden' })).isError, undefined);
  await tool('vesper_create_task', { project: 'Garden', title: 'Build bed' });
  const ov = txt(await tool('vesper_overview', {}));
  const g = ov.find((p) => p.project === 'Garden');
  assert.equal(g.tasks[0].stepsFilled, '0/34');
  const nq = txt(await tool('vesper_next_questions', { task: 'Build bed', limit: 3 }));
  assert.equal(nq.next.length, 3);
  assert.ok(nq.next[0].question);
  const set = await tool('vesper_set_note', { task: g.tasks[0].id, slide: nq.next[0].slide, step: nq.next[0].step, text: 'Grow herbs' });
  assert.equal(txt(set).changed.length, 1);
  const t = txt(await tool('vesper_get_task', { task: 'Build bed' }));
  assert.equal(t.stepsFilled, '1/34');
  assert.equal(t.steps[0].note, 'Grow herbs');
  assert.equal(t.steps[0].ticked, true);
  assert.deepEqual(t.selahPassed, []);
  const bad = txt(await tool('vesper_set_note', { task: 'Build bed', slide: 'vision.selah', step: 0, text: 'x' }));
  assert.equal(bad.changed.length, 0);
  assert.equal((await tool('vesper_get_task', { task: 'missing' })).isError, true);
  await tool('vesper_tick', { task: 'Build bed', slide: 'vision.why', step: 1, done: true });
  assert.equal(txt(await tool('vesper_get_task', { task: 'Build bed' })).steps[1].ticked, true);
});

await test('connector changes reach the app on sync', async () => {
  const r = await (await call('/sync', { headers: app })).json();
  assert.ok(r.state.projects.some((p) => p.name === 'Garden'));
});

await test('ai proxy needs key and checks models', async () => {
  const b = { model: 'm', messages: [] };
  assert.equal((await call('/v1/chat/completions', { method: 'POST', headers: app, body: b })).status, 500);
});


// ---- Google Calendar (Google is faked) ----
const gcalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  gcalls.push({ url, method: init.method, body: init.body, headers: init.headers });
  const ok = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  if (url === 'https://oauth2.googleapis.com/token') {
    const p = new URLSearchParams(init.body);
    if (p.get('grant_type') === 'authorization_code') return p.get('code') === 'goodcode' ? ok({ access_token: 'acc1', refresh_token: 'ref1', expires_in: 3600 }) : ok({ error: 'invalid_grant' }, 400);
    return p.get('refresh_token') === 'ref1' ? ok({ access_token: 'acc2', expires_in: 3600 }) : ok({ error: 'invalid_grant' }, 400);
  }
  if (url.startsWith('https://oauth2.googleapis.com/revoke')) return ok({});
  if (url === 'https://www.googleapis.com/calendar/v3/calendars/primary/events') return ok({ id: 'ev' + gcalls.length, htmlLink: 'https://calendar.google.com/event?eid=x' });
  if (url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events/')) return init.method === 'PATCH' ? ok({ id: decodeURIComponent(url.split('/').pop()), htmlLink: 'https://calendar.google.com/event?eid=y' }) : ok({}, 405);
  return realFetch(url, init);
};

await test('google: status, start, callback state check', async () => {
  let r = await (await call('/google/status', { headers: app })).json();
  assert.deepEqual(r, { configured: true, connected: false });
  assert.equal((await call('/google/start', { method: 'POST', headers: { Origin: ORIGIN } })).status, 401);
  r = await (await call('/google/start', { method: 'POST', headers: app })).json();
  const u = new URL(r.url);
  assert.equal(u.searchParams.get('client_id'), 'cid');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://vesper.test/google/callback');
  assert.equal(u.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar.events');
  assert.equal(u.searchParams.get('access_type'), 'offline');
  const state = u.searchParams.get('state');
  let page = await (await call('/google/callback?code=goodcode&state=wrong')).text();
  assert.match(page, /expired/);
  assert.equal((await (await call('/google/status', { headers: app })).json()).connected, false);
  page = await (await call(`/google/callback?code=goodcode&state=${state}`)).text();
  assert.match(page, /connected/);
  assert.equal((await (await call('/google/status', { headers: app })).json()).connected, true);
  page = await (await call(`/google/callback?code=goodcode&state=${state}`)).text();
  assert.match(page, /expired/);   // the state works once only
});

await test('google: create then move the same event', async () => {
  const b = { deck: 'd9', kind: 'selah', title: 'Selah: Paint', details: 'Ask', start: '2026-10-28T18:00', minutes: 45 };
  let r = await (await call('/calendar/event', { method: 'POST', headers: app, body: b })).json();
  assert.ok(r.id && !r.moved);
  const post = gcalls.filter((c) => c.method === 'POST' && c.url.endsWith('/events')).pop();
  const ev = JSON.parse(post.body);
  assert.equal(ev.start.dateTime, '2026-10-28T18:00:00');
  assert.equal(ev.end.dateTime, '2026-10-28T18:45:00');
  assert.equal(ev.start.timeZone, 'Asia/Kolkata');
  assert.equal(post.headers.Authorization, 'Bearer acc1');
  r = await (await call('/calendar/event', { method: 'POST', headers: app, body: { ...b, start: '2026-10-29T09:30' } })).json();
  assert.equal(r.moved, true);
  assert.ok(gcalls.some((c) => c.method === 'PATCH'));
  const bad = await call('/calendar/event', { method: 'POST', headers: app, body: { ...b, start: 'tomorrow' } });
  assert.equal(bad.status, 400);
});

await test('google: Claude can schedule a task, Selah is only an event', async () => {
  const l = await rpc('tools/list');
  assert.ok(l.result.tools.some((t) => t.name === 'vesper_schedule'));
  const r = await tool('vesper_schedule', { task: 'Build bed', when: '2026-10-30T07:00', kind: 'selah' });
  assert.equal(r.isError, undefined);
  assert.match(txt(r).scheduled, /Selah: Build bed/);
  const t = txt(await tool('vesper_get_task', { task: 'Build bed' }));
  assert.deepEqual(t.selahPassed, []);
  assert.equal((await tool('vesper_schedule', { task: 'nope', when: '2026-10-30T07:00' })).isError, true);
});

await test('google: disconnect forgets the sign-in', async () => {
  const r = await (await call('/google/disconnect', { method: 'POST', headers: app })).json();
  assert.equal(r.connected, false);
  assert.equal((await (await call('/google/status', { headers: app })).json()).connected, false);
  assert.ok(gcalls.some((c) => c.url.includes('/revoke')));
  const e = await call('/calendar/event', { method: 'POST', headers: app, body: { deck: 'd9', title: 'x', start: '2026-10-28T18:00' } });
  assert.equal(e.status, 400);
});

await test('google: unset hub explains itself', async () => {
  const saved = env.GOOGLE_CLIENT_ID; env.GOOGLE_CLIENT_ID = '';
  assert.equal((await (await call('/google/status', { headers: app })).json()).configured, false);
  assert.equal((await call('/google/start', { method: 'POST', headers: app })).status, 400);
  env.GOOGLE_CLIENT_ID = saved;
});
globalThis.fetch = realFetch;

console.log(failed ? `${failed} failed` : `${n} worker tests passed`);
process.exit(failed ? 1 : 0);
