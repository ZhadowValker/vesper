// Persist canonical v2 data while retaining the original storage key for upgrades.
import { createModelDb, normalizeV2, emptyV2, isV1, flowAliases } from './model-v2.js';
const KEY = 'vesper.v1';
function read() {
  if (typeof localStorage === 'undefined') return emptyV2();
  const raw = localStorage.getItem(KEY);
  if (!raw) return emptyV2();
  const original = JSON.parse(raw), next = normalizeV2(original);
  if (isV1(original)) {
    // Abort rather than overwrite the only copy if quota prevents the backup.
    if (!localStorage.getItem('vesper.pre-v2')) localStorage.setItem('vesper.pre-v2', raw);
    localStorage.setItem(KEY, JSON.stringify(next));
  }
  return next;
}
let state = read(), quiet = false;
const listeners = [];
function write() {
  if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(state));
  if (!quiet) for (const fn of listeners) { try { fn(); } catch { /* independent subscribers */ } }
}
let db = createModelDb(state, write);
const extras = {
  findSample: (key) => state.areas.find((a) => a.sample === key),
  insertSample(built) {
    const a = db.addArea(built.project.name); a.sample = built.sample; a.created = built.project.created;
    for (const source of built.decks) {
      const p = db.addFlowProject(a.id, source.title);
      const id = p.id;
      Object.assign(p, source, { id, areaId: a.id, mode: 'full' }); delete p.projectId; flowAliases(p); db.save(p);
    }
    return a;
  },
  exportJSON: () => JSON.stringify(state, null, 2),
  importJSON(text) { state = normalizeV2(JSON.parse(text)); db = createModelDb(state, write); write(); },
  snapshot: () => normalizeV2(state),
  onChange(fn) { listeners.push(fn); },
  applyMerged(next) {
    next = normalizeV2(next);
    quiet = true;
    try {
      for (const key of ['areas', 'projects', 'tasks']) {
        const incoming = next[key], list = state[key], ids = new Set(incoming.map((x) => x.id));
        for (let i = list.length - 1; i >= 0; i--) if (!ids.has(list[i].id)) list.splice(i, 1);
        for (const x of incoming) {
          const have = list.find((y) => y.id === x.id);
          if (have) { for (const k of Object.keys(have)) delete have[k]; Object.assign(have, x); if (key === 'projects') flowAliases(have); }
          else list.push(key === 'projects' ? flowAliases(x) : x);
        }
      }
      state.deleted = next.deleted; db = createModelDb(state, write); write();
    } finally { quiet = false; }
  },
  reset() { state = emptyV2(); db = createModelDb(state, write); write(); },
};
export const store = new Proxy(extras, { get(target, key) { return Object.hasOwn(target, key) ? target[key] : db[key]; } });
