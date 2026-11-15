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
  assert.equal((await call('/sync', { headers: { Origin: ORIGIN, Authorization: 'Bearer nope' } })).status, 401);
  assert.equal((await call('/sync', { headers: { Origin: 'https://evil.example', Authorization: 'Bearer tok-123' } })).status, 403);
  assert.equal((await call('/sync', { method: 'OPTIONS', headers: { Origin: ORIGIN } })).status, 204);
});

await test('same-site requests without an Origin header still need the token', async () => {
  assert.equal((await call('/sync', { headers: { Authorization: 'Bearer tok-123' } })).status, 200);
  assert.equal((await call('/sync', { headers: { Authorization: 'Bearer nope' } })).status, 401);
  assert.equal((await call('/sync')).status, 401);
  assert.equal((await call('/google/status', { headers: { Authorization: 'Bearer tok-123' } })).status, 200);
  assert.equal((await call('/sync', { headers: { Origin: 'https://evil.example', Authorization: 'Bearer tok-123' } })).status, 403);
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
  assert.ok(names.includes('vesper_pass_selah') && names.includes('vesper_delete'));
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
const drive = { id: '', data: '', uploads: 0, deleted: false };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (email, sub, aud = 'cid') => `${b64({ alg: 'RS256' })}.${b64({ aud, sub, email, email_verified: true })}.sig`;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  gcalls.push({ url, method: init.method, body: init.body, headers: init.headers });
  const ok = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  if (url === 'https://oauth2.googleapis.com/token') {
    const p = new URLSearchParams(init.body);
    if (p.get('grant_type') === 'authorization_code' && p.get('code').startsWith('login:')) { const [, email, sub, aud] = p.get('code').split(':'); return ok({ access_token: 'dacc', refresh_token: 'dref', expires_in: 3600, id_token: idToken(email, sub, aud || 'cid') }); }
    if (p.get('grant_type') === 'authorization_code') return p.get('code') === 'goodcode' ? ok({ access_token: 'acc1', refresh_token: 'ref1', expires_in: 3600 }) : ok({ error: 'invalid_grant' }, 400);
    if (p.get('refresh_token') === 'dref') return ok({ access_token: 'dacc2', expires_in: 3600 });
    return p.get('refresh_token') === 'ref1' ? ok({ access_token: 'acc2', expires_in: 3600 }) : ok({ error: 'invalid_grant' }, 400);
  }
  if (url.startsWith('https://oauth2.googleapis.com/revoke')) return ok({});
  if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) return ok({ files: drive.id ? [{ id: drive.id }] : [] });
  if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
    drive.uploads++;
    const json = String(init.body).split('\r\n').filter((l) => l.startsWith('{')).pop();
    drive.data = json; drive.id = drive.id || 'drivefile1';
    return ok({ id: drive.id });
  }
  if (/^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/[^?]+\?alt=media$/.test(url)) return drive.data ? new Response(drive.data, { status: 200 }) : ok({}, 404);
  if (/^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/[^?]+$/.test(url) && init.method === 'DELETE') { drive.id = ''; drive.data = ''; drive.deleted = true; return new Response(null, { status: 204 }); }
  if (url.startsWith('https://www.googleapis.com/calendar/v3/users/me/calendarList')) return ok({ items: [{ id: 'me@x.com', summary: 'Diet Schedule', primary: true }, { id: 'abc123@group.calendar.google.com', summary: 'Team' }] });
  if (url === 'https://www.googleapis.com/calendar/v3/calendars') return ok({ id: 'newcal@group.calendar.google.com', summary: JSON.parse(init.body).summary });
  if (/^https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars\/[^/]+\/events$/.test(url)) return ok({ id: 'ev' + gcalls.length, htmlLink: 'https://calendar.google.com/event?eid=x' });
  if (/^https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars\/[^/]+\/events\//.test(url)) return init.method === 'PATCH' ? ok({ id: decodeURIComponent(url.split('/').pop()), htmlLink: 'https://calendar.google.com/event?eid=y' }) : ok({}, 405);
  return realFetch(url, init);
};

