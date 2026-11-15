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
const testAsync = async (name, fn) => { await fn(); passed++; console.log('ok', name); };

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
import { mergeStates, sameState, emptyState, stampDeck } from '../js/merge.js';
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
test('merge: independent step notes and ticks survive two-device edits', () => {
  const p = { id: 'p', name: 'P', created: 1, updated: 1 };
  const base = { id: 'd', projectId: 'p', title: 'T', updated: 10, notes: {}, ticks: {}, selah: {}, slide: 0 };
  const a = structuredClone(base), b = structuredClone(base);
  a.notes['vision.why#0'] = 'Device A'; a.ticks['vision.why:0'] = true;
  b.notes['vision.why#1'] = 'Device B'; b.ticks['vision.why:1'] = true;
  stampDeck(a, base, 20); stampDeck(b, base, 30);
  const state = (d) => ({ projects: [p], decks: [d], deleted: {} });
  const merged = mergeStates(state(a), state(b));
  assert.deepEqual(merged.decks[0].notes, { 'vision.why#0': 'Device A', 'vision.why#1': 'Device B' });
  assert.deepEqual(merged.decks[0].ticks, { 'vision.why:0': true, 'vision.why:1': true });
  assert.ok(sameState(merged, mergeStates(state(b), state(a))));
  assert.ok(sameState(merged, mergeStates(merged, state(a))));
});

test('merge: fields, Selah answers and passes merge independently', () => {
  const base = { id: 'd', projectId: 'p', title: 'Before', updated: 10, notes: {}, ticks: {}, selah: {}, slide: 0, finished: null, passes: 1, loops: 0 };
  const a = structuredClone(base), b = structuredClone(base);
  a.title = 'Renamed'; a.finished = 19; a.loops = 1; a.passes = 2;
  a.notes['vision.selah'] = 'Answer A'; a.selah.vision = true;
  b.slide = 4; b.notes['research.selah'] = 'Answer B'; b.selah.research = true;
  stampDeck(a, base, 20); stampDeck(b, base, 30);
  const state = (d) => ({ projects: [{ id: 'p' }], decks: [d] });
  const d = mergeStates(state(a), state(b)).decks[0];
  assert.equal(d.title, 'Renamed'); assert.equal(d.finished, 19); assert.equal(d.slide, 4);
  assert.equal(d.loops, 1); assert.equal(d.passes, 2);
  assert.deepEqual(d.selah, { research: true, vision: true });
  assert.equal(d.notes['vision.selah'], 'Answer A'); assert.equal(d.notes['research.selah'], 'Answer B');
});

test('merge: item clears and unticks beat older edits, not unrelated changes', () => {
  const base = { id: 'd', projectId: 'p', title: 'T', updated: 10, notes: { x: 'old', y: 'keep' }, ticks: { x: true }, selah: { vision: true }, selahBy: { vision: 'claude' } };
  const clear = structuredClone(base), edit = structuredClone(base);
  delete clear.notes.x; clear.ticks.x = false; delete clear.selah.vision; delete clear.selahBy.vision;
  edit.notes.x = 'older'; edit.notes.y = 'newer unrelated';
  stampDeck(clear, base, 30); stampDeck(edit, base, 20);
  const state = (d) => ({ projects: [{ id: 'p' }], decks: [d] });
  const merged = mergeStates(state(clear), state(edit));
  const d = merged.decks[0];
  assert.equal(d.notes.x, undefined); assert.equal(d.notes.y, 'newer unrelated');
  assert.equal(d.ticks.x, false); assert.equal(d.selah.vision, undefined); assert.equal(d.selahBy.vision, undefined);
  assert.equal(mergeStates(merged, state(base)).decks[0].notes.x, undefined);
});

test('merge: legacy data uses task time and deletions still win', () => {
  const base = { id: 'd', projectId: 'p', title: 'T', created: 1, updated: 10, notes: { x: 'legacy' }, ticks: {}, selah: {} };
  const newer = { ...base, updated: 20, notes: { x: 'new legacy' } };
  const state = (d) => ({ projects: [{ id: 'p', updated: 1 }], decks: [d], deleted: {} });
  assert.equal(mergeStates(state(base), state(newer)).decks[0].notes.x, 'new legacy');
  const modern = structuredClone(base);
  modern.title = 'New title'; stampDeck(modern, base, 30);
  const combined = mergeStates(state(modern), state(newer));
  assert.equal(combined.decks[0].title, 'New title'); assert.equal(combined.decks[0].notes.x, 'new legacy');
  assert.equal(mergeStates(combined, { projects: [], decks: [], deleted: { d: 30 } }).decks.length, 0);
  assert.equal(mergeStates(combined, { projects: [], decks: [], deleted: { p: 40 } }).decks.length, 0);
});

test('store: saving stamps only changed items and retains clears across sync', () => {
  store.reset();
  const p = store.addProject('Clock test'), d = store.addDeck(p.id, 'Task');
  const before = structuredClone(d);
  d.notes.x = 'one'; d.selah.vision = true; store.save(d);
  assert.equal(d._changed.fields.title, before.updated);
  const xTime = d._changed.notes.x;
  d.notes.y = 'two'; delete d.selah.vision; store.save(d);
  assert.equal(d._changed.notes.x, xTime);
  assert.ok(d._changed.selah.vision > xTime);
  store.applyMerged(store.snapshot());
  d.title = 'Renamed'; store.save(d);
  assert.equal(d._changed.notes.x, xTime);
  const exported = store.exportJSON(); store.importJSON(exported);
  assert.equal(store.allDecks()[0]._changed.notes.x, xTime);
});

