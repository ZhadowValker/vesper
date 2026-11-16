import { orderedItems } from './organize.js';
export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
export const validDue = (value) => typeof value === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) &&
  value.slice(0, 4) !== '0000' && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function setTaskMeta(deck, patch) {
  const has = (key) => Object.prototype.hasOwnProperty.call(patch, key);
  if (!has('priority') && !has('due')) return 'Provide priority or due; use null to clear a value.';
  if (has('priority') && patch.priority !== null && !PRIORITIES.includes(patch.priority)) return 'Priority must be P1, P2, P3, P4, or null.';
  if (has('due') && patch.due !== null && !validDue(patch.due)) return 'Due must be a valid calendar date (YYYY-MM-DD), or null.';
  // Validate the whole patch before changing anything.
  for (const key of ['priority', 'due']) if (has(key)) deck[key] = patch[key];
  return null;
}

// Optional v2 Project field. Missing means not parked; do not backfill old data.
export function setProjectMeta(project, patch) {
  const metadata = Object.hasOwn(patch, 'priority') || Object.hasOwn(patch, 'due');
  if (!metadata && !Object.hasOwn(patch, 'parked')) return 'Provide priority, due or parked.';
  if (Object.hasOwn(patch, 'parked') && typeof patch.parked !== 'boolean') return 'parked must be true or false.';
  if (metadata) {
    const error = setTaskMeta(project, patch);
    if (error) return error;
  }
  if (Object.hasOwn(patch, 'parked')) project.parked = patch.parked;
  return null;
}

export function localCalendarDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export const isOverdue = (deck, today = localCalendarDate()) => !deck.finished && !deck.done && validDue(deck.due) && deck.due < today;

const PREF_KEY = 'vesper.task-list.v1';
const normalizePrefs = (p) => ({
  sort: ['order', 'updated', 'priority', 'due'].includes(p?.sort) ? p.sort : 'order',
  priority: ['all', 'none', ...PRIORITIES].includes(p?.priority) ? p.priority : 'all',
});
export function getTaskPrefs() {
  try { return normalizePrefs(JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); }
  catch (e) { return normalizePrefs({}); }
}
export function saveTaskPrefs(prefs) {
  const clean = normalizePrefs(prefs);
  try { localStorage.setItem(PREF_KEY, JSON.stringify(clean)); } catch (e) { /* browser storage unavailable */ }
  return clean;
}
export function sortFilterTasks(decks, prefs = {}) {
  const { sort, priority } = normalizePrefs(prefs);
  const rank = (d) => PRIORITIES.includes(d.priority) ? PRIORITIES.indexOf(d.priority) : 4;
  const due = (d) => validDue(d.due) ? d.due : '9999-99-99';
  const filtered = decks.filter((d) => priority === 'all' || (priority === 'none' ? rank(d) === 4 : d.priority === priority));
  if (sort === 'order') return orderedItems(filtered);
  return filtered.sort((a, b) => {
    const by = sort === 'priority' ? rank(a) - rank(b) : sort === 'due' ? due(a).localeCompare(due(b)) : 0;
    return by || (b.updated || b.created || 0) - (a.updated || a.created || 0) || String(a.id).localeCompare(String(b.id));
  });
}
