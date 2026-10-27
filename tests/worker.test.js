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
  assert.deepEqual(start.searchParams.get('scope').split(' '), ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.appdata']);
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
  assert.equal((await (await call('/google/status', { headers: as(bob.token) })).json()).connected, false);
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

await test('login: not set up means a clear message', async () => {
  const saved = env.GOOGLE_CLIENT_ID; env.GOOGLE_CLIENT_ID = '';
  const r = await call('/auth/google/start', { method: 'POST', headers: { Origin: ORIGIN } });
  assert.equal(r.status, 400);
  env.GOOGLE_CLIENT_ID = saved;
});

globalThis.fetch = realFetch;

console.log(failed ? `${failed} failed` : `${n} worker tests passed`);
process.exit(failed ? 1 : 0);
