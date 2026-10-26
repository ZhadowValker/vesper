// The chat bot's brain, without any screen code: what it is told, how its reply is read,
// and how its actions are applied to the task data. It can fill and tick steps, but it can
// never pass a Selah, delete anything, or finish a task. Those stay with the person.
import { store } from '../store.js';
import { STAGES, SLIDES, slideIndex, selahIndex, tickKey } from '../framework.js';
import { cleanReply, extractJSON } from './client.js';

const MAX_TEXT = 2000;
const MAX_ACTIONS = 40;

// ---- What the model is told -----------------------------------------------------------

function frameworkText() {
  return STAGES.map((st) => {
    const subs = st.subs.map((sub) => `    ${st.id}.${sub.id} "${sub.name}" (${sub.what}): ${sub.steps.map((t, i) => `[${i}] ${t}`).join('; ')}`).join('\n');
    return `${st.name} (pause question: "${st.selah}")\n${subs}`;
  }).join('\n');
}

export function systemPrompt() {
  return `You are the assistant inside Vesper, a work framework. The person chats with you in plain words. You turn what they say into structured tasks and notes, then guide them through the framework one step at a time.

THE FRAMEWORK. Work moves through five stages in order. Each stage has slides, and each slide has steps. Every step has a note box.
${frameworkText()}
After each stage comes a Selah pause, where the person answers that stage's pause question for themselves.

HOW YOU WORK
- Put what the person tells you into the best slide and step, in their own words, shortened and cleaned up. Fill several steps in one turn when they gave enough. Never invent facts about their situation.
- If they describe new work, create a project (only if none fits) and a task, then fill Vision first.
- If something you need is missing, ask ONE short, plain question. Do not ask several at once.
- Do not overwrite what is already written unless they ask you to change it. Use mode "append" to add to a note.
- You cannot pass a Selah. When a stage looks filled in, say so and ask them to open that stage's Selah slide and answer its pause question themselves. Say the question.
- Keep replies short and warm, in plain everyday words. No jargon.
- If they only ask a question or chat, answer with no actions.

REPLY FORMAT. Reply with one JSON object and nothing else:
{"reply": "what you say to the person", "actions": [ ... ]}
Action types (use ids from the state, or exact names):
{"type":"create_project","name":"..."}
{"type":"create_task","project":"<project id or name>","title":"..."}
{"type":"set_note","task":"<task id or title>","slide":"vision.why","step":0,"text":"...","mode":"append"}
  - "step" is the step number from the list above. Leave it out for the slide's general notes.
  - "mode" is "append" (default when something is already written) or "replace".
  - Filling a step also ticks it. Add "tick": false to leave it unticked.
{"type":"tick","task":"...","slide":"vision.why","step":1,"done":true}
{"type":"focus","task":"<task id or title>"}   (switch which task you are working on)
Use [] for actions when there is nothing to change.`;
}

export function stateText(focusId) {
  const projects = store.projects();
  if (!projects.length) return 'There are no projects or tasks yet.';
  const lines = ['Projects and tasks:'];
  for (const p of projects) {
    lines.push(`- project ${p.id} "${p.name}"`);
    for (const d of store.decksOf(p.id)) {
      const sl = SLIDES[d.slide];
      const where = d.finished ? 'finished' : sl.stage ? `${sl.stage.name}, slide ${d.slide + 1} of ${SLIDES.length}` : 'not started';
      lines.push(`  - task ${d.id} "${d.title}" (${where})${d.id === focusId ? '  <- working on this' : ''}`);
    }
  }
  const f = focusId && store.deck(focusId);
  if (f) {
    lines.push('', `Notes in the task you are working on ("${f.title}"). Empty steps are marked (empty):`);
    let used = 0;
    for (const sl of SLIDES) {
      if (sl.type !== 'sub') continue;
      const parts = sl.sub.steps.map((t, i) => {
        const v = (f.notes[`${sl.key}#${i}`] || '').trim();
        return `[${i}] ${v ? v.slice(0, 300) : '(empty)'}`;
      });
      const n = (f.notes[sl.key] || '').trim();
      const row = `${sl.key}: ${parts.join(' | ')}${n ? ` | notes: ${n.slice(0, 300)}` : ''}`;
      used += row.length;
      if (used > 6000) { lines.push('(more slides not shown)'); break; }
      lines.push(row);
    }
    const passed = STAGES.filter((st) => f.selah[st.id]).map((st) => st.name);
    lines.push(`Selah passed by the person: ${passed.length ? passed.join(', ') : 'none yet'}.`);
  }
  return lines.join('\n');
}

// history: [{r:'u'|'b', t, raw}] oldest first. Only the last few turns are sent.
export function buildMessages(history, userText, focusId) {
  const msgs = [{ role: 'system', content: `${systemPrompt()}\n\nCURRENT STATE\n${stateText(focusId)}` }];
  for (const m of history.slice(-8)) {
    msgs.push(m.r === 'u' ? { role: 'user', content: m.t } : { role: 'assistant', content: m.raw || JSON.stringify({ reply: m.t, actions: [] }) });
  }
  msgs.push({ role: 'user', content: userText });
  return msgs;
}

// ---- Reading the reply ----------------------------------------------------------------

// Never throws. If the model did not send JSON, its text becomes the reply with no actions.
export function parseTurn(text) {
  const clean = cleanReply(text);
  try {
    const o = extractJSON(clean);
    const reply = typeof o.reply === 'string' ? o.reply.trim() : '';
    const actions = Array.isArray(o.actions) ? o.actions.filter((a) => a && typeof a === 'object').slice(0, MAX_ACTIONS) : [];
    if (reply || actions.length) return { reply: reply || 'Done.', actions, raw: clean.slice(0, 4000) };
  } catch (e) { /* not JSON, use the text */ }
  return { reply: clean || 'I had trouble answering that. Please try again.', actions: [], raw: '' };
}

