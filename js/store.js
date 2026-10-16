// All data lives on this device (localStorage) as one JSON document.
// Everything goes through this module, so the storage can be swapped later.

const KEY = 'vesper.v1';

function emptyState() {
  return { version: 1, projects: [], decks: [] };
}

function read() {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    const s = raw ? JSON.parse(raw) : null;
    if (s && Array.isArray(s.projects) && Array.isArray(s.decks)) return s;
  } catch (e) { /* fall through to empty state */ }
  return emptyState();
}

let state = read();

function write() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Vesper: could not save', e);
  }
}

const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);

export const store = {
  projects: () => state.projects,
  project: (id) => state.projects.find((p) => p.id === id),
  decksOf: (projectId) => state.decks.filter((d) => d.projectId === projectId),
  allDecks: () => state.decks,
  deck: (id) => state.decks.find((d) => d.id === id),

  addProject(name) {
    const p = { id: uid(), name, created: Date.now() };
    state.projects.push(p);
    write();
    return p;
  },
  removeProject(id) {
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
  removeDeck(id) {
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
    state = s;
    write();
  },
  reset() {
    state = emptyState();
    write();
  },
};
