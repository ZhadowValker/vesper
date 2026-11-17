// Owner credentials are stored separately from sync data. Never persist a raw token.
const accessQueues = new WeakMap();
const accessSeen = new WeakMap();
const accessRevoked = new WeakMap();
function accessQueue(kv, fn) {
  const result = (accessQueues.get(kv) || Promise.resolve()).then(fn);
  accessQueues.set(kv, result.catch(() => {}));
  return result;
}
async function accessHash(token) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const publicAccess = (record, lastUsed = record.lastUsed) => ({ id: record.id, label: record.label, created: record.created, lastUsed: lastUsed || null, revoked: record.revoked || null });

export function createAccessToken(kv, label) {
  return accessQueue(kv, async () => {
    if (typeof label !== 'string' || !label.trim() || label.trim().length > 80) throw new Error('Label must be 1–80 characters.');
    const ids = await kv.get('access:index', 'json') || [];
    if (ids.length >= 100) throw new Error('Token history is limited to 100 entries.');
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const token = 'vnt_' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    const id = await accessHash(token);
    const record = { id, label: label.trim(), created: Date.now(), lastUsed: null, revoked: null };
    await kv.put(`access:${id}`, JSON.stringify(record));
    await kv.put('access:index', JSON.stringify([...ids, id]));
    return { ...publicAccess(record), token };
  });
}
export function listAccessTokens(kv) {
  return accessQueue(kv, async () => {
    const ids = await kv.get('access:index', 'json') || [];
    const rows = await Promise.all(ids.map((id) => kv.get(`access:${id}`, 'json')));
    return rows.filter(Boolean).map((r) => publicAccess(r, Math.max(r.lastUsed || 0, accessSeen.get(kv)?.get(r.id) || 0)));
  });
}
export function revokeAccessToken(kv, id) {
  return accessQueue(kv, async () => {
    if (!/^[0-9a-f]{64}$/.test(id)) return false;
    const record = await kv.get(`access:${id}`, 'json');
    if (!record) return false;
    record.revoked = record.revoked || Date.now();
    await kv.put(`access:${id}`, JSON.stringify(record));
    let revoked = accessRevoked.get(kv);
    if (!revoked) { revoked = new Set(); accessRevoked.set(kv, revoked); }
    revoked.add(id);
    return true;
  });
}
export function authenticateAccessToken(kv, token) {
  if (typeof token !== 'string' || !/^vnt_[0-9a-f]{64}$/.test(token)) return Promise.resolve(false);
  return accessQueue(kv, async () => {
    const id = await accessHash(token);
    if (accessRevoked.get(kv)?.has(id)) return false;
    // No positive auth cache: every use rechecks the active/revoked record.
    const record = await kv.get(`access:${id}`, 'json');
    if (!record || record.revoked) return false;
    const now = Date.now();
    let seen = accessSeen.get(kv);
    if (!seen) { seen = new Map(); accessSeen.set(kv, seen); }
    seen.set(id, now);
    // KV rate-limits repeated writes to one key. Persist usage at most once/minute;
    // the current instance's owner list still reports the exact last observed use.
    if (!record.lastUsed || now - record.lastUsed >= 60000) {
      record.lastUsed = now;
      await kv.put(`access:${id}`, JSON.stringify(record));
    }
    return true;
  });
}

const accessMethods = {
  create: (kv, args) => createAccessToken(kv, args.label),
  list: (kv) => listAccessTokens(kv),
  revoke: (kv, args) => revokeAccessToken(kv, args.id),
  check: (kv, args) => authenticateAccessToken(kv, args.token),
};

// Cloudflare KV cannot provide immediate cross-region revocation. A single DO is
// authoritative for named credentials; Node's single-process store stays local.
export async function accessOperation(env, operation, args = {}) {
  const store = env.RAW || env.VESPER;   // sign-in keys always live in the server store, never in a person's Drive
  if (store?.dailyBackups) return accessMethods[operation](store, args);
  if (!env.ACCESS_TOKENS) throw new Error('Named tokens require the ACCESS_TOKENS Durable Object binding. APP_TOKEN and Google sign-in still work.');
  const authority = env.ACCESS_TOKENS.get(env.ACCESS_TOKENS.idFromName('vesper-owner-access'));
  const response = await authority.fetch(new Request(`https://access.internal/${operation}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  }));
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Access-token authority unavailable.');
  return result.value;
}

export class NamedAccessAuthority {
  constructor(state) {
    this.kv = {
      get: async (key, type) => {
        const value = await state.storage.get(key);
        return value === undefined ? null : type === 'json' ? JSON.parse(value) : value;
      },
      put: (key, value) => state.storage.put(key, value),
    };
  }
  async fetch(request) {
    try {
      const method = accessMethods[new URL(request.url).pathname.slice(1)];
      if (request.method !== 'POST' || !method) return Response.json({ error: 'not found' }, { status: 404 });
      const value = await method(this.kv, await request.json());
      return Response.json({ value }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) { return Response.json({ error: e.message }, { status: 400 }); }
  }
}
