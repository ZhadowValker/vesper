// File-backed subset of KV. One queue owns every read/modify/write, including deletes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function createFileStore(dataDir, { now = Date.now } = {}) {
  const file = path.join(dataDir, 'vesper-data.json');
  const backups = path.join(dataDir, 'backups');
  let pending = Promise.resolve();
  const enqueue = (fn) => {
    const result = pending.then(fn);
    pending = result.catch(() => {}); // Report this failure, but let the next write try.
    return result;
  };
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
  async function update(change) {
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
    backupMigration: () => enqueue(async () => {
      await fs.mkdir(backups, { recursive: true });
      const snapshot = path.join(backups, 'pre-v2.json');
      try { await fs.access(snapshot); }
      catch (e) { if (e.code !== 'ENOENT') throw e; await atomicWrite(snapshot, await readAll()); }
    }),
    async get(key, type) {
      await pending;
      const value = (await readAll())[key];
      return value === undefined ? null : type === 'json' ? JSON.parse(value) : value;
    },
    put: (key, value) => enqueue(() => update((all) => { all[key] = value; })),
    delete: (key) => enqueue(() => update((all) => { delete all[key]; })),
  };
}