test('merge: equal-time conflicts converge and no-op merges are stable', () => {
  const state = (note) => ({ projects: [{ id: 'p', name: 'P' }], decks: [{ id: 'd', projectId: 'p', updated: 5, notes: { x: note } }] });
  const a = state('a'), b = state('b');
  const merged = mergeStates(a, b);
  assert.ok(sameState(merged, mergeStates(b, a)));
  assert.ok(sameState(merged, mergeStates(merged, merged)));
});

await testAsync('sync: edits made during a request survive its response', async () => {
  const oldFetch = globalThis.fetch, oldDocument = globalThis.document;
  globalThis.document = { activeElement: null, dispatchEvent() {} };
  const { syncNow, saveSync } = await import('../js/sync.js');
  store.reset();
  const p = store.addProject('In-flight sync'), d = store.addDeck(p.id, 'Task');
  d.notes.x = 'sent'; store.save(d);
  let respond;
  globalThis.fetch = async (url, init) => {
    if (url.endsWith('/sync')) {
      const { state } = JSON.parse(init.body);
      return new Promise((resolve) => { respond = () => resolve(new Response(JSON.stringify({ state }), { headers: { 'Content-Type': 'application/json' } })); });
    }
    return new Response(JSON.stringify({ settings: { ai: {} } }));
  };
  try {
    saveSync({ url: 'https://sync.example.invalid', token: 'test-fixture' });
    const syncing = syncNow();
    d.notes.x = 'edited while sending'; store.save(d);
    respond();
    const status = await syncing;
    assert.equal(status.state, 'ok');
    assert.equal(store.deck(d.id).notes.x, 'edited while sending');
  } finally {
    saveSync(null);
    globalThis.fetch = oldFetch; globalThis.document = oldDocument;
  }
});

const { missingSelahs, finishTask, taskCheck, isFinishedEarly } = await import('../js/task-status.js');
test('finish: agent blocks missing Selahs unless forced with a short reason', () => {
  store.reset();
  const p = store.addProject('Finish policy'), d = store.addDeck(p.id, 'Guarded');
  for (const fields of [{}, { force: true }, { force: true, reason: ' ' }, { force: false, reason: 'No' }, { force: true, reason: 'x'.repeat(241) }]) {
    const out = applyActions([{ type: 'finish', task: d.id, ...fields }]);
    assert.equal(out.changes.length, 0); assert.match(out.skipped[0], /Vision.*Research.*Plan.*Execute.*Review/);
    assert.equal(d.finished, null);
  }
  applyActions([{ type: 'finish', task: d.id, force: true, reason: '  Scope intentionally reduced.  ' }]);
  assert.ok(d.finished); assert.equal(d.finishedEarly.reason, 'Scope intentionally reduced.');
  assert.deepEqual(d.finishedEarly.skipped, STAGES.map((s) => s.id));
  assert.ok(isFinishedEarly(d));
  applyActions([{ type: 'reopen', task: d.id }]);
  assert.equal(d.finished, null); assert.equal(d.finishedEarly, null);
  STAGES.forEach((s) => { d.selah[s.id] = true; }); store.save(d);
  assert.equal(applyActions([{ type: 'finish', task: d.id }]).skipped.length, 0);
  assert.equal(d.finishedEarly, null);
});

await testAsync('finish: app confirmation lists missing stages; cancel never mutates', async () => {
  const { finishInApp } = await import('../js/views/task-actions.js');
  const d = { selah: { vision: true }, finished: null };
  assert.equal(await finishInApp(d, async (title, text, options) => {
    assert.match(title, /Finish/); assert.match(text, /Research, Plan, Execute, Review/);
    assert.equal(options.ok, 'Finish anyway'); return false;
  }), false);
  assert.equal(d.finished, null); assert.equal(d.finishedEarly, undefined);
  assert.ok(await finishInApp(d, async () => true));
  assert.deepEqual(d.finishedEarly.skipped, ['research', 'plan', 'execute', 'review']);
  const complete = { selah: Object.fromEntries(STAGES.map((s) => [s.id, true])) };
  assert.ok(await finishInApp(complete, () => { throw new Error('No dialog expected'); }));
  assert.equal(complete.finishedEarly, null);
});

test('finish: check notes flag inconsistent legacy and current task states', () => {
  const d = { slide: 0, selah: {}, finished: 10 };
  assert.match(taskCheck(d), /Finished with Selahs missing: Vision/);
  assert.ok(isFinishedEarly(d));
  d.finished = null; d.slide = firstSlideOf('vision'); d.selah.research = true;
  assert.match(taskCheck(d), /beyond current stage: Research/);
  assert.match(taskCheck(d), /before passed Selahs: Research/);
  d.selah = Object.fromEntries(STAGES.map((s) => [s.id, true])); d.slide = SLIDES.length - 1;
  assert.equal(taskCheck(d), '');
  assert.equal(missingSelahs(d).length, 0);
});

test('finish: early-finish metadata merges independently of other task edits', () => {
  const base = { id: 'd', projectId: 'p', title: 'T', updated: 1, selah: {}, notes: {}, ticks: {}, finished: null };
  const a = structuredClone(base), b = structuredClone(base);
  assert.equal(finishTask(a, { force: true, reason: 'Deliberate early finish.' }), null);
  stampDeck(a, base, 20); b.title = 'Renamed elsewhere'; stampDeck(b, base, 30);
  const state = (d) => ({ projects: [{ id: 'p' }], decks: [d] });
  const merged = mergeStates(state(a), state(b)).decks[0];
  assert.ok(merged.finished); assert.equal(merged.finishedEarly.reason, 'Deliberate early finish.');
  assert.equal(merged.title, 'Renamed elsewhere');
});

