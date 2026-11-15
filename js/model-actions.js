import { applyActions } from './ai/apply.js';
import { reorderItems, appendOrder } from './organize.js';
import { setTaskMeta } from './task-meta.js';

export function resolveRecord(list, ref, field = 'title') {
  if (typeof ref !== 'string' || !ref.trim()) return null;
  const exact = list.find((x) => x.id === ref);
  if (exact) return exact;
  const matches = list.filter((x) => String(x[field] || '').toLowerCase() === ref.trim().toLowerCase());
  return matches.length === 1 ? matches[0] : null;
}
export function applyModelActions(actions, { db, focusId = null, by = 'ai' } = {}) {
  const changes = [], skipped = [];
  let focus = focusId;
  const area = (ref) => resolveRecord(db.areas(), ref, 'name');
  const project = (ref) => resolveRecord(db.flowProjects(), ref);
  const task = (ref) => resolveRecord(db.tasks(), ref);
  const required = (item, name) => { if (!item) throw new Error(`${name} not found or name is ambiguous.`); return item; };
  const location = (a) => {
    if ([!!a.inbox, !!a.area, !!a.project].filter(Boolean).length > 1) throw new Error('Choose exactly one location.');
    if (a.project) return { kind: 'project', id: required(project(a.project), 'Project').id };
    if (a.area) return { kind: 'area', id: required(area(a.area), 'Area').id };
    return { kind: 'inbox' };
  };
  for (const a of actions) {
    try {
      if (!a || typeof a.type !== 'string') throw new Error('An action type is required.');
      let item;
      if (a.type === 'create_area') item = db.addArea(a.name);
      else if (a.type === 'create_project') {
        if (a.mode && a.mode !== 'full') throw new Error('Quick mode was removed; create a simple Task.');
        const parent = required(area(a.area), 'Area');
        if (a.priority !== undefined || a.due !== undefined) { const error = setTaskMeta({}, a); if (error) throw new Error(error); }
        item = db.addFlowProject(parent.id, a.title);
        if (a.priority !== undefined || a.due !== undefined) {
          const error = setTaskMeta(item, a); if (error) { db.removeFlowProject(item.id); throw new Error(error); }
          db.save(item);
        }
        focus = item.id;
      } else if (a.type === 'create_task') {
        if (a.mode !== undefined) throw new Error('Tasks have no mode, slides or Selahs.');
        item = db.addTask(a.title, { location: location(a), priority: a.priority, due: a.due, note: a.note });
      } else if (a.type === 'update_task') item = db.updateTask(required(task(a.task), 'Task').id, a);
      else if (a.type === 'move_task') item = db.moveTask(required(task(a.task), 'Task').id, location(a));
      else if (a.type === 'promote_task') {
        item = db.promoteTask(required(task(a.task), 'Task').id, a.area ? required(area(a.area), 'Area').id : undefined);
        focus = item.id;
      } else if (a.type === 'demote_project') item = db.demoteProject(required(project(a.project || a.task), 'Project').id);
      else if (a.type === 'move_project') {
        item = required(project(a.project || a.task), 'Project');
        const parent = required(area(a.area), 'Area');
        item.areaId = parent.id; item.order = appendOrder(db.projectsIn(parent.id)); db.save(item);
      } else if (a.type === 'rename') {
        if ([a.area, a.project, a.task].filter(Boolean).length !== 1) throw new Error('Choose exactly one Area, Project or Task.');
        item = a.area ? required(area(a.area), 'Area') : a.project ? required(project(a.project), 'Project') : required(task(a.task) || project(a.task), 'Task or Project');
        const name = String(a.name || '').trim(); if (!name || name.length > 80) throw new Error('Name must be 1–80 characters.');
        if (a.area) item.name = name; else item.title = name;
        db.save(item);
      } else if (a.type === 'reorder') {
        const list = a.kind === 'areas' ? db.areas() : a.kind === 'projects' ? db.projectsIn(required(area(a.area), 'Area').id) :
          a.kind === 'tasks' ? (() => { const place = location(a); return db.tasksAt(place.kind, place.id); })() : null;
        if (!list) throw new Error('kind must be areas, projects or tasks.');
        const error = reorderItems(list, a); if (error) throw new Error(error);
        db.saveItems(list, a.kind); changes.push({ text: `Reordered ${a.kind}` }); continue;
      } else if (a.type === 'delete_task' || a.type === 'delete_area' || a.type === 'delete_project') {
        if (a.confirm !== true) throw new Error('Deletion needs confirm:true.');
        item = a.type === 'delete_task' ? required(task(a.task), 'Task') : a.type === 'delete_area' ? required(area(a.area), 'Area') : required(project(a.project || a.task), 'Project');
        if (a.type === 'delete_task') db.removeTask(item.id);
        else if (a.type === 'delete_area') db.removeArea(item.id);
        else db.removeFlowProject(item.id);
      } else {
        const p = required(project(a.project || a.task || focus), 'Project');
        const legacy = { ...a, task: p.id };
        if (a.type === 'set_project') legacy.type = 'set_task';
        const result = applyActions([legacy], { db, focusId: p.id, by });
        changes.push(...result.changes); skipped.push(...result.skipped); focus = result.focusId || p.id;
        continue;
      }
      changes.push({ text: `${a.type.replaceAll('_', ' ')}: ${item.title || item.name}`, id: item.id, href: item.areaId ? `#/d/${item.id}` : '#/' });
    } catch (error) { skipped.push(error.message); }
  }
  return { changes, skipped, focusId: focus, touched: [] };
}
