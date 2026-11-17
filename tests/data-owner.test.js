// Account switch safety. Run: node tests/data-owner.test.js
import assert from 'node:assert/strict';
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { store } = await import('../js/store.js');
const D = await import('../js/data-owner.js');
const count = () => store.snapshot().projects.length;
const A = D.accountId('A@x.com'), B = D.accountId('b@x.com');

// A device with projects and no owner yet (made before any sign-in): must ask, and block uploads meanwhile.
store.reset();
if (count() === 0) { const s = store.snapshot(); s.projects.push({ id: 'p1', title: 'p1' }); store.applyMerged(s); }
assert.ok(count() > 0, 'test setup has a project');
assert.equal(D.claimDevice(store, A), 'ask');
assert.equal(D.mayUpload(A), false, 'no upload while the question is open');
assert.equal(D.resolveAsk(store, A, true), 'same');
assert.equal(count(), 1, 'attached data is kept');
assert.equal(D.mayUpload(A), true);

// Same account signs in again: nothing changes.
assert.equal(D.claimDevice(store, A), 'same');
assert.equal(count(), 1);

// Account B signs in on the same browser: A's projects must not reach B.
assert.equal(D.mayUpload(B), false, 'B may not upload A data');
assert.equal(D.claimDevice(store, B), 'moved');
assert.equal(count(), 0, 'device is empty for B');
assert.equal(D.mayUpload(B), true);
assert.equal(D.mayUpload(A), false, 'and A data is no longer on the device');
const stash = JSON.parse(localStorage.getItem('vesper.stash'));
assert.equal(stash.owner, A);
assert.equal(stash.state.projects.length, 1, "A's projects are kept in a private device copy");

// B adds a project, A comes back: B's project must not reach A either.
const s = store.snapshot(); s.projects.push({ id: 'pb', title: 'b' }); store.applyMerged(s);
assert.equal(D.claimDevice(store, A), 'moved');
assert.equal(count(), 0, 'A starts from their own account data, not B');

// Answering "no" to the question keeps the data off the account and sets it aside.
store.reset(); mem.delete('vesper.dataowner');
const t = store.snapshot(); t.projects.push({ id: 'pz', title: 'z' }); store.applyMerged(t);
assert.equal(D.claimDevice(store, B), 'ask');
assert.equal(D.resolveAsk(store, B, false), 'moved');
assert.equal(count(), 0);
assert.equal(JSON.parse(localStorage.getItem('vesper.stash')).state.projects.length, 1);

// An empty device just becomes the new account's.
store.reset(); mem.delete('vesper.dataowner');
assert.equal(D.claimDevice(store, A), 'same');
assert.equal(D.getDataOwner(), A);
console.log('data-owner tests passed');