const { setTaskMeta, validDue, sortFilterTasks, getTaskPrefs, saveTaskPrefs, isOverdue, localCalendarDate } = await import('../js/task-meta.js');
test('tasks: priority and due validate atomically, with null clearing each field', () => {
  const d = {};
  assert.equal(setTaskMeta(d, { priority: 'P1', due: '2028-02-29' }), null);
  assert.deepEqual(d, { priority: 'P1', due: '2028-02-29' });
  for (const patch of [{ priority: 'P5' }, { due: '2026-02-29' }, { due: '2026-04-31' }, { due: '2026-2-01' }, { priority: 'P2', due: '' }, {}]) {
    assert.ok(setTaskMeta(d, patch));
    assert.deepEqual(d, { priority: 'P1', due: '2028-02-29' });
  }
  assert.equal(setTaskMeta(d, { priority: null }), null);
  assert.equal(d.due, '2028-02-29');
  assert.equal(setTaskMeta(d, { due: null }), null);
  assert.deepEqual(d, { priority: null, due: null });
  assert.equal(validDue('0000-01-01'), false);
  assert.equal(validDue('2026-12-31T00:00:00Z'), false);
});

test('tasks: local AI sets and clears task metadata, preserving omitted fields', () => {
  store.reset();
  const p = store.addProject('Metadata'), d = store.addDeck(p.id, 'Optional fields');
  assert.equal(d.priority, undefined); assert.equal(d.due, undefined);
  let r = applyActions([{ type: 'set_task', task: d.id, priority: 'P2', due: '2027-01-20' }]);
  assert.equal(r.changes.length, 1); assert.equal(d.priority, 'P2'); assert.equal(d.due, '2027-01-20');
  r = applyActions([{ type: 'set_task', task: d.id, priority: 'P9', due: null }]);
  assert.equal(r.changes.length, 0); assert.equal(d.due, '2027-01-20');
  applyActions([{ type: 'set_task', task: d.id, priority: null }]);
  assert.equal(d.priority, null); assert.equal(d.due, '2027-01-20');
  applyActions([{ type: 'set_task', task: d.id, due: null }]);
  assert.equal(d.due, null);
  assert.ok(d._changed.fields.priority); assert.ok(d._changed.fields.due);
});

test('tasks: priority and due merge per field across devices, including clears', () => {
  const base = { id: 'd', projectId: 'p', title: 'Legacy', created: 1, updated: 10, notes: {}, ticks: {}, selah: {} };
  const a = structuredClone(base), b = structuredClone(base);
  setTaskMeta(a, { priority: 'P1' }); stampDeck(a, base, 20);
  setTaskMeta(b, { due: '2027-01-02' }); stampDeck(b, base, 30);
  const state = (d) => ({ projects: [{ id: 'p' }], decks: [d] });
  let merged = mergeStates(state(a), state(b));
  assert.equal(merged.decks[0].priority, 'P1'); assert.equal(merged.decks[0].due, '2027-01-02');
  assert.ok(sameState(merged, mergeStates(state(b), state(a))));
  const clear = structuredClone(merged.decks[0]), edit = structuredClone(merged.decks[0]);
  setTaskMeta(clear, { priority: null }); stampDeck(clear, merged.decks[0], 40);
  setTaskMeta(edit, { due: null }); stampDeck(edit, merged.decks[0], 50);
  merged = mergeStates(state(clear), state(edit));
  assert.equal(merged.decks[0].priority, null); assert.equal(merged.decks[0].due, null);
  assert.ok(sameState(merged, mergeStates(merged, state(a))));
  assert.ok(sameState(merged, mergeStates(merged, state(b))));
});

test('tasks: priority/due sort and priority filters include legacy tasks without mutation', () => {
  const tasks = [
    { id: 'none', updated: 3 },
    { id: 'p3', updated: 1, priority: 'P3', due: '2027-02-01' },
    { id: 'p1', updated: 2, priority: 'P1', due: '2027-01-01' },
    { id: 'p2', updated: 4, priority: 'P2' },
  ];
  const ids = (list) => list.map((d) => d.id);
  assert.deepEqual(ids(sortFilterTasks(tasks, { sort: 'priority' })), ['p1', 'p2', 'p3', 'none']);
  assert.deepEqual(ids(sortFilterTasks(tasks, { sort: 'due' })), ['p1', 'p3', 'p2', 'none']);
  assert.deepEqual(ids(sortFilterTasks(tasks, { sort: 'updated' })), ['p2', 'none', 'p1', 'p3']);
  assert.deepEqual(ids(sortFilterTasks(tasks, { priority: 'P1' })), ['p1']);
  assert.deepEqual(ids(sortFilterTasks(tasks, { priority: 'none' })), ['none']);
  assert.deepEqual(sortFilterTasks(tasks, { priority: 'P4' }), []);
  assert.deepEqual(ids(tasks), ['none', 'p3', 'p1', 'p2']);
  assert.equal(isOverdue({ due: '2027-01-01' }, '2027-01-02'), true);
  assert.equal(isOverdue({ due: '2027-01-02' }, '2027-01-02'), false);
  assert.equal(isOverdue({ due: '2027-01-01', finished: 1 }, '2027-01-02'), false);
  assert.equal(isOverdue({ due: 'not a date' }), false);
  assert.equal(localCalendarDate(new Date(2027, 0, 2, 23, 0)), '2027-01-02');
});

test('tasks: sort/filter preferences are remembered only in browser storage', () => {
  const before = store.exportJSON();
  saveTaskPrefs({ sort: 'due', priority: 'P2' });
  assert.deepEqual(getTaskPrefs(), { sort: 'due', priority: 'P2' });
  assert.equal(store.exportJSON(), before);
  saveTaskPrefs({ sort: 'bad', priority: 'bad' });
  assert.deepEqual(getTaskPrefs(), { sort: 'order', priority: 'all' });
});

