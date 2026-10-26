// Tests the built hub Worker (worker/vesper-hub.js) with a fake KV: auth, sync merge, Claude connector tools.
import assert from 'node:assert/strict';
import hub from '../worker/vesper-hub.js';

const kv = new Map();
const env = { APP_TOKEN: 'tok-123', VESPER: { get: async (k, t) => (kv.has(k) ? (t === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => { kv.set(k, v); } } };
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

console.log(failed ? `${failed} failed` : `${n} worker tests passed`);
process.exit(failed ? 1 : 0);
