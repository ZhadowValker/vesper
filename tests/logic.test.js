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
  assert.ok(projectMap(p, []).includes('No tasks yet'));
});

test('mind map escapes html in titles', () => {
  const d = store.addDeck(store.projects()[0].id, '<img src=x onerror=alert(1)>');
  assert.ok(!deckMap(d).includes('<img'));
});

test('first slide of each stage is its first sub-stage', () => {
  for (const st of STAGES) assert.equal(SLIDES[firstSlideOf(st.id)].sub.id, st.subs[0].id);
});


const { buildSample, BOOK_SAMPLE } = await import('../js/sample.js');
const built = buildSample();
const [tDefine, tPart1, tEdit, tLaunch] = built.decks;

test('book sample: every note key points at a real slide and step', () => {
  for (const d of built.decks) {
    for (const key of Object.keys(d.notes)) {
      const [base, n] = key.split('#');
      const slide = SLIDES[fw.slideIndex(base)];
      assert.ok(slide && slide.type === 'sub', `${d.title}: no slide for ${key}`);
      if (n !== undefined) assert.ok(Number(n) < slide.sub.steps.length, `${d.title}: ${key} is past the last step`);
      assert.ok(d.notes[key].trim().length > 0);
    }
  }
});

test('book sample: the finished task has every tick, every step note and every slide note', () => {
  let steps = 0;
  for (const st of STAGES) for (const sub of st.subs) {
    assert.ok((tDefine.notes[`${st.id}.${sub.id}`] || '').length > 0, `slide note missing for ${st.id}.${sub.id}`);
    sub.steps.forEach((_, i) => {
      steps++;
      assert.equal(tDefine.ticks[tickKey(st, sub, i)], true);
      assert.ok((tDefine.notes[`${st.id}.${sub.id}#${i}`] || '').length > 0, `step note missing for ${st.id}.${sub.id}#${i}`);
    });
    assert.equal(tDefine.selah[st.id], true);
  }
  assert.equal(steps, 34);
  assert.equal(deckStatus(tDefine).label, 'Finished');
  assert.equal(tDefine.loops, 1);
});

test('book sample: the other tasks sit in different states', () => {
  assert.equal(deckStatus(tPart1).label, 'Execute');
  assert.deepEqual(STAGES.map((s) => stageState(tPart1, s)), ['done', 'done', 'done', 'now', 'todo']);
  assert.equal(atSelah(tEdit), true);
  assert.equal(fw.stagePending(tEdit, STAGES[2]), 1);
  assert.equal(deckStatus(tLaunch).label, 'Vision');
  assert.equal(deckStatus(tLaunch).state, 'now');
});

test('book sample: inserting adds the project once and its tasks open in the maps', () => {
  const p = store.insertSample(built);
  assert.equal(store.findSample('book').id, p.id);
  assert.equal(store.decksOf(p.id).length, 4);
  const decks = store.decksOf(p.id);
  assert.equal((projectMap(p, decks).match(/href="#\/d\//g) || []).length, 4);
  assert.equal((deckMap(decks[1]).match(/href="#\/d\/\w+\/s\/\d+"/g) || []).length, 30);
  assert.equal(BOOK_SAMPLE.tasks.length, 4);
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


const { extractJSON, cleanReply } = await import('../js/ai/client.js');
const { contextBefore, draftMessages, reviewMessages, validDraft, validReview } = await import('../js/ai/prompts.js');

test('AI: JSON is pulled out of fences, text and reasoning tags', () => {
  assert.deepEqual(extractJSON('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJSON('<think>hmm {x}</think>Sure: {"steps":["a","b"]} done'), { steps: ['a', 'b'] });
  assert.throws(() => extractJSON('no json here'));
  assert.equal(cleanReply('<think>x</think> hi'), 'hi');
});

test('AI: prompts carry earlier answers and exact step counts', () => {
  store.reset && store.reset();
  const p = store.addProject('AI test');
  const d = store.addDeck(p.id, 'Write intro');
  const why = SLIDES.find((s) => s.key === 'vision.why');
  d.notes['vision.why#1'] = 'Because readers need a hook';
  const goal = SLIDES.find((s) => s.key === 'vision.goal');
  const msgs = draftMessages(d, p, goal);
  assert.match(msgs[1].content, /Because readers need a hook/);
  assert.match(msgs[1].content, /exactly 2 strings/);
  assert.equal(contextBefore(d, 0), '(nothing written yet)');
  const rv = reviewMessages(d, p, STAGES[0]);
  assert.match(rv[1].content, /Can I say it in two sentences\?/);
  assert.match(rv[1].content, /\(empty\)/);
});

test('AI: replies are validated before they are shown', () => {
  assert.ok(validDraft({ steps: ['a', 'b'] }, 2));
  assert.ok(!validDraft({ steps: ['a'] }, 2));
  assert.ok(!validDraft({ steps: ['a', 3] }, 2));
  assert.ok(validReview({ verdict: 'almost', summary: 'x', gaps: [] }));
  assert.ok(!validReview({ verdict: 'great', summary: 'x', gaps: [] }));
});

console.log(`\n${passed} tests passed`);