test('tasks: Markdown includes optional priority and due without changing legacy exports', () => {
  const d = { title: 'T', notes: {}, ticks: {}, selah: {} };
  assert.ok(!taskMarkdown(d).includes('Priority:'));
  assert.ok(!taskMarkdown(d).includes('Due:'));
  d.priority = 'P1'; d.due = '2027-01-02';
  assert.match(taskMarkdown(d), /Priority: P1\nDue: 2027-01-02/);
  d.priority = null; d.due = null;
  assert.ok(!taskMarkdown(d).includes('Priority:'));
});

await testAsync('tasks: rendered dashboards and cards contain the functional task controls', async () => {
  const { taskChips } = await import('../js/views/parts.js');
  const { deckView } = await import('../js/views/deck.js');
  const { projectView } = await import('../js/views/project.js');
  const { home } = await import('../js/views/home.js');
  store.reset(); saveTaskPrefs({ sort: 'priority', priority: 'all' });
  const p = store.addProject('Rendered tasks'), d = store.addDeck(p.id, 'High priority');
  setTaskMeta(d, { priority: 'P1', due: '2000-01-01' }); store.save(d);
  assert.match(taskChips(d), /P1/); assert.match(taskChips(d), /overdue/);
  assert.match(deckView(d.id).html, /data-task-meta/);
  assert.match(deckView(d.id).html, /name="priority"/);
  assert.match(deckView(d.id).html, /name="due"/);
  for (const html of [projectView(p.id).html, home().html]) {
    assert.match(html, /data-task-sort/); assert.match(html, /data-task-filter/);
    assert.match(html, /High priority/); assert.match(html, /Overdue/);
  }
  finishTask(d, { force: true, reason: 'Stop here.' }); store.save(d);
  assert.match(taskChips(d), /finished early/);
  assert.ok(!taskChips(d).includes('overdue'));
  saveTaskPrefs({ priority: 'P4' });
  assert.match(projectView(p.id).html, /No tasks match/);
  saveTaskPrefs({});
});

await testAsync('tasks: dashboard sort/filter changes save preferences and rerender', async () => {
  const { bindTaskListControls } = await import('../js/views/parts.js');
  const { setRenderer } = await import('../js/nav.js');
  const handlers = new Map();
  const root = { addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener: (name) => handlers.delete(name) };
  let renders = 0; setRenderer(() => { renders++; });
  const stop = bindTaskListControls(root);
  try {
    for (const [attribute, value] of [['data-task-sort', 'due'], ['data-task-filter', 'P3']]) {
      handlers.get('change')({ target: { value, matches: (selector) => selector.split(',').includes(`[${attribute}]`) } });
    }
    assert.deepEqual(getTaskPrefs(), { sort: 'due', priority: 'P3' });
    assert.equal(renders, 2);
    stop(); assert.equal(handlers.size, 0);
  } finally { setRenderer(() => {}); saveTaskPrefs({}); }
});

const { orderedItems, reorderItems } = await import('../js/organize.js');
test('organize: local agent renames, moves and reorders with per-field clocks', () => {
  store.reset();
  const a = store.addProject('A'), b = store.addProject('B');
  const x = store.addDeck(a.id, 'X'), y = store.addDeck(a.id, 'Y'), z = store.addDeck(a.id, 'Z');
  assert.equal(applyActions([{ type: 'rename', project: a.id, name: 'Renamed A' }]).changes.length, 1);
  assert.equal(a.name, 'Renamed A');
  applyActions([{ type: 'rename', task: x.id, name: 'Renamed X' }]);
  assert.equal(x.title, 'Renamed X');
  const r = applyActions([{ type: 'reorder', kind: 'tasks', project: a.id, order: [z.id, y.id, x.id] }]);
  assert.equal(r.skipped.length, 0);
  assert.deepEqual(orderedItems(store.decksOf(a.id)).map((d) => d.id), [z.id, y.id, x.id]);
  for (const d of [x, y, z]) assert.ok(d._changed.fields.order);
  applyActions([{ type: 'move_task', task: x.id, project: b.id }]);
  assert.equal(x.projectId, b.id); assert.ok(x._changed.fields.areaId);
  assert.ok(!store.decksOf(a.id).includes(x));
  applyActions([{ type: 'reorder', kind: 'projects', item: b.id, position: 1 }]);
  assert.equal(orderedItems(store.projects())[0].id, b.id);
  assert.equal(applyActions([{ type: 'move_task', task: y.id, project: 'missing' }]).changes.length, 0);
  assert.equal(applyActions([{ type: 'rename', task: y.id, project: a.id, name: 'bad' }]).changes.length, 0);
});

test('organize: full order validation is atomic and one-item positions are one-based', () => {
  const items = [{ id: 'a', order: 0 }, { id: 'b', order: 1 }, { id: 'c', order: 2 }];
  const before = structuredClone(items);
  for (const patch of [{ order: ['a'] }, { order: ['a', 'b', 'b'] }, { item: 'a', position: 0 }, { item: 'a', position: 4 }]) {
    assert.ok(reorderItems(items, patch)); assert.deepEqual(items, before);
  }
  assert.equal(reorderItems(items, { item: 'c', position: 1 }), null);
  assert.deepEqual(orderedItems(items).map((x) => x.id), ['c', 'a', 'b']);
  assert.equal(items[0].order, 0); assert.equal(items[1].order, 1);
});