// ---- Applying actions -----------------------------------------------------------------

const norm = (s) => String(s || '').trim().toLowerCase();

// The furthest slide a task may sit on: its first Selah the person has not passed yet.
function limitIndex(deck) {
  const open = STAGES.find((st) => !deck.selah[st.id]);
  return open ? selahIndex(open.id) : SLIDES.length - 1;
}

function slideLabel(slide, step) {
  return step == null ? `${slide.sub.name} notes` : `${slide.sub.name} › ${slide.sub.steps[step]}`;
}

export function applyActions(actions, { focusId = null } = {}) {
  const changes = [];
  const skipped = [];
  const touched = new Map();   // deck id -> highest slide index touched
  const made = { projects: {}, decks: {} };
  let focus = focusId;

  const findProject = (ref) => {
    const r = norm(ref);
    if (r) {
      const list = store.projects();
      const hit = list.find((p) => p.id === ref) || list.find((p) => norm(p.name) === r);
      if (hit) return hit;
      if (made.projects[r]) return made.projects[r];
    }
    const f = focus && store.deck(focus);
    if (!r && f) return store.project(f.projectId);
    return store.projects().length === 1 && !r ? store.projects()[0] : null;
  };
  const findTask = (ref) => {
    const r = norm(ref);
    if (!r) return focus ? store.deck(focus) : null;
    const all = store.allDecks();
    const byId = all.find((d) => d.id === ref);
    if (byId) return byId;
    const byTitle = all.filter((d) => norm(d.title) === r);
    if (byTitle.length === 1) return byTitle[0];
    return made.decks[r] || null;
  };
  const touch = (deck, idx) => touched.set(deck.id, Math.max(touched.get(deck.id) ?? -1, idx));

  for (const a of actions) {
    const type = a.type;
    if (type === 'create_project') {
      const name = String(a.name || '').trim().slice(0, 80);
      if (!name) { skipped.push('A project had no name.'); continue; }
      const have = store.projects().find((p) => norm(p.name) === norm(name));
      if (have) { made.projects[norm(name)] = have; continue; }
      const p = store.addProject(name);
      made.projects[norm(name)] = p;
      changes.push({ text: `Created project "${p.name}"`, href: `#/p/${p.id}` });
    } else if (type === 'create_task') {
      const title = String(a.title || '').trim().slice(0, 80);
      const project = findProject(a.project);
      if (!title) { skipped.push('A task had no name.'); continue; }
      if (!project) { skipped.push(`No project found for "${title}".`); continue; }
      const have = store.decksOf(project.id).find((d) => norm(d.title) === norm(title));
      const d = have || store.addDeck(project.id, title);
      made.decks[norm(title)] = d;
      focus = d.id;
      if (!have) changes.push({ text: `Created task "${d.title}" in ${project.name}`, href: `#/d/${d.id}` });
    } else if (type === 'focus') {
      const d = findTask(a.task);
      if (d) focus = d.id; else skipped.push(`Could not find the task "${a.task}".`);
    } else if (type === 'set_note' || type === 'tick') {
      const deck = findTask(a.task);
      if (!deck) { skipped.push(`Could not find the task "${a.task || ''}".`); continue; }
      const idx = slideIndex(String(a.slide || ''));
      const slide = SLIDES[idx];
      if (!slide || slide.type !== 'sub') { skipped.push(`There is no slide "${a.slide}".`); continue; }
      const hasStep = a.step !== undefined && a.step !== null && a.step !== '';
      const step = hasStep ? Number(a.step) : null;
      if (hasStep && !(Number.isInteger(step) && step >= 0 && step < slide.sub.steps.length)) {
        skipped.push(`"${slide.sub.name}" has no step ${a.step}.`); continue;
      }
      focus = deck.id;
      if (type === 'tick') {
        if (step === null) { skipped.push('A tick needs a step.'); continue; }
        const key = tickKey(slide.stage, slide.sub, step);
        const done = a.done !== false;
        if (!!deck.ticks[key] === done) continue;
        deck.ticks[key] = done;
        touch(deck, idx);
        changes.push({ text: `${done ? 'Ticked' : 'Unticked'} ${slideLabel(slide, step)}`, href: `#/d/${deck.id}/s/${idx}` });
        continue;
      }
      const text = String(a.text || '').trim().slice(0, MAX_TEXT);
      if (!text) { skipped.push(`Empty text for ${slide.sub.name}.`); continue; }
      const nk = step === null ? slide.key : `${slide.key}#${step}`;
      const old = (deck.notes[nk] || '').trim();
      let next = text;
      if (old) {
        if (a.mode === 'replace') next = text;
        else if (old.includes(text)) continue;
        else next = `${old}\n${text}`;
      }
      deck.notes[nk] = next;
      if (step !== null && a.tick !== false) deck.ticks[tickKey(slide.stage, slide.sub, step)] = true;
      touch(deck, idx);
      changes.push({ text: `${old ? 'Added to' : 'Filled'} ${slideLabel(slide, step)}`, href: `#/d/${deck.id}/s/${idx}` });
    } else {
      skipped.push(`Unknown action "${type}".`);
    }
  }

  // Move each touched task forward to where the work now is, but never past an unpassed Selah.
  for (const [id, idx] of touched) {
    const deck = store.deck(id);
    if (!deck || deck.finished) continue;
    const target = Math.min(idx, limitIndex(deck));
    if (target > deck.slide) deck.slide = target;
    deck.reached = Math.max(deck.reached, deck.slide);
    store.save(deck);
  }
  return { changes, skipped, focus };
}
