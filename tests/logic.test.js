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


const { applyActions, parseTurn, buildMessages, stateText } = await import('../js/ai/agent.js');

test('Bot: reads JSON replies, and falls back to plain text', () => {
  const a = parseTurn('<think>x</think>```json\n{"reply":"Hi","actions":[{"type":"focus","task":"t"}]}\n```');
  assert.equal(a.reply, 'Hi'); assert.equal(a.actions.length, 1);
  const b = parseTurn('Just some words, no JSON.');
  assert.equal(b.reply, 'Just some words, no JSON.'); assert.deepEqual(b.actions, []);
});

test('Bot: creates a project and task, fills and ticks steps, moves the task forward', () => {
  store.reset();
  const out = applyActions([
    { type: 'create_project', name: 'Garden' },
    { type: 'create_task', project: 'Garden', title: 'Build raised beds' },
    { type: 'set_note', task: 'Build raised beds', slide: 'vision.why', step: 1, text: 'I want fresh vegetables' },
    { type: 'set_note', task: 'Build raised beds', slide: 'vision.goal', step: 0, text: 'Two beds full of plants', tick: false },
    { type: 'set_note', task: 'Build raised beds', slide: 'vision.limits', text: 'No irrigation system' },
  ]);
  const d = store.allDecks()[0];
  assert.equal(store.projects().length, 1);
  assert.equal(d.title, 'Build raised beds');
  assert.equal(d.notes['vision.why#1'], 'I want fresh vegetables');
  assert.equal(d.ticks['vision.why:1'], true);
  assert.ok(!d.ticks['vision.goal:0']);
  assert.equal(d.notes['vision.limits'], 'No irrigation system');
  assert.equal(d.slide, fw.slideIndex('vision.limits'));
  assert.equal(out.focus, d.id);
  assert.equal(out.changes.length, 5);
  assert.equal(out.skipped.length, 0);
});

test('Bot: never passes a Selah, never moves past an unpassed one', () => {
  const d = store.allDecks()[0];
  applyActions([{ type: 'set_note', task: d.id, slide: 'plan.map', step: 0, text: 'Buy wood' }]);
  assert.equal(d.notes['plan.map#0'], 'Buy wood');
  assert.equal(d.slide, fw.selahIndex('vision'));   // held at the first unpassed Selah
  assert.ok(!d.selah.vision);
  const r = applyActions([{ type: 'selah', task: d.id, stage: 'vision' }, { type: 'delete_task', task: d.id }]);
  assert.equal(r.skipped.length, 2);
  assert.equal(store.allDecks().length, 1);
});

test('Bot: keeps what the person wrote, validates slides and steps', () => {
  const d = store.allDecks()[0];
  applyActions([{ type: 'set_note', task: d.id, slide: 'vision.why', step: 1, text: 'And it saves money' }]);
  assert.equal(d.notes['vision.why#1'], 'I want fresh vegetables\nAnd it saves money');
  applyActions([{ type: 'set_note', task: d.id, slide: 'vision.why', step: 1, text: 'And it saves money' }]);
  assert.equal(d.notes['vision.why#1'], 'I want fresh vegetables\nAnd it saves money');
  applyActions([{ type: 'set_note', task: d.id, slide: 'vision.why', step: 1, text: 'Only this', mode: 'replace' }]);
  assert.equal(d.notes['vision.why#1'], 'Only this');
  const r = applyActions([
    { type: 'set_note', task: d.id, slide: 'vision.nope', step: 0, text: 'x' },
    { type: 'set_note', task: d.id, slide: 'vision.why', step: 9, text: 'x' },
    { type: 'set_note', task: d.id, slide: 'vision.selah', text: 'x' },
    { type: 'set_note', task: 'ghost', slide: 'vision.why', step: 0, text: 'x' },
    { type: 'set_note', task: d.id, slide: 'vision.why', step: 0, text: '   ' },
  ]);
  assert.equal(r.skipped.length, 5); assert.equal(r.changes.length, 0);
});

test('Bot: the prompt knows the framework and the current task', () => {
  const d = store.allDecks()[0];
  const m = buildMessages([{ r: 'u', t: 'hi' }, { r: 'b', t: 'Hello' }], 'next?', d.id);
  assert.equal(m[0].role, 'system'); assert.match(m[0].content, /vision\.why/); assert.match(m[0].content, /Build raised beds/);
  assert.equal(m.length, 4); assert.equal(m[3].content, 'next?');
  assert.match(stateText(d.id), /vision\.why: \[0\]/);
});

test('Bot: undo works by restoring the saved state', () => {
  store.reset();
  const before = store.exportJSON();
  applyActions([{ type: 'create_project', name: 'X' }]);
  const after = store.exportJSON();
  assert.notEqual(before, after);
  store.importJSON(before);
  assert.equal(store.projects().length, 0);
});


const iv = await import('../js/ai/interview.js');
const { QUESTIONS } = await import('../js/ai/questions.js');

test('Interview: every one of the 34 steps has a question, in framework order', () => {
  const steps = iv.allSteps();
  assert.equal(steps.length, 34);
  assert.ok(steps.every((s) => typeof s.question === 'string' && s.question.length > 10));
  assert.equal(Object.keys(QUESTIONS).length, 34);
  assert.equal(steps[0].key, 'vision.why#0');
  assert.equal(steps[33].key, 'review.done#0');
});