test('organize: project rename/order and task move/note edits merge across devices', () => {
  const p = { id: 'p', name: 'Old', updated: 1, order: 0 }, q = { id: 'q', name: 'Q', updated: 1, order: 1 };
  const d = { id: 'd', projectId: 'p', title: 'D', updated: 1, order: 0, notes: {}, ticks: {}, selah: {} };
  const a = { projects: [structuredClone(p), q], decks: [structuredClone(d)] };
  const b = structuredClone(a);
  a.projects[0].name = 'Renamed'; stampDeck(a.projects[0], p, 20);
  b.projects[0].order = 3; stampDeck(b.projects[0], p, 30);
  a.decks[0].projectId = 'q'; a.decks[0].order = 2; stampDeck(a.decks[0], d, 20);
  b.decks[0].notes.x = 'Independent'; stampDeck(b.decks[0], d, 30);
  const merged = mergeStates(a, b);
  assert.equal(merged.projects[0].name, 'Renamed'); assert.equal(merged.projects[0].order, 3);
  assert.equal(merged.decks[0].projectId, 'q'); assert.equal(merged.decks[0].order, 2);
  assert.equal(merged.decks[0].notes.x, 'Independent');
  assert.ok(sameState(merged, mergeStates(b, a)));
  assert.ok(sameState(merged, mergeStates(merged, a)));
});

const { filterOverview, compactOverview } = await import('../js/overview.js');
test('overview: all filters combine, dates are exclusive and output is one task per line', () => {
  const state = { projects: [{ id: 'p', name: 'House' }, { id: 'q', name: 'Office' }], decks: [
    { id: 'a', projectId: 'p', title: 'Paint', priority: 'P1', due: '2027-01-01', reached: 1, slide: firstSlideOf('vision') },
    { id: 'b', projectId: 'p', title: 'Read', reached: 0, slide: 0 },
    { id: 'c', projectId: 'q', title: 'Write', priority: 'P2', due: '2027-02-01', reached: 2, slide: firstSlideOf('research'), finished: 1 },
  ] };
  const ids = (options) => filterOverview(state, options).flatMap((g) => g.decks.map((d) => d.id));
  assert.deepEqual(ids({ query: 'HOUSE' }), ['a', 'b']);
  assert.deepEqual(ids({ query: 'paint' }), ['a']);
  assert.deepEqual(ids({ project: 'q' }), ['c']); assert.deepEqual(ids({ project: 'office' }), ['c']);
  assert.deepEqual(ids({ stage: 'research' }), ['c']);
  assert.deepEqual(ids({ status: 'active' }), ['a']);
  assert.deepEqual(ids({ status: 'not started' }), ['b']);
  assert.deepEqual(ids({ status: 'finished' }), ['c']);
  assert.deepEqual(ids({ priority: 'none' }), ['b']);
  assert.deepEqual(ids({ dueBefore: '2027-02-01' }), ['a']);
  assert.deepEqual(ids({ project: 'p', stage: 'vision', priority: 'P1', status: 'active', query: 'Paint', dueBefore: '2027-01-02', limit: 1 }), ['a']);
  assert.deepEqual(ids({ limit: 1 }), ['a']);
  for (const bad of [{ limit: 0 }, { limit: 1.5 }, { status: 'bad' }, { stage: 'bad' }, { priority: 'bad' }, { dueBefore: '2027-02-29' }]) assert.throws(() => ids(bad));
  const output = compactOverview(filterOverview(state), (d) => ({ title: d.title, project: d.projectId }));
  assert.equal(output.split('\n').filter((line) => line.startsWith('{"title"')).length, 3);
  assert.equal(JSON.parse(output).length, 2);
  const many = { projects: [{ id: 'p', name: 'P' }], decks: Array.from({ length: 30 }, (_, i) => ({ id: String(i), projectId: 'p', title: String(i) })) };
  assert.equal(filterOverview(many).flatMap((g) => g.decks).length, 25);
});

test('organize: two devices moving different ranked tasks keep both ordering edits', () => {
  const projects = [{ id: 'p', name: 'P', updated: 1 }];
  const decks = ['a', 'b', 'c', 'd'].map((id, order) => ({ id, projectId: 'p', title: id, order, updated: 1 }));
  const a = { projects, decks: structuredClone(decks) }, b = structuredClone(a);
  reorderItems(a.decks, { item: 'a', position: 3 });
  reorderItems(b.decks, { item: 'd', position: 1 });
  for (let i = 0; i < decks.length; i++) { stampDeck(a.decks[i], decks[i], 20); stampDeck(b.decks[i], decks[i], 30); }
  const merged = mergeStates(a, b);
  assert.deepEqual(orderedItems(merged.decks).map((d) => d.id), ['d', 'b', 'c', 'a']);
  assert.ok(sameState(merged, mergeStates(b, a)));
});

const { slideView: quickSlideView } = await import('../js/views/slide.js');
test('quick: 12 slides, canonical navigation and old full tasks remain unchanged', () => {
  const full = { slide: 3, reached: 5, notes: {}, ticks: {}, selah: {} };
  const quick = { ...full, mode: 'quick' };
  assert.equal(fw.slidesFor(full).length, 27);
  assert.equal(fw.slidesFor(quick).length, 12);
  assert.equal(fw.slideFor(quick).key, 'vision.quick');
  assert.equal(fw.adjacentSlide(quick, 1, 1), selahIndex('vision'));
  assert.equal(fw.adjacentSlide(quick, selahIndex('vision'), -1), 1);
  assert.equal(fw.adjacentSlide(quick, 0, -1), undefined);
  assert.equal(fw.slidePosition(quick, 5), 2);
  assert.equal(deckStatus(quick).pct, 18);
  assert.equal(fw.stagePending(quick, STAGES[0]), 1);
  quick.notes['vision.quick'] = 'One stage note';
  assert.equal(fw.stagePending(quick, STAGES[0]), 0);
  quick.selah.vision = true;
  assert.equal(stageState(quick, STAGES[0]), 'done');
  assert.equal(atSelah({ ...quick, slide: 10 }), true);
});

