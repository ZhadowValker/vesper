// Run: node tests/worker.test.js
import assert from 'node:assert/strict';
import worker from '../worker/nvidia-proxy.js';

const env = { NVIDIA_API_KEY: 'nv-secret', APP_TOKEN: 'tok', MODELS: 'good/model' };
const O = 'https://zhadowvalker.github.io';
let sent = null;
globalThis.fetch = async (url, init) => { sent = { url, init }; return new Response('{"choices":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } }); };
const req = (o = {}) => new Request('https://w.example/v1/chat/completions', {
  method: o.method || 'POST',
  headers: { Origin: o.origin ?? O, Authorization: o.auth ?? 'Bearer tok', 'Content-Type': 'application/json' },
  body: (o.method === 'OPTIONS') ? undefined : (o.body ?? JSON.stringify({ model: 'good/model', messages: [{ role: 'user', content: 'hi' }], max_tokens: 99999, stream: true })),
});

let r = await worker.fetch(req({ origin: 'https://evil.example' }), env);
assert.equal(r.status, 403);
r = await worker.fetch(req({ method: 'OPTIONS' }), env);
assert.equal(r.status, 204); assert.equal(r.headers.get('Access-Control-Allow-Origin'), O);
r = await worker.fetch(req({ auth: 'Bearer wrong' }), env);
assert.equal(r.status, 401);
r = await worker.fetch(req({ body: JSON.stringify({ model: 'other/model', messages: [] }) }), env);
assert.equal(r.status, 403);
r = await worker.fetch(req({ body: 'not json' }), env);
assert.equal(r.status, 400);
assert.equal(sent, null);
r = await worker.fetch(req(), env);
assert.equal(r.status, 200); assert.equal(r.headers.get('Access-Control-Allow-Origin'), O);
const fwd = JSON.parse(sent.init.body);
assert.equal(fwd.stream, false); assert.equal(fwd.max_tokens, 4096);
assert.equal(sent.init.headers.Authorization, 'Bearer nv-secret');
assert.equal(sent.url, 'https://integrate.api.nvidia.com/v1/chat/completions');
console.log('worker tests passed');
