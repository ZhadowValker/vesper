// All data lives on this device (localStorage) as one JSON document.
// Everything goes through this module, so the storage can be swapped later.

const KEY = 'vesper.v1';

function emptyState() {
  return { version: 1, projects: [], decks: [], deleted: {} };
}

function read() {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    const s = raw ? JSON.parse(raw) : null;
    if (s && Array.isArray(s.projects) && Array.isArray(s.decks)) { if (!s.deleted) s.deleted = {}; return s; }
  } catch (e) { /* fall through to empty state */ }
  return emptyState();
}

let state = read();

const listeners = [];
let quiet = false;   // true while a sync is writing, so it does not trigger another sync

function write() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Vesper: could not save', e);
  }
  if (!quiet) listeners.forEach((fn) => { try { fn(); } catch (e) { /* a listener must not break saving */ } });
}

const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);

export const store = {
  projects: () => state.projects,
  project: (id) => state.projects.find((p) => p.id === id),
  decksOf: (projectId) => state.decks.filter((d) => d.projectId === projectId),
  allDecks: () => state.decks,
  deck: (id) => state.decks.find((d) => d.id === id),

  addProject(name) {
    const p = { id: uid(), name, created: Date.now(), updated: Date.now() };
    state.projects.push(p);
    write();
    return p;
  },
  removeProject(id) {
    const now = Date.now();
    state.decks.filter((d) => d.projectId === id).forEach((d) => { state.deleted[d.id] = now; });
    state.deleted[id] = now;
    state.decks = state.decks.filter((d) => d.projectId !== id);
    state.projects = state.projects.filter((p) => p.id !== id);
    write();
  },
  addDeck(projectId, title) {
    const d = {
      id: uid(), projectId, title,
      created: Date.now(), updated: Date.now(),
      slide: 0, reached: 0,
      ticks: {}, notes: {}, selah: {},
      passes: 1, loops: 0, finished: null, timer: null,
    };
    state.decks.push(d);
    write();
    return d;
  },
  findSample: (key) => state.projects.find((p) => p.sample === key),
  // Adds a ready-made project and its tasks (see sample.js). Returns the new project.
  insertSample(built) {
    const p = { id: uid(), name: built.project.name, created: built.project.created, sample: built.sample };
    state.projects.push(p);
    built.decks.forEach((d) => state.decks.push({ ...d, id: uid(), projectId: p.id }));
    write();
    return p;
  },
  removeDeck(id) {
    state.deleted[id] = Date.now();
    state.decks = state.decks.filter((d) => d.id !== id);
    write();
  },
  save(deck) {
    deck.updated = Date.now();
    write();
  },

  exportJSON: () => JSON.stringify(state, null, 2),
  importJSON(text) {
    const s = JSON.parse(text);
    if (!s || !Array.isArray(s.projects) || !Array.isArray(s.decks)) throw new Error('This file is not a Vesper backup.');
    if (!s.deleted) s.deleted = {};
    state = s;
    write();
  },
  // Sync support: a plain copy of the data, a way to hear about changes, and a way to apply
  // merged data IN PLACE, so screens that hold a task object keep pointing at the live one.
  snapshot: () => JSON.parse(JSON.stringify(state)),
  onChange: (fn) => { listeners.push(fn); },
  applyMerged(next) {
    const sync = (list, incoming) => {
      const ids = new Set(incoming.map((x) => x.id));
      for (let i = list.length - 1; i >= 0; i--) if (!ids.has(list[i].id)) list.splice(i, 1);
      incoming.forEach((x, i) => {
        const have = list.find((y) => y.id === x.id);
        if (have) { Object.keys(have).forEach((k) => { delete have[k]; }); Object.assign(have, x); }
        else list.splice(i, 0, x);
      });
    };
    quiet = true;
    try {
      sync(state.projects, next.projects);
      sync(state.decks, next.decks);
      state.deleted = next.deleted || {};
      write();
    } finally { quiet = false; }
  },
  reset() {
    state = emptyState();
    write();
  },
};