test('v2: Quick creation is refused and retained notes appear read-only only on the first Full slide', () => {
  store.reset(); const p = store.addProject('Quick tests');
  const result = applyActions([{ type: 'create_task', project: p.id, title: 'Small task', mode: 'quick' }]);
  assert.equal(result.skipped.length, 1);
  const d = store.addDeck(p.id, 'Full Project');
  d.notes['vision.quick'] = 'My stage summary';
  d.notes['vision.why#0'] = 'Full note'; d.ticks['vision.why:0'] = true; store.save(d);
  const content = structuredClone({ notes: d.notes, ticks: d.ticks, selah: d.selah, slide: d.slide, reached: d.reached });
  for (const mode of ['quick', 'invalid']) {
    assert.equal(applyActions([{ type: 'set_task', task: d.id, mode }]).skipped.length, 1);
    assert.equal(d.mode, 'full');
    assert.deepEqual({ notes: d.notes, ticks: d.ticks, selah: d.selah, slide: d.slide, reached: d.reached }, content);
  }
  assert.equal(applyActions([{ type: 'set_task', task: d.id, mode: 'invalid' }]).changes.length, 0);
  assert.equal(applyActions([{ type: 'create_task', project: p.id, title: 'Invalid', mode: 'invalid' }]).changes.length, 0);
  const html = quickSlideView(d.id, '1').html;
  assert.match(html, /Quick notes · read only/);
  assert.match(html, /My stage summary/);
  assert.match(html, /Full note/);
  assert.doesNotMatch(quickSlideView(d.id, '2').html, /quick-retained/);
});

test('v2: all Projects use the Full interview and five-Selah finish policy', () => {
  store.reset(); const p = store.addProject('Quick'); const d = store.addDeck(p.id, 'Tiny');
  assert.deepEqual(iv.progress(d), { filled: 0, total: 34 });
  const target = iv.emptySteps(d)[0];
  assert.equal(target.key, 'vision.why#0'); assert.equal(target.step, 0);
  const saved = iv.saveAnswer(d, target, 'My one small goal', null);
  assert.equal(saved.fallback, true);
  assert.deepEqual(iv.progress(d), { filled: 1, total: 34 });
  assert.doesNotMatch(taskMarkdown(d, p.name), /Mode: Quick/);
  assert.match(taskMarkdown(d), /My one small goal/);
  assert.equal(applyActions([{ type: 'finish', task: d.id }]).changes.length, 0);
  for (const stage of STAGES) applyActions([{ type: 'pass_selah', task: d.id, answer: 'I checked this stage', stage: stage.id }]);
  assert.equal(d.slide, 26);
  assert.equal(applyActions([{ type: 'finish', task: d.id }]).changes.length, 1);
  assert.equal(deckStatus(d).pct, 100);
});

test('quick: mode and separate stage notes merge independently of another device’s Full notes', () => {
  const base = { id: 'q', projectId: 'p', title: 'Q', mode: 'full', updated: 1, notes: {}, ticks: {}, selah: {}, slide: 3, reached: 3 };
  const a = structuredClone(base), b = structuredClone(base);
  a.mode = 'quick'; a.notes['vision.quick'] = 'Quick'; stampDeck(a, base, 10);
  b.notes['vision.why#0'] = 'Full'; b.slide = 5; stampDeck(b, base, 20);
  const state = (d) => ({ projects: [{ id: 'p', name: 'P', updated: 1 }], decks: [d] });
  const merged = mergeStates(state(a), state(b)).decks[0];
  assert.equal(merged.mode, 'quick'); assert.equal(merged.slide, 5);
  assert.equal(merged.notes['vision.quick'], 'Quick'); assert.equal(merged.notes['vision.why#0'], 'Full');
  const c = structuredClone(merged); c.mode = 'full'; stampDeck(c, merged, 30);
  assert.equal(mergeStates(state(merged), state(c)).decks[0].mode, 'full');
});

const theme = await import('../js/theme.js');
test('theme: Auto defaults/fallbacks, explicit overrides and browser-only persistence', () => {
  mem.delete('vesper.theme.v1');
  const before = store.exportJSON();
  assert.equal(theme.getThemePreference(), 'auto');
  assert.equal(theme.resolveTheme('auto', true), 'light');
  assert.equal(theme.resolveTheme('auto', false), 'dark');
  assert.equal(theme.resolveTheme('dark', true), 'dark');
  assert.equal(theme.resolveTheme('light', false), 'light');
  assert.equal(theme.resolveTheme('bad', true), 'light');
  for (const pref of ['light', 'dark', 'auto']) {
    assert.equal(theme.setThemePreference(pref), pref);
    assert.equal(theme.getThemePreference(), pref);
  }
  theme.setThemePreference('bad');
  assert.equal(theme.getThemePreference(), 'auto');
  assert.equal(store.exportJSON(), before);
  assert.match(theme.themeControlHTML(), /Auto/);
  assert.match(theme.themeControlHTML(), /data-theme-control/);
});

