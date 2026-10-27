// Keeps your data the same on every device through your own Vesper hub (a Cloudflare Worker).
// Off until you give it the hub address and token. Sends a copy, gets back the merged result.
import { store } from './store.js';
import { mergeStates, sameState } from './merge.js';

const KEY = 'vesper.sync';
let timer = null, running = false, listeners = [];
let status = { state: 'off', at: 0, error: '' };

export function getSync() {
  try { const s = JSON.parse(localStorage.getItem(KEY) || '{}'); return { url: s.url || '', token: s.token || '' }; } catch (e) { return { url: '', token: '' }; }
}
export function saveSync(s) {
  try {
    if (!s || !s.url) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify({ url: s.url.trim().replace(/\/+$/, ''), token: (s.token || '').trim() }));
  } catch (e) { /* storage may be blocked */ }
  status = { state: syncReady() ? 'idle' : 'off', at: 0, error: '' };
  emit();
}
export const syncReady = () => { const s = getSync(); return !!(s.url && s.token); };
export const syncStatus = () => status;
export const onSyncStatus = (fn) => { listeners.push(fn); return () => { listeners = listeners.filter((x) => x !== fn); }; };
function emit() { listeners.forEach((fn) => { try { fn(status); } catch (e) { /* ignore */ } }); }

const typing = () => { const a = document.activeElement; return !!a && /^(TEXTAREA|INPUT)$/.test(a.tagName); };

export async function syncNow({ force = false } = {}) {
  if (!syncReady() || running) return status;
  const cfg = getSync();
  running = true; status = { ...status, state: 'syncing', error: '' }; emit();
  try {
    const local = store.snapshot();
    const res = await fetch(cfg.url + '/sync', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.token },
      body: JSON.stringify({ state: local }),
    });
    if (res.status === 401) throw new Error('The token was not accepted.');
    if (!res.ok) throw new Error('The hub answered with ' + res.status + '.');
    const { state: remote } = await res.json();
    const merged = mergeStates(local, remote);
    if (!sameState(merged, store.snapshot())) {
      if (typing() && !force) { status = { state: 'later', at: Date.now(), error: '' }; emit(); return status; }
      store.applyMerged(merged);
      document.dispatchEvent(new CustomEvent('vesper:synced'));
    }
    status = { state: 'ok', at: Date.now(), error: '' };
  } catch (e) {
    status = { state: 'error', at: status.at, error: e.name === 'TypeError' ? 'Could not reach the hub. Check the address and your connection.' : e.message };
  } finally { running = false; emit(); }
  return status;
}

function later(ms) { clearTimeout(timer); timer = setTimeout(() => syncNow(), ms); }

export function startSync() {
  if (!syncReady()) return;
  syncNow();
  store.onChange(() => { if (syncReady()) later(8000); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  window.addEventListener('online', () => syncNow());
  document.addEventListener('focusout', () => { if (status.state === 'later') later(1500); });
}

// Calls the hub with your token. Used for Google Calendar. Returns { ok, status, data }.
export async function hubCall(path, { method = 'GET', body } = {}) {
  const cfg = getSync();
  const res = await fetch(cfg.url + path, {
    method,
    headers: { Authorization: 'Bearer ' + cfg.token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* no body */ }
  return { ok: res.ok, status: res.status, data };
}