await test('google: status, start, callback state check', async () => {
  let r = await (await call('/google/status', { headers: app })).json();
  assert.deepEqual(r, { configured: true, connected: false, calendar: '' });
  assert.equal((await call('/google/start', { method: 'POST', headers: { Origin: ORIGIN } })).status, 401);
  r = await (await call('/google/start', { method: 'POST', headers: app })).json();
  const u = new URL(r.url);
  assert.equal(u.searchParams.get('client_id'), 'cid');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://vesper.test/google/callback');
  assert.deepEqual(u.searchParams.get('scope').split(' '), ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.app.created', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly']);
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

await test('google: events go to the chosen calendar', async () => {
  env.GOOGLE_CALENDAR_ID = 'abc123@group.calendar.google.com';
  await call('/google/disconnect', { method: 'POST', headers: app });
  const st = new URL((await (await call('/google/start', { method: 'POST', headers: app })).json()).url).searchParams.get('state');
  await call(`/google/callback?code=goodcode&state=${st}`);
  gcalls.length = 0;
  await call('/calendar/event', { method: 'POST', headers: app, body: { deck: 'dz', kind: 'work', title: 'x', start: '2026-11-01T10:00' } });
  assert.ok(gcalls.some((c) => c.url === 'https://www.googleapis.com/calendar/v3/calendars/abc123%40group.calendar.google.com/events'));
  env.GOOGLE_CALENDAR_ID = '';
});

await test('google: pick or create a calendar in the app', async () => {
  env.GOOGLE_CALENDAR_ID = 'abc123@group.calendar.google.com';
  const st = new URL((await (await call('/google/start', { method: 'POST', headers: app })).json()).url).searchParams.get('state');
  await call(`/google/callback?code=goodcode&state=${st}`);
  let r = await (await call('/google/calendars', { headers: app })).json();
  assert.equal(r.calendars.length, 2);
  assert.equal(r.selected, 'abc123@group.calendar.google.com');   // from GOOGLE_CALENDAR_ID until one is picked
  let bad = await call('/google/calendar', { method: 'POST', headers: app, body: { id: 'not-mine@x.com' } });
  assert.equal(bad.status, 400);
  r = await (await call('/google/calendar', { method: 'POST', headers: app, body: { create: 'Vesper Tasks' } })).json();
  assert.equal(r.selected, 'newcal@group.calendar.google.com');
  gcalls.length = 0;
  await call('/calendar/event', { method: 'POST', headers: app, body: { deck: 'dq', kind: 'work', title: 'x', start: '2026-11-02T10:00' } });
  assert.ok(gcalls.some((c) => c.url === 'https://www.googleapis.com/calendar/v3/calendars/newcal%40group.calendar.google.com/events'));
  assert.equal((await (await call('/google/status', { headers: app })).json()).calendar, 'Vesper Tasks');
  r = await (await call('/google/calendar', { method: 'POST', headers: app, body: { id: 'me@x.com' } })).json();
  assert.equal(r.selected, 'me@x.com');
  env.GOOGLE_CALENDAR_ID = '';
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

// ---- Sign in with Google (Google is faked) ----
const signIn = async (email, sub, aud) => {
  const o = { Origin: ORIGIN, 'Content-Type': 'application/json' };
  const start = await (await call('/auth/google/start', { method: 'POST', headers: o })).json();
  const u = new URL(start.url);
  const state = u.searchParams.get('state');
  const back = await call(`/google/callback?code=login:${email}:${sub}${aud ? ':' + aud : ''}&state=${state}`);
  return { start: u, back };
};
const finish = async (back) => {
  const loc = back.headers.get('Location');
  const code = new URL(loc.replace('/#/', '/')).searchParams.get('c');
  return (await call('/auth/exchange', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: { code } })).json();
};
const as = (token) => ({ Origin: ORIGIN, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' });
const project = (id, name) => ({ id, name, created: 1, updated: 5 });

await test('login: start needs a known website, asks for sign-in and Drive-only permissions', async () => {
  const bad = await call('/auth/google/start', { method: 'POST', headers: { Origin: 'https://evil.example' } });
  assert.equal(bad.status, 403);
  const none = await call('/auth/google/start', { method: 'POST' });
  assert.equal(none.status, 403);
  const { start } = await signIn('ann@x.com', 'sub-ann');
  assert.deepEqual(start.searchParams.get('scope').split(' '), ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.appdata', 'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.app.created', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly']);
  assert.equal(start.searchParams.get('redirect_uri'), 'https://vesper.test/google/callback');
});

let ann, bob;
await test('login: a person gets a session and a private space', async () => {
  const s = await signIn('ann@x.com', 'sub-ann');
  assert.equal(s.back.status, 302);
  assert.match(s.back.headers.get('Location'), /^https:\/\/vesper\.test\/#\/signin\?c=[0-9a-f]+$/);
  ann = await finish(s.back);
  assert.equal(ann.email, 'ann@x.com');
  assert.equal(ann.owner, false);
  assert.ok(ann.token && ann.token.length >= 32);
  const again = await call('/auth/exchange', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: { code: new URL(s.back.headers.get('Location').replace('/#/', '/')).searchParams.get('c') } });
  assert.equal(again.status, 400);   // the one-time code works once
  const mine = await (await call('/sync', { headers: as(ann.token) })).json();
  assert.equal(mine.state.projects.length, 0);   // not the owner's data
  await call('/sync', { method: 'PUT', headers: as(ann.token), body: { state: { projects: [project('pa', 'Ann project')], decks: [], deleted: {} } } });
  bob = await finish((await signIn('bob@x.com', 'sub-bob')).back);
  const bobs = await (await call('/sync', { headers: as(bob.token) })).json();
  assert.equal(bobs.state.projects.length, 0);   // Bob cannot see Ann's
  const annAgain = await (await call('/sync', { headers: as(ann.token) })).json();
  assert.deepEqual(annAgain.state.projects.map((x) => x.name), ['Ann project']);
  const owner = await (await call('/sync', { headers: app })).json();
  assert.ok(!owner.state.projects.some((x) => x.name === 'Ann project'));
  const gs = await (await call('/google/status', { headers: as(ann.token) })).json();
  assert.equal(gs.connected, true);   // one sign-in also connected her calendar
});

await test('connector: Ann\'s personal link shows only Ann\'s projects, and Bob can turn his off', async () => {
  const link = await (await call('/me/mcp-link', { method: 'POST', headers: as(ann.token), body: {} })).json();
  const over = await (await call(link.path, { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'vesper_overview', arguments: {} } } })).json();
  const text = JSON.stringify(over);
  assert.ok(text.includes('Ann project'));
  const bl = await (await call('/me/mcp-link', { method: 'POST', headers: as(bob.token), body: {} })).json();
  const bover = JSON.stringify(await (await call(bl.path, { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'vesper_overview', arguments: {} } } })).json());
  assert.ok(!bover.includes('Ann project'));
  await call('/me/mcp-link', { method: 'POST', headers: as(bob.token), body: { revoke: true } });
  assert.equal((await call(bl.path, { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })).status, 401);
});

await test('login: wrong audience, bad state and fake sessions are refused', async () => {
  const s = await signIn('eve@x.com', 'sub-eve', 'someone-elses-app');
  assert.match(await s.back.text(), /did not confirm/);
  const stale = await call('/google/callback?code=login:eve@x.com:s&state=nope');
  assert.match(await stale.text(), /expired/);
  assert.equal((await call('/sync', { headers: as('0'.repeat(64)) })).status, 401);
  assert.equal((await call('/me', { headers: as('') })).status, 401);
});

await test('login: people cannot use the shared AI proxy or the Claude connector', async () => {
  env.NVIDIA_API_KEY = 'nv';
  const ai = await call('/v1/chat/completions', { method: 'POST', headers: as(ann.token), body: { model: 'm', messages: [] } });
  assert.equal(ai.status, 403);
  env.NVIDIA_API_KEY = '';
  assert.equal((await call(`/mcp/${ann.token}`, { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'ping' } })).status, 401);
});

await test('login: calendar connect works per person', async () => {
  const start = await (await call('/google/start', { method: 'POST', headers: as(ann.token) })).json();
  const state = new URL(start.url).searchParams.get('state');
  assert.match(await (await call(`/google/callback?code=goodcode&state=${state}`)).text(), /connected/);
  assert.equal((await (await call('/google/status', { headers: as(ann.token) })).json()).connected, true);
  await call('/google/disconnect', { method: 'POST', headers: as(bob.token) });
  assert.equal((await (await call('/google/status', { headers: as(bob.token) })).json()).connected, false);   // Bob disconnecting does not touch Ann
  assert.equal((await (await call('/google/status', { headers: as(ann.token) })).json()).connected, true);
  const own = await (await call('/google/calendars', { headers: as(ann.token) })).json();
  assert.equal(own.calendars.length, 2);
  assert.ok(gcalls.some((c) => c.url.includes('showHidden=true')));
});

await test('drive: copy is saved to the person\'s Drive, at most every five minutes, and can be restored', async () => {
  assert.equal(drive.uploads, 1);   // Ann's first sync already saved a copy
  assert.deepEqual(JSON.parse(drive.data).projects.map((x) => x.name), ['Ann project']);
  await call('/sync', { method: 'PUT', headers: as(ann.token), body: { state: { projects: [project('pa', 'Ann project'), project('pb', 'Second')], decks: [], deleted: {} } } });
  assert.equal(drive.uploads, 1);   // too soon, not saved again
  const forced = await call('/me/backup', { method: 'POST', headers: as(ann.token) });
  assert.equal(forced.status, 200);
  assert.equal(drive.uploads, 2);
  assert.deepEqual(JSON.parse(drive.data).projects.map((x) => x.name).sort(), ['Ann project', 'Second']);
  // the hub copy is replaced by an older one, then restored from Drive
  const saved = drive.data;
  await call('/sync', { method: 'PUT', headers: as(ann.token), body: { state: { projects: [], decks: [], deleted: { pa: 1, pb: 1 } } } });
  const r = await (await call('/me/restore', { method: 'POST', headers: as(ann.token) })).json();
  assert.equal(r.state.projects.length, 2);
  assert.equal(drive.data, saved);
  assert.equal((await call('/me/restore', { method: 'POST', headers: app })).status, 400);   // the owner token has no Drive link
});