test('theme: init and controls follow system changes only in Auto and clean up listeners', () => {
  const originalDocument = globalThis.document, originalMedia = globalThis.matchMedia;
  const node = { dataset: {}, style: {} }; let systemChange;
  const media = { matches: true, addEventListener: (type, fn) => { systemChange = fn; }, removeEventListener: (type, fn) => { assert.equal(fn, systemChange); systemChange = null; } };
  globalThis.document = { documentElement: node };
  globalThis.matchMedia = () => media;
  let onChange;
  const select = { value: '', addEventListener: (t, fn) => { onChange = fn; }, removeEventListener: (t, fn) => { assert.equal(fn, onChange); onChange = null; } };
  try {
    theme.setThemePreference('auto');
    const stop = theme.initTheme();
    assert.equal(node.dataset.theme, 'light');
    media.matches = false; systemChange(); assert.equal(node.dataset.theme, 'dark');
    const stopControl = theme.bindThemeControl({ addEventListener() {}, querySelector: () => select });
    select.value = 'light'; onChange(); assert.equal(node.dataset.theme, 'light');
    media.matches = false; systemChange(); assert.equal(node.dataset.theme, 'light');
    select.value = 'auto'; onChange(); assert.equal(node.dataset.theme, 'dark');
    assert.equal(node.style.colorScheme, 'dark');
    stopControl(); assert.equal(onChange, null);
    stop(); assert.equal(systemChange, null);
  } finally {
    globalThis.document = originalDocument; globalThis.matchMedia = originalMedia;
    theme.setThemePreference('auto');
  }
});

await testAsync('v2 Project details: no Mode control; Save details saves only priority and due', async () => {
  const { bindTaskDetails, deckView } = await import('../js/views/deck.js');
  const { setRenderer } = await import('../js/nav.js');
  store.reset();
  const p = store.addProject('Instant mode'), d = store.addDeck(p.id, 'Keep my work');
  Object.assign(d, { priority: 'P4', due: '2028-01-01', slide: 3, reached: 8, loops: 2, passes: 3 });
  d.notes['vision.why#0'] = 'Full note'; d.notes['vision.quick'] = 'Quick note';
  d.ticks['vision.why:0'] = true; d.selah.vision = true;
  store.save(d);
  const preserved = () => structuredClone({ notes: d.notes, ticks: d.ticks, selah: d.selah, slide: d.slide, reached: d.reached, loops: d.loops, passes: d.passes });
  const before = preserved(), originalFormData = globalThis.FormData;
  const element = (value = '') => {
    const handlers = new Map();
    return { value, handlers, focus() {}, addEventListener: (n, fn) => handlers.set(n, fn), removeEventListener: (n) => handlers.delete(n) };
  };
  const makeForm = () => {
    const form = element(), fields = { mode: element(d.mode), priority: element(d.priority), due: element(d.due) };
    form.elements = { namedItem: (name) => fields[name] };
    return form;
  };
  let current = makeForm(), renders = 0, stop;
  const root = { querySelector: () => current };
  setRenderer(() => { renders++; current = makeForm(); });
  globalThis.FormData = class { constructor(form) { this.form = form; } get(name) { return this.form.elements.namedItem(name).value; } };
  try {
    stop = bindTaskDetails(root, d);
    const old = current;
    current.elements.namedItem('priority').value = 'P2';
    current.elements.namedItem('due').value = '2029-02-03';
    assert.equal(current.elements.namedItem('mode').handlers.size, 0);
    assert.doesNotMatch(deckView(d.id).html, /name="mode"/);
    current.handlers.get('submit')({ preventDefault() {} });
    assert.equal(d.mode, 'full'); assert.equal(d.priority, 'P2'); assert.equal(d.due, '2029-02-03');
    assert.equal(renders, 1);
    stop(); assert.equal(old.handlers.size, 0);
    assert.deepEqual(preserved(), before);
    assert.equal(d.priority, 'P2'); assert.equal(d.due, '2029-02-03');
  } finally { stop?.(); globalThis.FormData = originalFormData; setRenderer(() => {}); }
});

const m2 = await import('../js/model-v2.js');
test('v2 migration: sample and handcrafted backups preserve every old record and field without inventing tasks', () => {
  const source = { version: 1, projects: [{ id: 'a', name: 'Books', order: 3, updated: 10 }], decks: built.decks.map((d, i) => ({ ...structuredClone(d), id: 'p' + i, projectId: 'a', mode: 'quick', priority: 'P1', due: '2030-01-01', custom: 'keep', _changed: { notes: { x: 5 }, fields: { title: 6 } } })), deleted: { gone: 20 } };
  const next = m2.normalizeV2(source);
  assert.equal(next.version, 2); assert.equal(next.areas.length, 1); assert.equal(next.projects.length, built.decks.length); assert.deepEqual(next.tasks, []);
  assert.deepEqual(next.areas, source.projects); assert.deepEqual(next.deleted, source.deleted);
  for (let i = 0; i < source.decks.length; i++) {
    const old = source.decks[i], p = next.projects[i];
    for (const key of Object.keys(old).filter((k) => !['projectId', 'mode', '_changed'].includes(k))) assert.deepEqual(p[key], old[key], key);
    assert.equal(p.areaId, 'a'); assert.equal(p.mode, 'full'); assert.equal(p.custom, 'keep');
    assert.equal(p._changed.notes.x, 5); assert.equal(p._changed.fields.title, 6);
  }
  assert.deepEqual(m2.normalizeV2(next), next);
  store.importJSON(JSON.stringify(source));
  assert.equal(store.snapshot().version, 2); assert.equal(store.tasks().length, 0);
  assert.equal(store.flowProjects()[0].notes['vision.why#0'], next.projects[0].notes['vision.why#0']);
  assert.throws(() => m2.normalizeV2({ version: 3 }), /Unsupported/);
});

