// Merging two copies of the data (for sync). Newest edit wins per project or task, and a
// deletion wins over an older edit. Plain functions, shared by the app and the Worker.
const stamp = (x) => x.updated || x.created || 0;

function pick(a, b) {
  const byId = new Map();
  const order = [];
  for (const item of [...a, ...b]) {
    const have = byId.get(item.id);
    if (!have) { byId.set(item.id, item); order.push(item.id); }
    else if (stamp(item) > stamp(have)) byId.set(item.id, item);
  }
  return order.map((id) => byId.get(id));
}

export function emptyState() {
  return { version: 1, projects: [], decks: [], deleted: {} };
}

export function mergeStates(a, b) {
  a = a || emptyState(); b = b || emptyState();
  const deleted = { ...(a.deleted || {}) };
  for (const [id, ts] of Object.entries(b.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, ts);
  const alive = (x) => !(deleted[x.id] && deleted[x.id] >= stamp(x));
  const projects = pick(a.projects || [], b.projects || []).filter(alive);
  const ids = new Set(projects.map((p) => p.id));
  const decks = pick(a.decks || [], b.decks || []).filter(alive).filter((d) => ids.has(d.projectId));
  return { version: 1, projects, decks, deleted };
}

// True when two states hold the same data (ignoring order of keys).
export function sameState(a, b) {
  const norm = (s) => JSON.stringify({ p: [...s.projects].sort((x, y) => (x.id > y.id ? 1 : -1)), d: [...s.decks].sort((x, y) => (x.id > y.id ? 1 : -1)), x: s.deleted || {} });
  return norm(a) === norm(b);
}
