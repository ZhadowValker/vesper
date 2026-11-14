// File-backed subset of KV. One queue owns every read/modify/write, including deletes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function createFileStore(dataDir) {
  const file = path.join(dataDir, 'vesper-data.json');
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
  async function update(change) {
    const all = await readAll();
    change(all);
    await fs.mkdir(dataDir, { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(all), { mode: 0o600 });
      await fs.rename(tmp, file);
    } finally { await fs.rm(tmp, { force: true }); }
  }
  return {
    async get(key, type) {
      await pending;
      const value = (await readAll())[key];
      return value === undefined ? null : type === 'json' ? JSON.parse(value) : value;
    },
    put: (key, value) => enqueue(() => update((all) => { all[key] = value; })),
    delete: (key) => enqueue(() => update((all) => { delete all[key]; })),
  };
}