test('v2 sync: task done/note and location/title merge independently; deletions beat old edits', () => {
  const s = m2.emptyV2(), db = m2.createModelDb(s);
  const a = db.addArea('A'), b = db.addArea('B'), t = db.addTask('Small', { location: { kind: 'area', id: a.id } });
  const original = structuredClone(t), left = structuredClone(s), right = structuredClone(s);
  left.tasks[0].done = true; left.tasks[0].location = { kind: 'area', id: b.id };
  stampDeck(left.tasks[0], original, original.updated + 10);
  right.tasks[0].note = 'Other device'; right.tasks[0].title = 'Renamed';
  stampDeck(right.tasks[0], original, original.updated + 20);
  const merged = mergeStates(left, right);
  assert.equal(merged.tasks[0].done, true); assert.equal(merged.tasks[0].note, 'Other device');
  assert.equal(merged.tasks[0].title, 'Renamed'); assert.equal(merged.tasks[0].location.id, b.id);
  assert.ok(sameState(merged, mergeStates(right, left)));
  const removed = structuredClone(merged); removed.deleted[t.id] = original.updated + 30;
  assert.equal(mergeStates(removed, s).tasks.length, 0);
  const v1 = { version: 1, projects: [{ ...a }, { ...b }], decks: [], deleted: {} };
  assert.equal(mergeStates(merged, m2.normalizeV2(v1)).tasks[0].note, 'Other device');
});

test('v2 tasks: all move locations, promotion provenance and empty-flow demotion preserve content', () => {
  store.reset(); const a = store.addArea('Work'), p = store.addFlowProject(a.id, 'Parent');
  const t = store.addTask('Small', { priority: 'P1', due: '2030-01-02', note: 'Reason' });
  assert.equal(t.location.kind, 'inbox');
  assert.throws(() => store.promoteTask(t.id), /Area/);
  store.moveTask(t.id, { kind: 'area', id: a.id });
  store.moveTask(t.id, { kind: 'project', id: p.id });
  const promoted = store.promoteTask(t.id);
  assert.equal(promoted.areaId, a.id); assert.equal(promoted.promotedFrom, t.id); assert.equal(t.promotedTo, promoted.id);
  assert.equal(promoted.notes['vision.why#0'], 'Reason'); assert.equal(promoted.priority, 'P1'); assert.equal(promoted.due, '2030-01-02');
  assert.ok(!store.tasks().some((x) => x.id === t.id));
  assert.equal(store.promoteTask(t.id).id, promoted.id);
  assert.throws(() => store.demoteProject(promoted.id), /no notes/);
  const empty = store.addFlowProject(a.id, 'Untouched');
  const child = store.addTask('Child', { location: { kind: 'project', id: empty.id } });
  const demoted = store.demoteProject(empty.id);
  assert.equal(demoted.title, 'Untouched'); assert.equal(demoted.location.id, a.id); assert.equal(demoted.demotedFrom, empty.id);
  assert.equal(child.location.kind, 'area'); assert.equal(child.location.id, a.id); assert.equal(store.flowProject(empty.id), undefined);
  const done = store.addTask('Done'); store.updateTask(done.id, { done: true });
  assert.throws(() => store.promoteTask(done.id, a.id), /done/);
  assert.throws(() => store.moveTask(done.id, { kind: 'project', id: 'missing' }), /not found/);
  for (const field of ['notes', 'ticks', 'selah', 'selahBy']) {
    const blocked = store.addFlowProject(a.id, field); blocked[field] = { x: field === 'notes' ? 'Retained note' : true }; store.save(blocked);
    assert.throws(() => store.demoteProject(blocked.id), /Only a Project/);
  }
});

await testAsync('v2 screens: Home, Area and Project show the new model, mixed filtering and task controls', async () => {
  const { modelHome, modelArea, taskListHTML } = await import('../js/views/model-ui.js');
  const { deckView } = await import('../js/views/deck.js');
  store.reset(); const a = store.addArea('Ministry'), p = store.addFlowProject(a.id, 'Full flow');
  const t = store.addTask('Inbox item', { priority: 'P1', due: '2000-01-01' });
  store.addTask('Area item', { location: { kind: 'area', id: a.id }, priority: 'P2' });
  store.addTask('Project item', { location: { kind: 'project', id: p.id }, note: 'A small action' });
  saveTaskPrefs({ sort: 'priority', priority: 'all' });
  assert.match(modelHome().html, /Inbox/); assert.match(modelHome().html, /Ministry/);
  assert.match(modelArea(a.id).html, /Full flow/); assert.match(modelArea(a.id).html, /Area item/);
  assert.match(deckView(p.id).html, /Project item/); assert.match(deckView(p.id).html, /Add task/);
  assert.doesNotMatch(deckView(p.id).html, /name="mode"/);
  assert.match(taskListHTML('inbox'), /data-task-done/); assert.match(taskListHTML('inbox'), /overdue/);
  const mixed = sortFilterTasks([p, t], { sort: 'priority', priority: 'P1' });
  assert.deepEqual(mixed.map((x) => x.id), [t.id]);
  store.updateTask(t.id, { done: true }); assert.equal(isOverdue(t), false);
  saveTaskPrefs({});
});

await testAsync('v2 finish: open Tasks are mentioned with missing Selahs and never block confirmation', async () => {
  const { finishInApp } = await import('../js/views/task-actions.js');
  store.reset(); const a = store.addArea('A'), p = store.addFlowProject(a.id, 'Flow');
  store.addTask('Open', { location: { kind: 'project', id: p.id } });
  let message = '';
  assert.equal(await finishInApp(p, async (title, text) => { message = title + text; return false; }), false);
  assert.match(message, /Vision/); assert.match(message, /1 task still open/); assert.equal(p.finished, null);
  for (const stage of STAGES) p.selah[stage.id] = true;
  assert.equal(await finishInApp(p, async (title, text) => { message = title + text; return true; }), true);
  assert.match(message, /All Selahs passed/); assert.match(message, /1 task still open/); assert.ok(p.finished);
});

console.log(`\n${passed} tests passed`);