await test('login: sign out ends the session', async () => {
  const x = await finish((await signIn('cy@x.com', 'sub-cy')).back);
  assert.equal((await call('/sync', { headers: as(x.token) })).status, 200);
  assert.equal((await call('/auth/logout', { method: 'POST', headers: as(x.token) })).status, 200);
  assert.equal((await call('/sync', { headers: as(x.token) })).status, 401);
});

await test('login: delete my data removes everything and the Drive copy', async () => {
  drive.deleted = false;
  const r = await (await call('/me/delete', { method: 'POST', headers: as(ann.token) })).json();
  assert.equal(r.deleted, true);
  assert.equal(drive.deleted, true);
  assert.equal((await call('/sync', { headers: as(ann.token) })).status, 401);
  const owner = await call('/me/delete', { method: 'POST', headers: app });
  assert.equal(owner.status, 400);   // the owner space is not deleted from the app
});

await test('login: the owner email opens the owner data; the list and the cap limit sign-ups', async () => {
  env.OWNER_EMAIL = 'me@x.com';
  const o = await finish((await signIn('ME@x.com', 'sub-me')).back);
  assert.equal(o.owner, true);
  const mine = await (await call('/sync', { headers: as(o.token) })).json();
  assert.ok(mine.state.projects.some((p) => p.name === 'Garden'));   // the same data the token login sees
  const ai = (await call('/me', { headers: as(o.token) }));
  assert.equal((await ai.json()).owner, true);
  env.OWNER_EMAIL = '';
  env.ALLOWED_EMAILS = 'only@x.com';
  assert.match(await (await signIn('zed@x.com', 'sub-zed')).back.text(), /private/);
  const ok = await signIn('only@x.com', 'sub-only');
  assert.equal(ok.back.status, 302);
  env.ALLOWED_EMAILS = '';
  env.MAX_USERS = '1';
  assert.match(await (await signIn('new1@x.com', 'sub-n1')).back.text(), /full/);
  env.MAX_USERS = '';
});

await test('login: the app can ask whether Google sign-in is offered', async () => {
  assert.deepEqual(await (await call('/auth/config')).json(), { google: true });
  const saved = env.GOOGLE_CLIENT_ID; env.GOOGLE_CLIENT_ID = '';
  assert.deepEqual(await (await call('/auth/config')).json(), { google: false });
  env.GOOGLE_CLIENT_ID = saved;
});

await test('settings: AI settings are saved per person and cleaned', async () => {
  const put = await call('/me/settings', { method: 'PUT', headers: app, body: { settings: { ai: { key: 'k1', draft: 'm', evil: 'x' } } } });
  assert.equal(put.status, 200);
  const got = await (await call('/me/settings', { headers: app })).json();
  assert.deepEqual(got.settings, { ai: { key: 'k1', draft: 'm' } });
});

