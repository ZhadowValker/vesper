// Remembers whose projects are on this device, so one person's data is never sent to another person's account.
// Plain functions on purpose: the store is passed in, so this can be tested without a browser.
const OWNER_KEY = 'vesper.dataowner';
const STASH_KEY = 'vesper.stash';

export const accountId = (email) => String(email || 'owner').trim().toLowerCase() || 'owner';

export function getDataOwner() {
  try { return localStorage.getItem(OWNER_KEY) || ''; } catch (e) { return ''; }
}
export function setDataOwner(id) {
  try { if (id) localStorage.setItem(OWNER_KEY, id); else localStorage.removeItem(OWNER_KEY); } catch (e) { /* storage blocked */ }
}

export function hasLocalData(snap) {
  if (!snap) return false;
  return ['areas', 'projects', 'tasks'].some((k) => Array.isArray(snap[k]) && snap[k].length > 0);
}

// Keeps a private copy of what was on the device, then empties the device. Nothing is sent anywhere.
export function stashAndClear(store, ownerId) {
  try { localStorage.setItem(STASH_KEY, JSON.stringify({ owner: ownerId || '', at: Date.now(), state: store.snapshot() })); } catch (e) { /* quota: the data stays on the old account's server anyway */ }
  store.reset();
}

// Called when an account signs in. Returns:
//   'same'  - the device already held this account's data (or was empty): sync as normal
//   'moved' - it held another account's data: that copy was stashed and the device is now empty
//   'ask'   - it holds data that belongs to nobody yet: the person must say whether to attach it
export function claimDevice(store, id) {
  const owner = getDataOwner();
  const snap = store.snapshot();
  if (owner === id) return 'same';
  if (!hasLocalData(snap)) { setDataOwner(id); return 'same'; }
  if (owner && owner !== id) { stashAndClear(store, owner === 'pending' ? '' : owner); setDataOwner(id); return 'moved'; }
  setDataOwner('pending'); // blocks any upload until the person answers
  return 'ask';
}

// The person's answer to 'ask'. Anything but an explicit yes keeps their projects off the account.
export function resolveAsk(store, id, attach) {
  if (attach) { setDataOwner(id); return 'same'; }
  stashAndClear(store, '');
  setDataOwner(id);
  return 'moved';
}

// True when it is safe to send this device's projects to this account.
export function mayUpload(id) {
  const owner = getDataOwner();
  return !id || !owner || owner === id;
}

// Everything personal the browser keeps for Vesper (projects, old copies, AI key and chats, sign-in). Theme and
// the sign-in screen choice are not personal and stay.
const PERSONAL_KEYS = ['vesper.v1', 'vesper.pre-v2', 'vesper.stash', 'vesper.dataowner', 'vesper.ai', 'vesper.chat', 'vesper.task-list.v1', 'vesper.sync'];
export function clearDeviceData(store) {
  try { store.reset(); } catch (e) { /* nothing to reset */ }
  for (const k of PERSONAL_KEYS) { try { localStorage.removeItem(k); } catch (e) { /* storage blocked */ } }
}
