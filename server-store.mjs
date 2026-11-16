// File-backed subset of KV. Every mutation/transaction owns a cross-process lock.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

export function createFileStore(dataDir, { now = Date.now, lockTimeoutMs = 5000, staleLockMs = 30000 } = {}) {
  const file = path.join(dataDir, 'vesper-data.json');
  const backups = path.join(dataDir, 'backups');
  const lock = `${file}.lock`;
  const context = new AsyncLocalStorage();
  let pending = Promise.resolve();
  let mutations = Promise.resolve();
  const inTransaction = () => context.getStore()?.active === true;
  const enqueue = (fn) => {
    const result = pending.then(fn);
    pending = result.catch(() => {}); // Report this failure, but let the next write try.
    return result;
  };
  const pause = () => new Promise((resolve) => setTimeout(resolve, 10 + Math.floor(Math.random() * 25)));
  const missing = (error) => error.code === 'ENOENT';
  async function removeEmptyLock() {
    try { await fs.rmdir(lock); }
    catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; }
  }
  async function recoverLock() {
    try {
      const owners = await fs.readdir(lock);
      if (!owners.length) {
        // A creator may have been paused between mkdir and creating its marker.
        if (Date.now() - (await fs.stat(lock)).mtimeMs >= staleLockMs) await removeEmptyLock();
        return;
      }
      for (const name of owners) {
        const match = /^owner-([1-9]\d*)-[0-9a-f-]{36}$/.exec(name);
        if (!match) return; // Unknown contents: fail closed, never delete arbitrary files.
        try { process.kill(Number(match[1]), 0); return; }
        catch (error) { if (error.code !== 'ESRCH') return; } // Alive or inaccessible is NOT stale.
      }
      // Remove only the dead owners we inspected, never a replacement owner's marker.
      for (const name of owners) await fs.unlink(path.join(lock, name)).catch((error) => { if (!missing(error)) throw error; });
      await removeEmptyLock(); // Atomic rmdir fails if a new owner has initialized.
    } catch (error) { if (!missing(error)) throw error; }
  }
  async function acquire() {
    await fs.mkdir(dataDir, { recursive: true });
    const owner = `owner-${process.pid}-${randomUUID()}`;
    const marker = path.join(lock, owner);
    const started = performance.now();
    for (;;) {
      let created = false;
      try {
        await fs.mkdir(lock, { mode: 0o700 });
        created = true;
        await fs.writeFile(marker, '', { flag: 'wx', mode: 0o600 });
        // A stale empty directory can be reclaimed while its original creator is
        // paused. Only enter if our unique marker is the sole owner. Once present,
        // a live PID's marker is never reaped, regardless of elapsed time.
        const owners = await fs.readdir(lock);
        if (owners.length === 1 && owners[0] === owner) return async () => {
          await fs.unlink(marker);
          await removeEmptyLock();
        };
      } catch (error) {
        if (!['EEXIST', 'ENOENT'].includes(error.code)) throw error;
      }
      if (created) await fs.unlink(marker).catch((error) => { if (!missing(error)) throw error; });
      await recoverLock();
      if (performance.now() - started >= lockTimeoutMs) {
        const error = new Error('File store lock timed out; no data was changed.');
        error.code = 'ELOCKTIMEOUT';
        throw error;
      }
      await pause();
    }
  }
  function transaction(action) {
    if (inTransaction()) return Promise.resolve().then(action);
    return enqueue(async () => {
      const release = await acquire();
      const scope = { active: true };
      try { return await context.run(scope, action); }
      finally { scope.active = false; await release(); }
    });
  }
  async function readAll() {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
  }
  async function atomicWrite(target, value) {
    const tmp = `${target}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
      await fs.rename(tmp, target);
    } finally { await fs.rm(tmp, { force: true }); }
  }
  async function backup(all) {
    const today = new Date(now()).toISOString().slice(0, 10);
    await fs.mkdir(backups, { recursive: true });
    const snapshot = path.join(backups, `${today}.json`);
    try { await fs.access(snapshot); }
    catch (e) { if (e.code !== 'ENOENT') throw e; await atomicWrite(snapshot, all); }
    // Retain today plus the preceding thirteen UTC dates. Never remove other files.
    const cutoff = new Date(Date.parse(today) - 13 * 86400000).toISOString().slice(0, 10);
    for (const name of await fs.readdir(backups)) {
      if (/^\d{4}-\d{2}-\d{2}\.json$/.test(name) && name.slice(0, 10) < cutoff) {
        await fs.unlink(path.join(backups, name));
      }
    }
  }
  function update(change) {
    // A caller may await Promise.all(puts) inside one locked transaction.
    const result = mutations.then(() => applyChange(change));
    mutations = result.catch(() => {});
    return result;
  }
  async function applyChange(change) {
    const all = await readAll();
    const previous = structuredClone(all);
    change(all);
    await fs.mkdir(dataDir, { recursive: true });
    // Before the first write of the day, keep the previous good data. On a brand-new
    // install there is no prior file, so snapshot the first value instead.
    await backup(Object.keys(previous).length ? previous : all);
    await atomicWrite(file, all);
  }
  return {
    dailyBackups: true,
    // Hub read/merge/save and named-token read/modify/write must share the lock too.
    transaction,
    backupMigration: () => transaction(async () => {
      await fs.mkdir(backups, { recursive: true });
      const snapshot = path.join(backups, 'pre-v2.json');
      try { await fs.access(snapshot); }
      catch (e) { if (e.code !== 'ENOENT') throw e; await atomicWrite(snapshot, await readAll()); }
    }),
    async get(key, type) {
      if (!inTransaction()) await pending;
      await mutations;
      // Atomic rename means even readers in other processes see a complete file.
      const value = (await readAll())[key];
      return value === undefined ? null : type === 'json' ? JSON.parse(value) : value;
    },
    // KV expiration/expirationTtl hints are deliberately ignored on Node, as before:
    // auth records enforce their embedded exp; daily backups rotate separately.
    // This preserves the on-disk format and cannot prematurely discard sign-in data.
    put: (key, value, _options) => transaction(() => update((all) => { all[key] = value; })),
    delete: (key) => transaction(() => update((all) => { delete all[key]; })),
  };
}
