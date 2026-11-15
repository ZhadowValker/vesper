// Shared by the app and hub. Old task timestamps remain the fallback for old backups.
import { normalizeV2, flowAliases } from './model-v2.js';
const stamp = (x) => x.updated || x.created || 0;
const maps = ['notes', 'ticks', 'selah', 'selahBy'];
const fieldKeys = (d) => Object.keys(d).filter((k) => !['id', 'created', 'updated', '_changed', ...maps].includes(k));
const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const stable = (v) => JSON.stringify(v && typeof v === 'object'
  ? Array.isArray(v) ? v.map((x) => JSON.parse(stable(x))) : Object.fromEntries(Object.keys(v).sort().map((k) => [k, JSON.parse(stable(v[k]))]))
  : v === undefined ? null : v);
const itemTime = (d, group, key) => d._changed?.[group]?.[key] ??
  (own(group === 'fields' ? d : d[group], key) ? stamp(d) : 0);

// Call with the last SAVED copy: the UI intentionally edits task objects in place.
// Seed unchanged items with the old time before advancing updated, so editing one
// step never makes all of the other steps look newly edited.
export function stampDeck(deck, before, now = Date.now()) {
  before = before || deck;
  const time = Math.max(now, stamp(before) + 1);
  const times = {};
  for (const group of ['fields', ...maps]) {
    const oldValues = group === 'fields' ? Object.fromEntries(fieldKeys(before).map((k) => [k, before[k]])) : before[group] || {};
    const values = group === 'fields' ? Object.fromEntries(fieldKeys(deck).map((k) => [k, deck[k]])) : deck[group] || {};
    times[group] = { ...(before._changed?.[group] || {}) };
    for (const key of new Set([...Object.keys(oldValues), ...Object.keys(values)])) {
      const changed = own(oldValues, key) !== own(values, key) || stable(oldValues[key]) !== stable(values[key]);
      times[group][key] = changed ? time : itemTime(before, group, key);
    }
  }
  deck._changed = times;
  deck.updated = time;
}

export const stampProject = (project, before, now = Date.now()) => stampDeck(project, before, now);
function mergeProject(a, b) {
  const merged = mergeDeck(a, b);
  for (const group of maps) delete merged[group];
  return merged;
}

function mergeDeck(a, b) {
  const newer = stamp(a) > stamp(b) || (stamp(a) === stamp(b) && stable(a) > stable(b)) ? a : b;
  const result = { id: newer.id, created: newer.created, updated: Math.max(stamp(a), stamp(b)), _changed: {} };
  for (const group of ['fields', ...maps]) {
    const av = group === 'fields' ? Object.fromEntries(fieldKeys(a).map((k) => [k, a[k]])) : a[group] || {};
    const bv = group === 'fields' ? Object.fromEntries(fieldKeys(b).map((k) => [k, b[k]])) : b[group] || {};
    const values = {};
    const times = {};
    const keys = new Set([...Object.keys(av), ...Object.keys(bv), ...Object.keys(a._changed?.[group] || {}), ...Object.keys(b._changed?.[group] || {})]);
    for (const key of [...keys].sort()) {
      const at = itemTime(a, group, key), bt = itemTime(b, group, key);
      // A missing value with an explicit clock is a per-item deletion. On equal
      // times it wins; other ties are deterministic regardless of merge order.
      const fromA = at > bt || (at === bt && (!own(av, key) || (own(bv, key) && stable(av[key]) >= stable(bv[key]))));
      const source = fromA ? av : bv;
      if (own(source, key)) values[key] = source[key];
      times[key] = Math.max(at, bt);
    }
    if (group === 'fields') Object.assign(result, values);
    else if (keys.size || group !== 'selahBy') result[group] = values;
    result._changed[group] = times;
  }
  return result;
}

function pick(a, b, merge) {
  const byId = new Map();
  const order = [];
  for (const item of [...a, ...b]) {
    const have = byId.get(item.id);
    if (!have) { byId.set(item.id, item); order.push(item.id); }
    else if (merge) byId.set(item.id, merge(have, item));
    else if (stamp(item) > stamp(have) || (stamp(item) === stamp(have) && stable(item) > stable(have))) byId.set(item.id, item);
  }
  return order.map((id) => byId.get(id));
}

export function emptyState() {
  return { version: 1, projects: [], decks: [], deleted: {} };
}

function mergeV1(a, b) {
  a = a || emptyState(); b = b || emptyState();
  const deleted = { ...(a.deleted || {}) };
  for (const [id, ts] of Object.entries(b.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, ts);
  const alive = (x) => !(deleted[x.id] && deleted[x.id] >= stamp(x));
  const projects = pick(a.projects || [], b.projects || [], mergeProject).filter(alive);
  const ids = new Set(projects.map((p) => p.id));
  const decks = pick(a.decks || [], b.decks || [], mergeDeck).filter(alive).filter((d) => ids.has(d.projectId));
  return { version: 1, projects, decks, deleted };
}

export function mergeStates(a, b) {
  // Retain the legacy pure-function contract for callers merging two old backups.
  // Every persistent v2 store/hub normalizes before invoking this function.
  if (a?.version !== 2 && b?.version !== 2) return mergeV1(a, b);
  a = normalizeV2(a); b = normalizeV2(b);
  const deleted = { ...a.deleted };
  for (const [id, time] of Object.entries(b.deleted)) deleted[id] = Math.max(deleted[id] || 0, time);
  const alive = (x) => !(deleted[x.id] && deleted[x.id] >= stamp(x));
  const areas = pick(a.areas, b.areas, mergeProject).filter(alive);
  const areaIds = new Set(areas.map((x) => x.id));
  const projects = pick(a.projects, b.projects, mergeDeck).filter(alive).filter((p) => areaIds.has(p.areaId)).map(flowAliases);
  const projectIds = new Set(projects.map((p) => p.id));
  const tasks = pick(a.tasks, b.tasks, mergeProject).filter(alive).map((t) => {
    if ((t.location?.kind === 'area' && !areaIds.has(t.location.id)) ||
        (t.location?.kind === 'project' && !projectIds.has(t.location.id))) return { ...t, location: { kind: 'inbox' } };
    return t;
  });
  return { version: 2, areas, projects, tasks, deleted };
}

// True when two states hold the same data (ignoring order of keys).
export function sameState(a, b) {
  if (a?.version === 2 || b?.version === 2) {
    const canonical = (value) => {
      const s = normalizeV2(value);
      for (const key of ['areas', 'projects', 'tasks']) s[key].sort((x, y) => x.id.localeCompare(y.id));
      return stable(s);
    };
    return canonical(a) === canonical(b);
  }
  const norm = (s) => stable({ p: [...s.projects].sort((x, y) => (x.id > y.id ? 1 : -1)), d: [...s.decks].sort((x, y) => (x.id > y.id ? 1 : -1)), x: s.deleted || {} });
  return norm(a) === norm(b);
}
