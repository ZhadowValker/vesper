import { orderedItems } from './organize.js';
import { validDue, PRIORITIES, WORK_STATUSES, workStatus } from './task-meta.js';
import { slideFor, STAGES } from './framework.js';
import { taskCheck } from './task-status.js';
import { progress } from './ai/steps.js';
import { resolveRecord } from './model-actions.js';

const plusDays = (day, n) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const SORTS = ['order', 'priority', 'due', 'updated'];

// today (YYYY-MM-DD) decides overdue/dueSoon; the hub passes the person's local date.
export function modelOverview(state, filters = {}, { today = new Date().toISOString().slice(0, 10) } = {}) {
  if (filters.kind && !['project', 'task'].includes(filters.kind)) throw new Error('kind must be project or task.');
  // Stage ids and names match case-insensitively, like vesper_loop_back.
  const stageRef = filters.stage === undefined || filters.stage === null || filters.stage === '' ? null : String(filters.stage).trim().toLowerCase();
  const stageMatch = stageRef === null ? null : STAGES.find((st) => st.id === stageRef || st.name.toLowerCase() === stageRef);
  if (stageRef !== null && !stageMatch) throw new Error('Unknown stage.');
  if (filters.priority && !['none', ...PRIORITIES].includes(filters.priority)) throw new Error('Invalid priority.');
  if (filters.status && !['active', 'finished', 'not started'].includes(filters.status)) throw new Error('Invalid status.');
  if (filters.dueBefore && !validDue(filters.dueBefore)) throw new Error('dueBefore must be a calendar date.');
  if (filters.workStatus && !WORK_STATUSES.includes(filters.workStatus)) throw new Error(`workStatus must be one of ${WORK_STATUSES.join(', ')}.`);
  if (filters.sort && !SORTS.includes(filters.sort)) throw new Error(`sort must be one of ${SORTS.join(', ')}.`);
  if (filters.overdue !== undefined && typeof filters.overdue !== 'boolean') throw new Error('overdue must be true or false.');
  if (filters.dueSoon !== undefined && !(Number.isInteger(filters.dueSoon) && filters.dueSoon >= 0 && filters.dueSoon <= 365)) throw new Error('dueSoon must be a number of days from 0 to 365.');
  const soonUntil = filters.dueSoon !== undefined ? plusDays(today, filters.dueSoon) : null;
  const area = filters.area ? resolveRecord(state.areas, filters.area, 'name') : null;
  const parent = filters.project ? resolveRecord(state.projects, filters.project) : null;
  if ((filters.area && !area) || (filters.project && !parent)) return [];
  const query = String(filters.query || '').trim().toLowerCase();
  const limit = filters.limit === undefined ? 25 : Number(filters.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('limit must be 1–1000.');
  const rows = [];
  for (const kind of ['project', 'task']) for (const item of orderedItems(kind === 'project' ? state.projects : state.tasks.filter((t) => !t.promotedTo))) {
    if (filters.kind && filters.kind !== kind) continue;
    if (filters.inbox && (kind !== 'task' || item.location?.kind !== 'inbox')) continue;
    const containing = kind === 'task' && item.location?.kind === 'project' ? state.projects.find((p) => p.id === item.location.id) : null;
    const areaId = kind === 'project' ? item.areaId : item.location?.kind === 'area' ? item.location.id : containing?.areaId;
    const areaName = state.areas.find((a) => a.id === areaId)?.name || '';
    const stage = kind === 'project' ? slideFor(item)?.stage?.id || '' : '';
    const finished = kind === 'project' ? !!item.finished : !!item.done;
    const started = kind === 'project' ? !!item.reached : true;
    if (area && area.id !== areaId) continue;
    if (parent && !(kind === 'project' ? item.id === parent.id : containing?.id === parent.id)) continue;
    if (stageMatch && stage !== stageMatch.id) continue;
    if (filters.status === 'finished' && !finished || filters.status === 'active' && (finished || !started) || filters.status === 'not started' && (finished || started)) continue;
    if (filters.priority && (filters.priority === 'none' ? !!item.priority : item.priority !== filters.priority)) continue;
    if (filters.dueBefore && !(item.due && item.due < filters.dueBefore)) continue;
    const ws = workStatus(item);
    const overdue = ws !== 'finished' && validDue(item.due) && item.due < today;
    if (filters.workStatus && ws !== filters.workStatus) continue;
    if (filters.overdue === true && !overdue || filters.overdue === false && overdue) continue;
    if (soonUntil && !(ws !== 'finished' && validDue(item.due) && item.due >= today && item.due <= soonUntil)) continue;
    if (query && ![item.title, areaName, containing?.title].filter(Boolean).join(' ').toLowerCase().includes(query)) continue;
    const pr = kind === 'project' ? progress(item) : null;
    rows.push({ id: item.id, kind, title: item.title, areaId: areaId || null, area: areaName || null,
      project: containing?.title || null, stage: stage || null, priority: item.priority || null, due: item.due || null,
      status: finished ? 'finished' : started ? 'active' : 'not started',
      workStatus: ws, parked: item.parked === true, ...(overdue ? { overdue: true } : {}),
      updated: item.updated ? new Date(item.updated).toISOString() : null,
      ...(pr ? { stepsFilled: `${pr.filled}/${pr.total}`, ...(taskCheck(item) ? { check: taskCheck(item) } : {}) } : { done: !!item.done, note: item.note || '', location: item.location }) });
    if (rows.length === limit && (!filters.sort || filters.sort === 'order')) return rows;
  }
  if (!filters.sort || filters.sort === 'order') return rows;
  const rank = (r) => PRIORITIES.includes(r.priority) ? PRIORITIES.indexOf(r.priority) : 4;
  const due = (r) => validDue(r.due) ? r.due : '9999-99-99';
  const by = { priority: (a, b) => rank(a) - rank(b) || due(a).localeCompare(due(b)),
    due: (a, b) => due(a).localeCompare(due(b)) || rank(a) - rank(b),
    updated: (a, b) => String(b.updated || '').localeCompare(String(a.updated || '')) }[filters.sort];
  return rows.map((r, i) => [r, i]).sort(([a, i], [b, j]) => by(a, b) || i - j).map(([r]) => r).slice(0, limit);
}
