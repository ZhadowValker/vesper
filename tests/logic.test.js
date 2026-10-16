// Plain Node test for the framework data, store and mind map generators. Run: node tests/logic.test.js
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
};

const fw = await import('../js/framework.js');
const { store } = await import('../js/store.js');
const { projectMap, deckMap } = await import('../js/mindmaps.js');

const { STAGES, SLIDES, tickKey, subDone, stageState, chipState, deckStatus, atSelah, firstSlideOf, selahIndex } = fw;
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok', name); };

test('framework has 5 stages, 20 sub-stages, 34 steps', () => {
  assert.equal(STAGES.length, 5);
  assert.equal(STAGES.reduce((n, s) => n + s.subs.length, 0), 20);
  assert.equal(STAGES.reduce((n, s) => n + s.subs.reduce((m, x) => m + x.steps.length, 0), 0), 34);
});

test('deck has 27 slides with unique keys, cover first and recap last', () => {
  assert.equal(SLIDES.length, 27);
  assert.equal(new Set(SLIDES.map((s) => s.key)).size, 27);
  assert.equal(SLIDES[0].type, 'cover');
  assert.equal(SLIDES.at(-1).type, 'recap');
});

test('every stage ends with a Selah slide', () => {
  for (const st of STAGES) assert.equal(SLIDES[selahIndex(st.id)].type, 'selah');
});

test('new deck starts not started', () => {
  const p = store.addProject('Office relocation');
  const d = store.addDeck(p.id, 'Plan the move');
  const s = deckStatus(d);
  assert.equal(s.label, 'Not started');
  assert.equal(s.pct, 0);
  assert.equal(stageState(d, STAGES[0]), 'todo');
});

test('ticking all steps marks a sub-stage done and the chip done', () => {
  const p = store.projects()[0];
  const d = store.decksOf(p.id)[0];
  const stage = STAGES[0];
  const why = stage.subs[0];
  why.steps.forEach((_, i) => { d.ticks[tickKey(stage, why, i)] = true; });
  assert.equal(subDone(d, stage, why), true);
  const idx = fw.slideIndex('vision.why');
  assert.equal(chipState(d, SLIDES[idx], idx), 'done');
});

test('stage turns done only after all sub-stages and Selah are complete', () => {
  const p = store.projects()[0];
  const d = store.decksOf(p.id)[0];
  const stage = STAGES[0];
  for (const sub of stage.subs) sub.steps.forEach((_, i) => { d.ticks[tickKey(stage, sub, i)] = true; });
  assert.notEqual(stageState(d, stage), 'done');
  d.selah[stage.id] = true;
  assert.equal(stageState(d, stage), 'done');
});

test('atSelah is true only on an unanswered Selah slide', () => {
  const p = store.projects()[0];
  const d = store.decksOf(p.id)[0];
  d.slide = selahIndex('research');
  d.reached = d.slide;
  assert.equal(atSelah(d), true);
  d.selah.research = true;
  assert.equal(atSelah(d), false);
  assert.equal(deckStatus(d).label, 'Research');
});

test('finished decks report 100 percent', () => {
  const d = store.addDeck(store.projects()[0].id, 'Hire movers');
  d.finished = Date.now();
  assert.deepEqual([deckStatus(d).label, deckStatus(d).pct], ['Finished', 100]);
});

test('mind maps render svg with links for every deck and slide chip', () => {
  const p = store.projects()[0];
  const decks = store.decksOf(p.id);
  const pm = projectMap(p, decks);
  assert.ok(pm.startsWith('<div class="dt"'));
  assert.equal((pm.match(/href="#\/d\//g) || []).length, decks.length);
  const dm = deckMap(decks[0]);
  assert.ok(dm.startsWith('<div class="dt"'));
  assert.ok(dm.includes('>Why<') && dm.includes('>Findings<') && dm.includes('Selah'));
  assert.equal((dm.match(/href="#\/d\/\w+\/s\/\d+"/g) || []).length, 5 + 25);
  assert.ok(projectMap(p, []).includes('No decks yet'));
});

test('mind map escapes html in titles', () => {
  const d = store.addDeck(store.projects()[0].id, '<img src=x onerror=alert(1)>');
  assert.ok(!deckMap(d).includes('<img'));
});

test('first slide of each stage is its first sub-stage', () => {
  for (const st of STAGES) assert.equal(SLIDES[firstSlideOf(st.id)].sub.id, st.subs[0].id);
});

test('export then import round-trips', () => {
  const json = store.exportJSON();
  const before = store.allDecks().length;
  store.reset();
  assert.equal(store.allDecks().length, 0);
  store.importJSON(json);
  assert.equal(store.allDecks().length, before);
  assert.throws(() => store.importJSON('{"nope":1}'));
});

console.log(`\n${passed} tests passed`);