test('Interview: asks the first empty step, skips filled and skipped ones', () => {
  store.reset();
  const p = store.addProject('Trip'); const d = store.addDeck(p.id, 'Plan Goa trip');
  assert.equal(iv.emptySteps(d)[0].key, 'vision.why#0');
  d.notes['vision.why#0'] = 'Need a break';
  assert.equal(iv.emptySteps(d)[0].key, 'vision.why#1');
  assert.equal(iv.emptySteps(d, ['vision.why#1'])[0].key, 'vision.goal#0');
  assert.deepEqual(iv.progress(d), { filled: 1, total: 34 });
  const q = iv.nextQuestion(d, [], null);
  assert.equal(q.target.key, 'vision.why#1'); assert.match(q.text, /Vision › Why/);
});

test('Interview: AI notes fill the asked step and extra empty steps, nothing else', () => {
  const d = store.allDecks()[0];
  const target = iv.emptySteps(d)[0];                      // vision.why#1
  const reply = { ack: 'Got it.', notes: [
    { slide: 'vision.why', step: 1, text: 'I am burnt out and need rest.' },
    { slide: 'vision.goal', step: 0, text: 'Me on a beach, phone off.' },
    { slide: 'vision.why', step: 0, text: 'OVERWRITE ATTEMPT' },      // already filled: ignored
    { slide: 'plan.map', step: 0, text: 'x' },                          // empty but allowed? yes it is empty
  ] };
  const r = iv.saveAnswer(d, target, 'burnt out', reply);
  assert.equal(d.notes['vision.why#1'], 'I am burnt out and need rest.');
  assert.equal(d.notes['vision.goal#0'], 'Me on a beach, phone off.');
  assert.equal(d.notes['vision.why#0'], 'Need a break');
  assert.equal(r.fallback, false); assert.equal(r.ack, 'Got it.');
});

test('Interview: if the AI gives nothing, the person\'s own words are saved', () => {
  const d = store.allDecks()[0];
  const target = iv.emptySteps(d)[0];                      // vision.goal#1
  const r = iv.saveAnswer(d, target, 'A relaxed week by the sea', null);
  assert.equal(d.notes[target.key], 'A relaxed week by the sea');
  assert.equal(r.fallback, true);
  const r2 = iv.saveAnswer(d, iv.emptySteps(d)[0], 'my words', { ack: '', notes: [{ slide: 'nope', step: 0, text: 'bad' }] });
  assert.equal(r2.fallback, true);
});

test('Interview: finishing a stage reminds about Selah but never passes it', () => {
  const d = store.allDecks()[0];
  const stepsV = iv.allSteps().filter((s) => s.slide.stage.id === 'vision');
  stepsV.forEach((s) => { d.notes[s.key] = d.notes[s.key] || 'x'; });
  const prev = stepsV[stepsV.length - 1];
  const q = iv.nextQuestion(d, [], prev);
  assert.match(q.text, /Vision\*\* is filled in/); assert.match(q.text, /Can I say it in two sentences/);
  assert.equal(q.links[0].href, `#/d/${d.id}/s/${fw.selahIndex('vision')}`);
  assert.ok(!d.selah.vision);
  assert.equal(q.target.slide.stage.id, 'research');
});

test('Interview: skip and stop are understood without the AI; everything fills to the end', () => {
  assert.equal(iv.intentOf('Skip.'), 'skip'); assert.equal(iv.intentOf("don't know"), 'skip');
  assert.equal(iv.intentOf('stop'), 'stop'); assert.equal(iv.intentOf('my skip plan'), null);
  const d = store.allDecks()[0];
  let n = 0, prev = null;
  while (n++ < 40) { const q = iv.nextQuestion(d, [], prev); if (!q.target) break; iv.saveAnswer(d, q.target, `a${n}`, null); prev = q.target; }
  assert.deepEqual(iv.progress(d), { filled: 34, total: 34 });
  assert.equal(iv.nextQuestion(d, [], prev).target, null);
});


// ---- merge and sync ----
import { mergeStates, sameState, emptyState } from '../js/merge.js';
test('merge: newest wins, deletions stick, orphans dropped', () => {
  const p = { id: 'p', name: 'P', created: 1, updated: 1 };
  const d = (t, u) => ({ id: 'd', projectId: 'p', title: t, updated: u, created: 1, notes: {}, ticks: {}, selah: {} });
  const a = { ...emptyState(), projects: [p], decks: [d('new', 9)] };
  const b = { ...emptyState(), projects: [p], decks: [d('old', 3)] };
  assert.equal(mergeStates(a, b).decks[0].title, 'new');
  assert.equal(mergeStates(b, a).decks[0].title, 'new');
  const gone = { ...emptyState(), projects: [p], decks: [], deleted: { d: 20 } };
  assert.equal(mergeStates(a, gone).decks.length, 0);
  const noProject = { ...emptyState(), projects: [], decks: [d('x', 5)], deleted: {} };
  assert.equal(mergeStates(noProject, emptyState()).decks.length, 0);
  assert.ok(sameState(mergeStates(a, b), mergeStates(b, a)));
});

import { taskMarkdown, googleCalendarLink, icsFile } from '../js/export.js';
test('export: markdown keeps notes and ticks; calendar formats', () => {
  const deck = { title: 'T', notes: { 'vision.why#0': 'Because' }, ticks: { 'vision.why:0': true }, selah: { vision: 1 } };
  const md = taskMarkdown(deck, 'P');
  assert.match(md, /- \[x\] Ask: why this task\?\n {2}Because/);
  assert.match(md, /Selah: Can I say it in two sentences\?\* \(passed\)/);
  const start = new Date(2026, 9, 27, 9, 0);
  assert.match(googleCalendarLink({ title: 'a b', start }), /dates=20261027T090000%2F20261027T093000/);
  assert.match(icsFile({ title: 'a,b', start }), /SUMMARY:a\\,b\r\nDESCRIPTION:/);
});
console.log(`\n${passed} tests passed`);
