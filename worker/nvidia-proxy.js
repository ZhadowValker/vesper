// Cloudflare Worker: lets the Vesper web app call NVIDIA's free API.
// NVIDIA's servers refuse calls made directly from a web page, so the app calls this
// Worker instead. Your NVIDIA key stays here as a secret and never reaches the phone.
//
// Secrets to set in Cloudflare (Settings > Variables and Secrets):
//   NVIDIA_API_KEY  your key from build.nvidia.com
//   APP_TOKEN       any long random text; paste the same text into Vesper's AI settings "Key" box
// Optional:
//   MODELS          comma-separated model names to allow (empty = any)

const ALLOWED_ORIGINS = [
  'https://zhadowvalker.github.io',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
];
const UPSTREAM = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MAX_BODY = 100000;
const MAX_TOKENS = 4096;

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization,content-type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (status, obj, origin) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...(origin ? cors(origin) : {}) } });

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (!ALLOWED_ORIGINS.includes(origin)) return json(403, { error: 'origin not allowed' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    if (request.method !== 'POST' || !(path === '/v1/chat/completions' || path === '/chat/completions')) {
      return json(404, { error: 'not found' }, origin);
    }
    if (!env.APP_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.APP_TOKEN}`) {
      return json(401, { error: 'bad token' }, origin);
    }
    if (!env.NVIDIA_API_KEY) return json(500, { error: 'NVIDIA_API_KEY is not set on the Worker' }, origin);

    const text = await request.text();
    if (text.length > MAX_BODY) return json(413, { error: 'request too large' }, origin);
    let body;
    try { body = JSON.parse(text); } catch (e) { return json(400, { error: 'invalid JSON' }, origin); }
    if (!body || typeof body.model !== 'string' || !Array.isArray(body.messages)) return json(400, { error: 'model and messages are required' }, origin);
    const allowed = (env.MODELS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (allowed.length && !allowed.includes(body.model)) return json(403, { error: 'model not allowed' }, origin);

    body.stream = false;
    body.max_tokens = Math.min(Number(body.max_tokens) || 2048, MAX_TOKENS);

    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.NVIDIA_API_KEY}` },
      body: JSON.stringify(body),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('Content-Type') || 'application/json', ...cors(origin) },
    });
  },
};
