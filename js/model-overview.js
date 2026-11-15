import { orderedItems } from './organize.js';
import { validDue, PRIORITIES } from './task-meta.js';
import { slideFor } from './framework.js';
import { taskCheck } from './task-status.js';
import { progress } from './ai/steps.js';
import { resolveRecord } from './model-actions.js';

export function modelOverview(state, filters = {}) {
  if (filters.kind && !['project', 'task'].includes(filters.kind)) throw new Error('kind must be project or task.');
  if (filters.stage && !['vision', 'research', 'plan', 'execute', 'review'].includes(filters.stage)) throw new Error('Unknown stage.');
  if (filters.priority && !['none', ...PRIORITIES].includes(filters.priority)) throw new Error('Invalid priority.');
  if (filters.status && !['active', 'finished', 'not started'].includes(filters.status)) throw new Error('Invalid status.');
  if (filters.dueBefore && !validDue(filters.dueBefore)) throw new Error('dueBefore must be a calendar date.');
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
    if (filters.stage && stage !== filters.stage) continue;
    if (filters.status === 'finished' && !finished || filters.status === 'active' && (finished || !started) || filters.status === 'not started' && (finished || started)) continue;
    if (filters.priority && (filters.priority === 'none' ? !!item.priority : item.priority !== filters.priority)) continue;
    if (filters.dueBefore && !(item.due && item.due < filters.dueBefore)) continue;
    if (query && ![item.title, areaName, containing?.title].filter(Boolean).join(' ').toLowerCase().includes(query)) continue;
    const pr = kind === 'project' ? progress(item) : null;
    rows.push({ id: item.id, kind, title: item.title, areaId: areaId || null, area: areaName || null,
      project: containing?.title || null, stage: stage || null, priority: item.priority || null, due: item.due || null,
      status: finished ? 'finished' : started ? 'active' : 'not started',
      ...(pr ? { stepsFilled: `${pr.filled}/${pr.total}`, ...(taskCheck(item) ? { check: taskCheck(item) } : {}) } : { done: !!item.done, note: item.note || '', location: item.location }) });
    if (rows.length === limit) return rows;
  }
  return rows;
}