await test('connector: a personal Claude link reaches only that person, and can be replaced', async () => {
  const made = await (await call('/me/mcp-link', { method: 'POST', headers: app, body: {} })).json();
  assert.match(made.path, /^\/mcp\/u\/[A-Za-z0-9_-]{20,}$/);
  const hit = await call(made.path, { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
  assert.equal(hit.status, 200);
  assert.equal((await call('/mcp/u/' + 'x'.repeat(30), { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })).status, 401);
  const again = await (await call('/me/mcp-link', { method: 'POST', headers: app, body: {} })).json();
  assert.equal((await call(made.path, { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })).status, 401);
  assert.equal((await call(again.path, { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })).status, 200);
  await call('/me/mcp-link', { method: 'POST', headers: app, body: { revoke: true } });
  assert.equal((await call(again.path, { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })).status, 401);
});

await test('connector: Claude can drive a task through a Selah, loop back, finish and delete', async () => {
  await tool('vesper_create_project', { name: 'Drive proj' });
  await tool('vesper_create_task', { project: 'Drive proj', title: 'Drive task' });
  const changed = (r) => txt(r);
  // needs an answer
  let r = changed(await tool('vesper_pass_selah', { task: 'Drive task', answer: '' }));
  assert.equal(r.changed.length, 0);
  assert.match(r.notApplied[0], /needs the answer/);
  // out of order is refused
  r = changed(await tool('vesper_pass_selah', { task: 'Drive task', answer: 'enough to choose', stage: 'plan' }));
  assert.equal(r.changed.length, 0);
  // in order works, is marked as Claude, and moves the task on
  r = changed(await tool('vesper_pass_selah', { task: 'Drive task', answer: 'Yes, I can say it in two sentences.' }));
  assert.match(r.changed[0], /Passed the Vision Selah \(by Claude\)/);
  let t = txt(await tool('vesper_get_task', { task: 'Drive task' }));
  assert.ok(JSON.stringify(t).includes('Vision'));
  r = changed(await tool('vesper_loop_back', { task: 'Drive task', stage: 'vision' }));
  assert.match(r.changed[0], /Looped/);
  r = changed(await tool('vesper_pass_selah', { task: 'Drive task', answer: 'Second pass: still clear.' }));
  assert.match(r.changed[0], /Vision Selah/);   // vision is the next one again after the loop
  assert.match(changed(await tool('vesper_finish', { task: 'Drive task', force: true, reason: 'Requested early completion for this test.' })).changed[0], /Finished/);
  assert.match(changed(await tool('vesper_finish', { task: 'Drive task', reopen: true })).changed[0], /Reopened/);
  // delete needs a clear yes
  r = changed(await tool('vesper_delete', { task: 'Drive task', confirm: false }));
  assert.equal(r.changed.length, 0);
  r = changed(await tool('vesper_delete', { project: 'Drive proj', confirm: true }));
  assert.match(r.changed[0], /Deleted project/);
  assert.ok(!JSON.stringify(txt(await tool('vesper_overview', {}))).includes('Drive proj'));
});

await test('login: not set up means a clear message', async () => {
  const saved = env.GOOGLE_CLIENT_ID; env.GOOGLE_CLIENT_ID = '';
  const r = await call('/auth/google/start', { method: 'POST', headers: { Origin: ORIGIN } });
  assert.equal(r.status, 400);
  env.GOOGLE_CLIENT_ID = saved;
});

globalThis.fetch = realFetch;

await test('concurrent connector calls retain both new projects', async () => {
  const names = ['Concurrent A', 'Concurrent B'];
  const results = await Promise.all(names.map((name) => tool('vesper_create_project', { name })));
  results.forEach((r) => assert.ok(!r.isError));
  const saved = JSON.parse(kv.get('state'));
  names.forEach((name) => assert.ok(saved.projects.some((p) => p.name === name)));
});

await test('concurrent sync saves re-read and retain both devices', async () => {
  const copies = ['Device A', 'Device B'].map((name, i) => ({
    projects: [{ id: `concurrent-${i}`, name, created: 1, updated: 1 }], decks: [], deleted: {},
  }));
  await Promise.all(copies.map((state) => call('/sync', { method: 'PUT', headers: app, body: { state } })));
  const saved = JSON.parse(kv.get('state'));
  copies.forEach((s) => assert.ok(saved.projects.some((p) => p.id === s.projects[0].id)));
});

await test('simultaneous connector edits to different steps of one task survive', async () => {
  await tool('vesper_create_project', { name: 'Parallel task edits' });
  const made = await tool('vesper_create_task', { project: 'Parallel task edits', title: 'Shared task' });
  assert.ok(!made.isError);
  const saved = JSON.parse(kv.get('state'));
  const d = saved.decks.find((x) => x.title === 'Shared task');
  assert.ok(d);
  const results = await Promise.all([0, 1].map((step) => tool('vesper_set_note', {
    task: d.id, slide: 'vision.why', step, text: `Parallel answer ${step}`,
  })));
  results.forEach((r) => assert.ok(!r.isError, JSON.stringify(r)));
  const task = JSON.parse(kv.get('state')).decks.find((x) => x.id === d.id);
  for (const step of [0, 1]) {
    assert.equal(task.notes[`vision.why#${step}`], `Parallel answer ${step}`);
    assert.equal(task.ticks[`vision.why:${step}`], true);
    assert.ok(task._changed.notes[`vision.why#${step}`]);
  }
});

await test('sync keeps independent modern device edits and old-format notes', async () => {
  const { stampDeck } = await import('../js/merge.js');
  const p = { id: 'step-sync-p', name: 'Two devices', updated: 1 };
  const base = { id: 'step-sync-d', projectId: p.id, title: 'Shared', updated: 10, notes: { legacy: 'kept' }, ticks: {}, selah: {} };
  const a = structuredClone(base), b = structuredClone(base);
  a.notes.a = 'device A'; b.notes.b = 'device B';
  stampDeck(a, base, 20); stampDeck(b, base, 30);
  await Promise.all([a, b].map((d) => call('/sync', {
    method: 'PUT', headers: app, body: { state: { projects: [p], decks: [d] } },
  })));
  const task = JSON.parse(kv.get('state')).decks.find((d) => d.id === base.id);
  assert.deepEqual(task.notes, { a: 'device A', b: 'device B', legacy: 'kept' });
  await call('/sync', { method: 'PUT', headers: app, body: { state: { projects: [p], decks: [], deleted: { [base.id]: 40 } } } });
  await call('/sync', { method: 'PUT', headers: app, body: { state: { projects: [p], decks: [a] } } });
  assert.ok(!JSON.parse(kv.get('state')).decks.some((d) => d.id === base.id));
});

await test('file KV queues puts and deletes and leaves atomic JSON', async () => {
  const { createFileStore } = await import('../server-store.mjs');
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vesper-store-'));
  try {
    const disk = createFileStore(dir);
    await Promise.all(Array.from({ length: 30 }, (_, i) => disk.put(`key${i}`, JSON.stringify(i))));
    await Promise.all([disk.delete('key0'), disk.put('extra', '"kept"'), disk.delete('key1')]);
    const saved = JSON.parse(await fs.readFile(path.join(dir, 'vesper-data.json'), 'utf8'));
    assert.equal(Object.keys(saved).length, 29);
    assert.equal(await disk.get('extra', 'json'), 'kept');
    assert.equal(await disk.get('key0'), null);
    assert.deepEqual((await fs.readdir(dir)).sort(), ['backups', 'vesper-data.json']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

await test('file KV never overwrites corrupt data with an empty state', async () => {
  const { createFileStore } = await import('../server-store.mjs');
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vesper-corrupt-'));
  try {
    const file = path.join(dir, 'vesper-data.json');
    await fs.writeFile(file, 'broken JSON');
    await assert.rejects(createFileStore(dir).put('state', '{}'));
    assert.equal(await fs.readFile(file, 'utf8'), 'broken JSON');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

await test('file backups keep one immutable daily snapshot and rotate after 14 days', async () => {
  const { createFileStore } = await import('../server-store.mjs');
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vesper-backups-'));
  let clock = Date.parse('2026-01-01T12:00:00Z');
  const disk = createFileStore(dir, { now: () => clock });
  try {
    await disk.put('state', '{"first":true}');
    const backup = path.join(dir, 'backups', '2026-01-01.json');
    const original = await fs.readFile(backup, 'utf8');
    await Promise.all([disk.put('state', '{"second":true}'), disk.put('other', '"kept"')]);
    assert.equal(await fs.readFile(backup, 'utf8'), original);
    assert.equal(JSON.parse(JSON.parse(original).state).first, true);
    await fs.writeFile(path.join(dir, 'backups', 'keep-me.txt'), 'not a snapshot');
    for (let day = 2; day <= 16; day++) {
      clock = Date.parse(`2026-01-${String(day).padStart(2, '0')}T12:00:00Z`);
      await disk.put('state', JSON.stringify({ day }));
    }
    const files = await fs.readdir(path.join(dir, 'backups'));
    const dates = files.filter((f) => f.endsWith('.json')).sort();
    assert.equal(dates.length, 14); assert.equal(dates[0], '2026-01-03.json');
    assert.equal(dates.at(-1), '2026-01-16.json'); assert.ok(files.includes('keep-me.txt'));
    // Rotation and same-day immutability also work after restarting the store.
    await createFileStore(dir, { now: () => clock }).put('after-restart', '"yes"');
    assert.equal((await fs.readdir(path.join(dir, 'backups'))).length, 15);
    assert.equal((await disk.get('state', 'json')).day, 16);
    assert.equal((await fs.readdir(dir)).some((f) => f.endsWith('.tmp')), false);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

await test('Worker snapshots are daily, immutable, expire in 14 days and isolate users', async () => {
  const values = new Map(), options = new Map();
  const disk = {
    get: async (key, type) => values.has(key) ? type === 'json' ? JSON.parse(values.get(key)) : values.get(key) : null,
    put: async (key, value, opts) => { values.set(key, value); options.set(key, opts); },
    delete: async (key) => values.delete(key),
  };
  const testEnv = { APP_TOKEN: 'snapshot-test', VESPER: disk };
  const request = (path, body, token = 'snapshot-test') => hub.fetch(new Request(`https://hub.example${path}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), testEnv);
  const state = { projects: [{ id: 'p', name: 'First', updated: 1 }], decks: [], deleted: {} };
  assert.equal((await request('/sync', { state })).status, 200);
  const key = `backup:${new Date().toISOString().slice(0, 10)}`;
  const first = values.get(key);
  assert.equal(JSON.parse(first).projects[0].name, 'First');
  assert.equal(options.get(key).expirationTtl, 14 * 86400);
  state.projects[0] = { ...state.projects[0], name: 'Second', updated: 2 };
  await request('/sync', { state });
  assert.equal(values.get(key), first);
  // A real scoped user exercises namespace isolation and KV option forwarding.
  const token = 'scoped-snapshot-test';
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex');
  values.set(`sess:${hash}`, JSON.stringify({ sub: 'backup-user', email: 'test@example.invalid', owner: false, exp: Date.now() + 60000 }));
  assert.equal((await request('/sync', { state }, token)).status, 200);
  const scoped = `u:backup-user:${key}`;
  assert.ok(values.has(scoped));
  assert.equal(options.get(scoped).expirationTtl, 14 * 86400);
  assert.equal(values.get(key), first);
});

await test('Worker daily snapshot TTL rotates storage across fifteen days', async () => {
  const RealDate = Date;
  let clock = RealDate.parse('2026-02-01T12:00:00Z');
  const values = new Map(), expires = new Map();
  const disk = {
    async get(key, type) {
      if (expires.has(key) && expires.get(key) <= clock) { values.delete(key); expires.delete(key); }
      return values.has(key) ? type === 'json' ? JSON.parse(values.get(key)) : values.get(key) : null;
    },
    async put(key, value, opts) {
      values.set(key, value);
      if (opts?.expirationTtl) expires.set(key, clock + opts.expirationTtl * 1000);
    },
  };
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  };
  try {
    for (let day = 1; day <= 15; day++) {
      clock = RealDate.parse(`2026-02-${String(day).padStart(2, '0')}T12:00:00Z`);
      const state = { projects: [{ id: 'p', name: `Day ${day}`, updated: day }], decks: [], deleted: {} };
      const res = await hub.fetch(new Request('https://hub.example/sync', {
        method: 'PUT', headers: { Authorization: 'Bearer rotation-test' }, body: JSON.stringify({ state }),
      }), { APP_TOKEN: 'rotation-test', VESPER: disk });
      assert.equal(res.status, 200);
    }
    for (const key of [...values.keys()]) await disk.get(key);
    assert.equal(await disk.get('backup:2026-02-01'), null);
    assert.equal([...values.keys()].filter((k) => k.startsWith('backup:')).length, 14);
    assert.equal(JSON.parse(await disk.get('state')).projects[0].name, 'Day 15');
  } finally { globalThis.Date = RealDate; }
});

await test('Node server serves every cached asset with correct content type, accepts hub calls and never serves private data', async () => {
  const { spawn } = await import('node:child_process');
  const { randomBytes } = await import('node:crypto');
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { once } = await import('node:events');
  const { fileURLToPath } = await import('node:url');
  // Use an isolated subfolder under the app's private data tree so traversal
  // attempts exercise the real default layout without touching the running data.
  const privateRoot = fileURLToPath(new URL('../data/', import.meta.url));
  await fs.mkdir(privateRoot, { recursive: true });
  const dir = await fs.mkdtemp(path.join(privateRoot, 'http-test-'));
  // Disposable token exists only in memory/child environment, never in test output
  // or a file. This is NOT the running Replit copy's APP_TOKEN Secret.
  const token = randomBytes(32).toString('hex');
  const boot = `
    import http from 'node:http';
    const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function (...args) {
      this.once('listening', () => process.send({ port: this.address().port }));
      return listen.apply(this, args);
    };
    await import('./server.mjs');
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', boot], {
    cwd: new URL('../', import.meta.url),
    env: { APP_TOKEN: token, DATA_DIR: dir, PORT: '0' },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  try {
    const [{ port }] = await once(child, 'message', { signal: AbortSignal.timeout(10000) });
    const url = `http://127.0.0.1:${port}`;
    const request = (route, init = {}) => fetch(url + route, { ...init, signal: AbortSignal.timeout(5000) });
    const { runInNewContext } = await import('node:vm');
    const sw = await fs.readFile(new URL('../sw.js', import.meta.url), 'utf8');
    const declaration = sw.match(/^const ASSETS = (\[[\s\S]*?\]);/m);
    assert.ok(declaration, 'service-worker cache declaration exists');
    const assets = runInNewContext(`(${declaration[1]})`);
    const mime = {
      '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
      '.webmanifest': 'application/manifest+json', '.json': 'application/json',
      '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
      '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
      '.txt': 'application/octet-stream',
    };
    for (const asset of [...assets, 'sw.js']) {
      const route = asset === './' ? '/' : '/' + asset;
      const expectedType = asset === './' ? 'text/html' : mime[path.extname(asset)];
      assert.ok(expectedType, `expected MIME type is defined for ${asset}`);
      for (const method of ['GET', 'HEAD']) {
        const response = await request(route, { method });
        assert.equal(response.status, 200, `${method} ${route}`);
        assert.equal(response.headers.get('content-type')?.split(';')[0], expectedType, `${method} ${route} MIME type`);
        if (method === 'GET') {
          const file = new URL('../' + (asset === './' ? 'index.html' : asset), import.meta.url);
          assert.deepEqual(Buffer.from(await response.arrayBuffer()), await fs.readFile(file), `${route} serves the actual file, not an HTML fallback`);
        } else assert.equal((await response.arrayBuffer()).byteLength, 0);
      }
    }
    assert.equal((await request('/')).status, 200);
    assert.equal((await request('/sync')).status, 401);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    assert.equal((await request('/sync', { headers })).status, 200);
    const createdTokenResponse = await request('/me/tokens', { method: 'POST', headers: { ...headers, Origin: url }, body: JSON.stringify({ label: 'HTTP phone' }) });
    assert.equal(createdTokenResponse.status, 201);
    const createdToken = await createdTokenResponse.json();
    const namedHeaders = { ...headers, Authorization: `Bearer ${createdToken.token}` };
    assert.equal((await request('/sync', { headers: namedHeaders })).status, 200);
    assert.equal((await request(`/me/tokens/${createdToken.id}/revoke`, { method: 'POST', headers, body: '{}' })).status, 200);
    assert.equal((await request('/sync', { headers: namedHeaders })).status, 401);
    const rpc = (id, name) => request('/mcp', {
      method: 'POST', headers,
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'vesper_create_project', arguments: { name } } }),
    });
    const responses = await Promise.all([rpc(1, 'HTTP A'), rpc(2, 'HTTP B')]);
    for (const r of responses) {
      assert.equal(r.status, 200);
      assert.ok(!(await r.json()).result.isError);
    }
    const saved = await (await request('/sync', { headers })).json();
    for (const name of ['HTTP A', 'HTTP B']) assert.ok(saved.state.projects.some((p) => p.name === name));
    assert.ok((await fs.readdir(path.join(dir, 'backups'))).some((f) => f.endsWith('.json')));
    const privatePath = `data%2f${path.basename(dir)}%2f`;
    const day = new Date().toISOString().slice(0, 10);
    for (const route of [
      '/data/vesper-data.json', '/data/backups/', '/backups/', '/server-store.mjs', '/worker/hub.src.js',
      `/css/..%2f${privatePath}vesper-data.json`, `/css/..%2f${privatePath}backups%2f${day}.json`,
    ]) {
      assert.equal((await request(route)).status, 404);
    }
  } finally {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

await test('finish: connector blocks missing Selahs and records a forced reason', async () => {
  await tool('vesper_create_project', { name: 'Finish guard' });
  await tool('vesper_create_task', { project: 'Finish guard', title: 'Finish checked task' });
  for (const fields of [{}, { force: true }, { force: true, reason: '   ' }, { reason: 'Not enough alone' }]) {
    const r = txt(await tool('vesper_finish', { task: 'Finish checked task', ...fields }));
    assert.equal(r.changed.length, 0); assert.match(r.notApplied[0], /Vision.*Research.*Plan.*Execute.*Review/);
  }
  const r = txt(await tool('vesper_finish', { task: 'Finish checked task', force: true, reason: 'Approved reduced scope.' }));
  assert.equal(r.changed.length, 1);
  let d = txt(await tool('vesper_get_task', { task: 'Finish checked task' }));
  assert.equal(d.finishedEarly.reason, 'Approved reduced scope.');
  assert.deepEqual(d.finishedEarly.skipped, ['vision', 'research', 'plan', 'execute', 'review']);
  let overview = txt(await tool('vesper_overview', {}));
  assert.match(overview.find((p) => p.project === 'Finish guard').tasks[0].check, /Finished with Selahs missing/);
  await tool('vesper_finish', { task: 'Finish checked task', reopen: true });
  for (const stage of ['vision', 'research', 'plan', 'execute', 'review']) {
    await tool('vesper_pass_selah', { task: 'Finish checked task', stage, answer: 'Checked and approved.' });
  }
  assert.equal(txt(await tool('vesper_finish', { task: 'Finish checked task' })).changed.length, 1);
  d = txt(await tool('vesper_get_task', { task: 'Finish checked task' }));
  assert.equal(d.finishedEarly, null);
  overview = txt(await tool('vesper_overview', {}));
  assert.equal(overview.find((p) => p.project === 'Finish guard').tasks[0].check, undefined);
});

await test('overview: reports passed stages beyond the current slide', async () => {
  const state = { projects: [{ id: 'check-p', name: 'Checks', updated: 1 }], decks: [{
    id: 'check-d', projectId: 'check-p', title: 'Inconsistent', updated: 1, slide: 1, reached: 1,
    notes: {}, ticks: {}, selah: { research: true }, finished: null,
  }] };
  await call('/sync', { method: 'PUT', headers: app, body: { state } });
  const task = txt(await tool('vesper_overview', {})).find((p) => p.id === 'check-p').tasks[0];
  assert.match(task.check, /beyond current stage: Research/);
  assert.match(task.check, /before passed Selahs: Research/);
});

await test('tasks: connector schema, metadata set/clear and overview/detail output', async () => {
  const tools = (await rpc('tools/list', {})).result.tools;
  const schema = tools.find((t) => t.name === 'vesper_set_task').inputSchema;
  assert.ok(schema.properties.priority.enum.includes(null));
  assert.ok(schema.properties.due.type.includes('null'));
  await tool('vesper_create_project', { name: 'Task metadata' });
  await tool('vesper_create_task', { project: 'Task metadata', title: 'Metadata task' });
  let d = txt(await tool('vesper_get_task', { task: 'Metadata task' }));
  assert.equal(d.priority, null); assert.equal(d.due, null);
  let r = txt(await tool('vesper_set_task', { task: d.id, priority: 'P1', due: '2028-02-29' }));
  assert.equal(r.changed.length, 1);
  d = txt(await tool('vesper_get_task', { task: d.id }));
  assert.equal(d.priority, 'P1'); assert.equal(d.due, '2028-02-29');
  const overview = txt(await tool('vesper_overview', {})).find((p) => p.project === 'Task metadata').tasks[0];
  assert.equal(overview.priority, 'P1'); assert.equal(overview.due, '2028-02-29');
  for (const patch of [{ priority: 'P5' }, { due: '2027-02-29' }, { priority: null, due: 'bad' }, {}]) {
    r = txt(await tool('vesper_set_task', { task: d.id, ...patch }));
    assert.equal(r.changed.length, 0); assert.ok(r.notApplied.length);
  }
  d = txt(await tool('vesper_get_task', { task: d.id }));
  assert.equal(d.priority, 'P1');
  await tool('vesper_set_task', { task: d.id, priority: null });
  d = txt(await tool('vesper_get_task', { task: d.id }));
  assert.equal(d.priority, null); assert.equal(d.due, '2028-02-29');
  await tool('vesper_set_task', { task: d.id, due: null });
  assert.equal(txt(await tool('vesper_get_task', { task: d.id })).due, null);
});

await test('tasks: simultaneous connector updates preserve priority and due separately', async () => {
  await tool('vesper_create_task', { project: 'Task metadata', title: 'Parallel metadata' });
  const d = txt(await tool('vesper_get_task', { task: 'Parallel metadata' }));
  await Promise.all([
    tool('vesper_set_task', { task: d.id, priority: 'P2' }),
    tool('vesper_set_task', { task: d.id, due: '2027-03-01' }),
  ]);
  let saved = txt(await tool('vesper_get_task', { task: d.id }));
  assert.equal(saved.priority, 'P2'); assert.equal(saved.due, '2027-03-01');
  await Promise.all([
    tool('vesper_set_task', { task: d.id, priority: null }),
    tool('vesper_set_task', { task: d.id, due: null }),
  ]);
  saved = txt(await tool('vesper_get_task', { task: d.id }));
  assert.equal(saved.priority, null); assert.equal(saved.due, null);
});

await test('organize: connector renames, moves and orders projects and tasks', async () => {
  await tool('vesper_create_project', { name: 'Organize A' });
  await tool('vesper_create_project', { name: 'Organize B' });
  await tool('vesper_create_task', { project: 'Organize A', title: 'Organize one' });
  await tool('vesper_create_task', { project: 'Organize A', title: 'Organize two' });
  const a = txt(await tool('vesper_get_task', { task: 'Organize one' }));
  const b = txt(await tool('vesper_get_task', { task: 'Organize two' }));
  assert.equal(txt(await tool('vesper_rename', { task: a.id, name: 'Organized one' })).changed.length, 1);
  assert.equal(txt(await tool('vesper_reorder', { kind: 'tasks', project: 'Organize A', order: [b.id, a.id] })).changed.length, 1);
  assert.equal(txt(await tool('vesper_reorder', { kind: 'tasks', project: 'Organize A', item: a.id, position: 1 })).changed.length, 1);
  assert.equal(txt(await tool('vesper_move_task', { task: a.id, project: 'Organize B' })).changed.length, 1);
  assert.equal(txt(await tool('vesper_get_task', { task: a.id })).project, 'Organize B');
  assert.equal(txt(await tool('vesper_rename', { project: 'Organize B', name: 'Organized B' })).changed.length, 1);
  assert.equal(txt(await tool('vesper_get_task', { task: a.id })).project, 'Organized B');
  assert.equal(txt(await tool('vesper_reorder', { kind: 'tasks', project: 'Organize A', order: [] })).changed.length, 0);
});

await test('overview: connector filters, compact JSON and project counts', async () => {
  const project = { id: 'filter-p', name: 'Filter project', updated: 1 };
  const state = { projects: [project], decks: [
    { id: 'filter-a', projectId: project.id, title: 'Find me', updated: 1, reached: 1, slide: 1, notes: {}, ticks: {}, selah: {}, priority: 'P1', due: '2027-01-01' },
    { id: 'filter-b', projectId: project.id, title: 'Other', updated: 1, reached: 0, slide: 0, notes: {}, ticks: {}, selah: {} },
  ] };
  await call('/sync', { method: 'PUT', headers: app, body: { state } });
  for (const filters of [{ query: 'Find me' }, { query: 'FILTER PROJECT', priority: 'P1' }, { project: project.id, status: 'active' }, { project: 'Filter project', stage: 'vision', dueBefore: '2027-01-02' }]) {
    const rows = txt(await tool('vesper_overview', filters)).flatMap((p) => p.tasks);
    assert.equal(rows.length, 1); assert.equal(rows[0].id, 'filter-a');
  }
  assert.equal(txt(await tool('vesper_overview', { project: project.id, status: 'not started', priority: 'none' }))[0].tasks[0].id, 'filter-b');
  assert.deepEqual(txt(await tool('vesper_overview', { project: project.id, dueBefore: '2027-01-01' })), []);
  assert.equal(txt(await tool('vesper_overview', { project: project.id, limit: 1 }))[0].tasks.length, 1);
  assert.equal((await tool('vesper_overview', { limit: -1 })).isError, true);
  const raw = (await tool('vesper_overview', { project: project.id })).content[0].text;
  assert.equal(raw.split('\n').filter((line) => line.startsWith('{"id"')).length, 2);
  const listed = txt(await tool('vesper_list_projects', {})).find((p) => p.id === project.id);
  assert.deepEqual(listed, { id: project.id, name: project.name, tasks: 2 });
});

await test('tokens: create once, hash storage, use all owner endpoints, last used and revoke', async () => {
  const records = new Map();
  const tokenEnv = {
    APP_TOKEN: 'master-test-only', NVIDIA_API_KEY: 'proxy-test-only',
    VESPER: {
      dailyBackups: true,
      get: async (k, t) => records.has(k) ? t === 'json' ? JSON.parse(records.get(k)) : records.get(k) : null,
      put: async (k, v) => { records.set(k, v); },
    },
  };
  const req = (path, { method = 'GET', token = 'master-test-only', body } = {}) => hub.fetch(new Request('https://hub.example' + path, {
    method, headers: { Authorization: `Bearer ${token}`, Origin: 'https://hub.example', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), tokenEnv);
  assert.equal((await req('/me/tokens', { token: '' })).status, 401);
  assert.deepEqual((await (await req('/me/tokens')).json()).tokens, []);
  for (const label of ['', ' '.repeat(3), 'x'.repeat(81)]) assert.equal((await req('/me/tokens', { method: 'POST', body: { label } })).status, 400);
  const created = await req('/me/tokens', { method: 'POST', body: { label: 'Claude' } });
  assert.equal(created.status, 201); assert.equal(created.headers.get('Cache-Control'), 'no-store');
  const named = await created.json();
  assert.equal(/^vnt_[0-9a-f]{64}$/.test(named.token), true);
  assert.equal(named.lastUsed, null); assert.equal(named.label, 'Claude');
  assert.equal(JSON.stringify([...records]).includes(named.token), false);
  assert.equal((await req('/sync', { token: named.token })).status, 200);
  const rpcBody = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
  assert.equal((await req(`/mcp/${named.token}`, { method: 'POST', token: '', body: rpcBody })).status, 200);
  assert.equal((await req('/mcp', { method: 'POST', token: named.token, body: rpcBody })).status, 200);
  assert.equal((await req('/me/tokens', { token: named.token })).status, 403);
  assert.equal((await req('/me/tokens', { token: named.token, method: 'POST', body: { label: 'Bypass' } })).status, 403);
  assert.equal((await req('/me/mcp-link', { token: named.token, method: 'POST', body: {} })).status, 403);
  const listed = (await (await req('/me/tokens')).json()).tokens;
  assert.equal(listed[0].label, 'Claude'); assert.ok(listed[0].lastUsed >= named.created);
  assert.equal(JSON.stringify(listed).includes(named.token), false);
  const originalFetch = globalThis.fetch;
  let upstreams = 0;
  globalThis.fetch = async () => { upstreams++; return new Response('{"choices":[]}'); };
  try {
    const ai = { model: 'test-model', messages: [{ role: 'user', content: 'Test' }] };
    assert.equal((await req('/v1/chat/completions', { method: 'POST', token: named.token, body: ai })).status, 200);
    assert.equal((await req('/chat/completions', { method: 'POST', token: named.token, body: ai })).status, 200);
    assert.equal((await req(`/me/tokens/${named.id}/revoke`, { method: 'POST', body: {} })).status, 200);
    for (const path of ['/sync', `/mcp/${named.token}`, '/mcp', '/v1/chat/completions', '/chat/completions']) {
      assert.equal((await req(path, { method: path === '/sync' ? 'GET' : 'POST', token: named.token, body: path === '/sync' ? undefined : path.includes('completions') ? ai : rpcBody })).status, 401);
    }
    assert.equal((await req('/sync', { method: 'PUT', token: named.token, body: { state: { projects: [], decks: [] } } })).status, 401);
    assert.equal(upstreams, 2);
    assert.equal((await req('/sync')).status, 200);
    assert.equal((await req('/mcp', { method: 'POST', body: rpcBody })).status, 200);
    assert.equal((await req('/v1/chat/completions', { method: 'POST', body: ai })).status, 200);
    assert.equal((await (await req('/me/tokens')).json()).tokens[0].revoked > 0, true);
  } finally { globalThis.fetch = originalFetch; }
  const parallel = await Promise.all(['Phone', 'Laptop'].map((label) => req('/me/tokens', { method: 'POST', body: { label } })));
  assert.ok(parallel.every((r) => r.status === 201));
  assert.equal((await (await req('/me/tokens')).json()).tokens.length, 3);
});

await test('tokens: last used advances and revocation cannot be undone by late usage writes', async () => {
  const { createAccessToken, authenticateAccessToken, revokeAccessToken, listAccessTokens } = await import('../worker/access-tokens.js');
  const records = new Map();
  const kv = {
    get: async (k, t) => records.has(k) ? t === 'json' ? JSON.parse(records.get(k)) : records.get(k) : null,
    put: async (k, v) => { records.set(k, v); },
  };
  const token = await createAccessToken(kv, 'Race');
  await authenticateAccessToken(kv, token.token);
  const first = (await listAccessTokens(kv))[0].lastUsed;
  await new Promise((resolve) => setTimeout(resolve, 2));
  await authenticateAccessToken(kv, token.token);
  assert.ok((await listAccessTokens(kv))[0].lastUsed > first);
  await Promise.all([authenticateAccessToken(kv, token.token), revokeAccessToken(kv, token.id), authenticateAccessToken(kv, token.token)]);
  assert.equal(await authenticateAccessToken(kv, token.token), false);
  const stale = JSON.parse(records.get(`access:${token.id}`)); stale.revoked = null;
  records.set(`access:${token.id}`, JSON.stringify(stale));
  assert.equal(await authenticateAccessToken(kv, token.token), false);
});

await test('tokens: Google users retain their isolated data and cannot administer owner tokens', async () => {
  const token = 'google-isolation-fixture';
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex');
  kv.set(`sess:${hash}`, JSON.stringify({ sub: 'isolation-fixture', email: 'fixture@example.invalid', owner: false, exp: Date.now() + 60000 }));
  const response = await call('/me/tokens', { headers: as(token) });
  assert.equal(response.status, 403);
  const result = await call('/sync', { headers: as(token) });
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).state.projects, []);
});

await test('tokens: separate Worker regions use one authority, including after its restart', async () => {
  const { NamedAccessAuthority } = await import('../worker/vesper-hub.js');
  const records = new Map();
  const storage = { get: async (key) => records.get(key), put: async (key, value) => { records.set(key, value); } };
  let authority = new NamedAccessAuthority({ storage });
  const namespace = {
    idFromName: (name) => { assert.equal(name, 'vesper-owner-access'); return name; },
    get: () => ({ fetch: (req) => authority.fetch(req) }),
  };
  const staleKV = () => ({ get: async () => null, put: async () => {} });
  const a = { APP_TOKEN: 'test-master', VESPER: staleKV(), ACCESS_TOKENS: namespace };
  const b = { APP_TOKEN: 'test-master', VESPER: staleKV(), ACCESS_TOKENS: namespace };
  const req = (env, route, token = 'test-master', body) => hub.fetch(new Request(`https://hub.example${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const made = await req(a, '/me/tokens', 'test-master', { label: 'Multi-region' });
  assert.equal(made.status, 201);
  const named = await made.json();
  assert.equal((await req(b, '/sync', named.token)).status, 200);
  assert.ok((await (await req(a, '/me/tokens')).json()).tokens[0].lastUsed);
  assert.equal((await req(a, `/me/tokens/${named.id}/revoke`, 'test-master', {})).status, 200);
  assert.equal((await req(b, '/sync', named.token)).status, 401);
  authority = new NamedAccessAuthority({ storage });
  assert.equal((await req(b, '/sync', named.token)).status, 401);
  assert.equal(JSON.stringify([...records]).includes(named.token), false);
  const unbound = { APP_TOKEN: 'test-master', VESPER: staleKV() };
  assert.equal((await req(unbound, '/sync', named.token)).status, 401);
  assert.equal((await req(unbound, '/sync')).status, 200);
  const setup = await req(unbound, '/me/tokens');
  assert.equal(setup.status, 400);
  assert.ok((await setup.json()).error.includes('ACCESS_TOKENS'));
  b.ACCESS_TOKENS = { ...namespace, get: () => { throw new Error('Unavailable'); } };
  assert.equal((await req(b, '/sync', named.token)).status, 401);
  assert.equal((await req(b, '/sync')).status, 200);
});

await test('quick: connector creates, interviews, switches and finishes a Quick task safely', async () => {
  await tool('vesper_create_project', { name: 'Quick connector' });
  assert.equal(txt(await tool('vesper_create_task', { project: 'Quick connector', title: 'Quick test task', mode: 'quick' })).changed.length, 1);
  let d = txt(await tool('vesper_get_task', { task: 'Quick test task' }));
  assert.equal(d.mode, 'quick'); assert.equal(d.steps.length, 5); assert.equal(d.stepsFilled, '0/5');
  const questions = txt(await tool('vesper_next_questions', { task: d.id, limit: 20 }));
  assert.equal(questions.next.length, 5);
  assert.equal(questions.next[0].slide, 'vision.quick'); assert.equal(questions.next[0].step, null);
  assert.equal(txt(await tool('vesper_set_note', { task: d.id, slide: 'vision.quick', text: 'Small goal' })).changed.length, 1);
  assert.equal(txt(await tool('vesper_get_task', { task: d.id })).stepsFilled, '1/5');
  assert.equal(txt(await tool('vesper_next_questions', { task: d.id })).next[0].slide, 'research.quick');
  assert.equal(txt(await tool('vesper_set_task', { task: d.id, mode: 'full' })).changed.length, 1);
  await tool('vesper_set_note', { task: d.id, slide: 'vision.why', step: 0, text: 'Detailed reason' });
  assert.equal(txt(await tool('vesper_get_task', { task: d.id })).steps.length, 34);
  await tool('vesper_set_task', { task: d.id, mode: 'quick' });
  d = txt(await tool('vesper_get_task', { task: d.id }));
  assert.equal(d.steps[0].note, 'Small goal');
  const overview = txt(await tool('vesper_overview', { project: 'Quick connector' }))[0].tasks[0];
  assert.equal(overview.mode, 'quick'); assert.equal(overview.stepsFilled, '1/5'); assert.match(overview.where, /of 12/);
  assert.equal(txt(await tool('vesper_finish', { task: d.id })).changed.length, 0);
  for (const stage of ['vision', 'research', 'plan', 'execute', 'review']) {
    assert.equal(txt(await tool('vesper_pass_selah', { task: d.id, stage, answer: 'Checked and ready' })).changed.length, 1);
  }
  assert.equal(txt(await tool('vesper_finish', { task: d.id })).changed.length, 1);
  await tool('vesper_set_task', { task: d.id, mode: 'full' });
  assert.equal(txt(await tool('vesper_get_task', { task: d.id })).steps[0].note, 'Detailed reason');
  assert.equal(txt(await tool('vesper_create_task', { project: 'Quick connector', title: 'Invalid mode', mode: 'invalid' })).changed.length, 0);
});

console.log(failed ? `${failed} failed` : `${n} worker tests passed`);
process.exit(failed ? 1 : 0);
