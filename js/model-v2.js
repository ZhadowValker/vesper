import { stampDeck } from './merge.js';
import { appendOrder } from './organize.js';
import { setTaskMeta } from './task-meta.js';

export const emptyV2 = () => ({ version: 2, areas: [], projects: [], tasks: [], deleted: {} });
export const isV1 = (s) => !!s && s.version !== 2 && Array.isArray(s.projects) && Array.isArray(s.decks);
export function flowAliases(project) {
  // parked is an optional boolean. Absence stays absent in old v2 notebooks.
  if (!Object.hasOwn(project, 'projectId')) Object.defineProperty(project, 'projectId', {
    configurable: true, get() { return this.areaId; }, set(id) { this.areaId = id; },
  });
  return project;
}
export function normalizeV2(input) {
  if (!input) return emptyV2();
  if (input.version && ![1, 2].includes(input.version)) throw new Error('Unsupported Vesper backup version.');
  if (input.version === 2) {
    if (!['areas', 'projects', 'tasks'].every((k) => Array.isArray(input[k]))) throw new Error('Invalid version 2 Vesper backup.');
    const s = structuredClone(input);
    s.deleted ||= {};
    s.projects.forEach((p) => { p.mode = 'full'; flowAliases(p); });
    return s;
  }
  if (!isV1(input)) throw new Error('This file is not a Vesper backup.');
  const s = emptyV2();
  s.areas = structuredClone(input.projects);
  s.deleted = structuredClone(input.deleted || {});
  s.projects = input.decks.map((old) => {
    const p = structuredClone(old);
    p.areaId = p.projectId; delete p.projectId;
    // Preserve the original cursor coordinates and all Quick notes.
    p.mode = 'full';
    if (p._changed?.fields) {
      p._changed.fields.areaId = p._changed.fields.projectId ?? p.updated ?? p.created ?? 0;
      p._changed.fields.mode = Math.max(p._changed.fields.mode || 0, p.updated || p.created || 0);
    }
    return flowAliases(p);
  });
  return s;
}
export function legacyV1(input) {
  const s = normalizeV2(input);
  return { version: 1, projects: s.areas, decks: s.projects.map((p) => {
    const d = { ...p, projectId: p.areaId, mode: p.mode || 'full' }; delete d.areaId; return d;
  }), deleted: s.deleted };
}
export const taskAt = (task, kind, id) => !task.promotedTo && task.location?.kind === kind && (kind === 'inbox' || task.location.id === id);
export function validateLocation(s, location) {
  if (!location || !['inbox', 'area', 'project'].includes(location.kind)) throw new Error('Choose Inbox, an Area or a Project.');
  if (location.kind === 'area' && !s.areas.some((a) => a.id === location.id)) throw new Error('Area not found.');
  if (location.kind === 'project' && !s.projects.some((p) => p.id === location.id)) throw new Error('Project not found.');
  return location.kind === 'inbox' ? { kind: 'inbox' } : { kind: location.kind, id: location.id };
}
export function createModelDb(s, persist = () => {}) {
  const copies = new Map();
  const remember = () => { for (const x of [...s.areas, ...s.projects, ...s.tasks]) copies.set(x.id, structuredClone(x)); };
  remember();
  const changed = () => { persist(); remember(); };
  const id = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const title = (text) => { if (typeof text !== 'string' || !text.trim()) throw new Error('A name or title is required.'); return text.trim().slice(0, 200); };
  const db = {
    snapshot: () => normalizeV2(s),
    areas: () => s.areas, area: (ref) => s.areas.find((a) => a.id === ref),
    flowProjects: () => s.projects, flowProject: (ref) => s.projects.find((p) => p.id === ref),
    projectsIn: (areaId) => s.projects.filter((p) => p.areaId === areaId),
    tasks: () => s.tasks.filter((t) => !t.promotedTo), task: (ref) => s.tasks.find((t) => t.id === ref),
    tasksAt: (kind = 'inbox', ref) => s.tasks.filter((t) => taskAt(t, kind, ref)),
    addArea(name) {
      const a = { id: id(), name: title(name), order: appendOrder(s.areas), created: Date.now(), updated: Date.now() };
      s.areas.push(a); changed(); return a;
    },
    addFlowProject(areaId, text, mode = 'full', fixedId) {
      if (!db.area(areaId)) throw new Error('Choose an Area for the Project.');
      if (mode !== 'full') throw new Error('Quick mode was removed. Create a simple Task instead.');
      const p = flowAliases({ id: fixedId || id(), areaId, title: title(text), mode,
        order: appendOrder(db.projectsIn(areaId)), created: Date.now(), updated: Date.now(),
        slide: 0, reached: 0, notes: {}, ticks: {}, selah: {}, passes: 1, loops: 0, finished: null, timer: null });
      s.projects.push(p); changed(); return p;
    },
    addTask(text, { location = { kind: 'inbox' }, priority, due, note = '' } = {}) {
      location = validateLocation(s, location);
      const t = { id: id(), title: title(text), location, done: false, note: String(note).slice(0, 2000),
        order: appendOrder(db.tasksAt(location.kind, location.id)), created: Date.now(), updated: Date.now() };
      if (priority !== undefined || due !== undefined) {
        const error = setTaskMeta(t, { ...(priority !== undefined ? { priority } : {}), ...(due !== undefined ? { due } : {}) });
        if (error) throw new Error(error);
      }
      s.tasks.push(t); changed(); return t;
    },
    updateTask(ref, patch) {
      const t = db.task(ref); if (!t || t.promotedTo) throw new Error('Task not found.');
      const next = { ...t };
      if (Object.hasOwn(patch, 'title')) next.title = title(patch.title);
      if (Object.hasOwn(patch, 'done')) { if (typeof patch.done !== 'boolean') throw new Error('done must be true or false.'); next.done = patch.done; }
      if (Object.hasOwn(patch, 'note')) { if (typeof patch.note !== 'string') throw new Error('Note must be text.'); next.note = patch.note.slice(0, 2000); }
      if (Object.hasOwn(patch, 'priority') || Object.hasOwn(patch, 'due')) {
        const error = setTaskMeta(next, patch); if (error) throw new Error(error);
      }
      Object.assign(t, next); db.save(t); return t;
    },
    moveTask(ref, location) {
      const t = db.task(ref); if (!t || t.promotedTo) throw new Error('Task not found.');
      t.location = validateLocation(s, location); t.order = appendOrder(db.tasksAt(t.location.kind, t.location.id)); db.save(t); return t;
    },
    promoteTask(ref, areaId) {
      const t = db.task(ref); if (!t) throw new Error('Task not found.');
      if (t.promotedTo) return db.flowProject(t.promotedTo);
      if (t.done) throw new Error('A done task cannot be promoted.');
      const parentArea = t.location.kind === 'area' ? t.location.id : t.location.kind === 'project' ? db.flowProject(t.location.id)?.areaId : areaId;
      if (!db.area(parentArea)) throw new Error('Choose an Area for this Inbox task.');
      const p = db.addFlowProject(parentArea, t.title, 'full', 'project-' + t.id);
      p.priority = t.priority ?? null; p.due = t.due ?? null; p.promotedFrom = t.id;
      if (t.note) p.notes['vision.why#0'] = t.note;
      t.promotedTo = p.id; db.save(t); db.save(p); return p;
    },
    demoteProject(ref) {
      const p = db.flowProject(ref); if (!p) throw new Error('Project not found.');
      if (Object.values(p.notes || {}).some((n) => String(n).trim()) || Object.values(p.ticks || {}).some(Boolean) ||
          Object.values(p.selah || {}).some(Boolean) || Object.values(p.selahBy || {}).some(Boolean)) throw new Error('Only a Project with no notes, ticks or passed Selahs can become a Task.');
      const t = db.addTask(p.title, { location: { kind: 'area', id: p.areaId }, priority: p.priority ?? null, due: p.due ?? null });
      t.demotedFrom = p.id; p.demotedTo = t.id; db.save(t);
      for (const child of db.tasksAt('project', p.id)) db.moveTask(child.id, { kind: 'area', id: p.areaId });
      db.removeFlowProject(p.id); return t;
    },
    removeTask(ref) { s.deleted[ref] = Date.now(); s.tasks = s.tasks.filter((t) => t.id !== ref); changed(); },
    removeFlowProject(ref) {
      for (const t of db.tasksAt('project', ref)) db.moveTask(t.id, { kind: 'inbox' });
      s.deleted[ref] = Date.now(); s.projects = s.projects.filter((p) => p.id !== ref); changed();
    },
    removeArea(ref) {
      for (const p of db.projectsIn(ref)) db.removeFlowProject(p.id);
      for (const t of db.tasksAt('area', ref)) db.moveTask(t.id, { kind: 'inbox' });
      s.deleted[ref] = Date.now(); s.areas = s.areas.filter((a) => a.id !== ref); changed();
    },
    save(item) { stampDeck(item, copies.get(item.id)); changed(); },
    saveProject(item) { db.save(item); },
    saveItems(items) { for (const item of items) stampDeck(item, copies.get(item.id)); changed(); },
  };
  // Temporary internal aliases keep existing routes/flow components stable.
  db.projects = db.areas; db.project = db.area; db.decksOf = db.projectsIn;
  db.allDecks = db.flowProjects; db.deck = db.flowProject;
  db.addProject = db.addArea; db.addDeck = db.addFlowProject;
  db.removeDeck = db.removeFlowProject; db.removeProject = db.removeArea;
  return db;
}
