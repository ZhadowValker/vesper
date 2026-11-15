// The chat bot's brain, without any screen code: what it is told, how its reply is read,
// and how its actions are applied to the task data. It can fill and tick steps, but it can
// pass a Selah only with the person's answer, and delete only after they say yes.
import { store } from '../store.js';
import { STAGES, SLIDES, slideFor, slidesFor, slidePosition, isQuick } from '../framework.js';
import { applyActions as applyWith } from './apply.js';
import { applyModelActions } from '../model-actions.js';
import { cleanReply, extractJSON } from './client.js';

const MAX_ACTIONS = 40;

// ---- What the model is told -----------------------------------------------------------

function frameworkText() {
  return STAGES.map((st) => {
    const subs = st.subs.map((sub) => `    ${st.id}.${sub.id} "${sub.name}" (${sub.what}): ${sub.steps.map((t, i) => `[${i}] ${t}`).join('; ')}`).join('\n');
    return `${st.name} (pause question: "${st.selah}")\n${subs}`;
  }).join('\n');
}

function legacySystemPrompt() {
  return `You are the assistant inside Vesper, a work framework. The person chats with you in plain words. You turn what they say into structured tasks and notes, then guide them through the framework one step at a time.

THE FRAMEWORK. Work moves through five stages in order. Each stage has slides, and each slide has steps. Every step has a note box.
${frameworkText()}
After each stage comes a Selah pause, where the person answers that stage's pause question for themselves.

HOW YOU WORK
- Put what the person tells you into the best slide and step, in their own words, shortened and cleaned up. Fill several steps in one turn when they gave enough. Never invent facts about their situation.
- If they describe new work, create a project (only if none fits) and a task, then fill Vision first.
- If something you need is missing, ask ONE short, plain question. Do not ask several at once.
- Do not overwrite what is already written unless they ask you to change it. Use mode "append" to add to a note.
- When a stage looks filled in, say so and ask them the stage's pause question. When they answer (or tell you to go ahead and answer it for them), pass the Selah with their answer. Never pass a Selah they have not agreed to.
- Delete only a task or project they clearly asked to delete, with "confirm":true.
- Keep replies short and warm, in plain everyday words. No jargon.
- If they only ask a question or chat, answer with no actions.

REPLY FORMAT. Reply with one JSON object and nothing else:
{"reply": "what you say to the person", "actions": [ ... ]}
Action types (use ids from the state, or exact names):
{"type":"create_project","name":"..."}
{"type":"create_task","project":"<project id or name>","title":"...","mode":"full"}
Mode may be full (27 slides/34 steps) or quick (12 slides/5 stage notes). Omitted mode defaults full. Choose Quick only when the person asks for a small/quick task.
Quick notes use slide keys vision.quick, research.quick, plan.quick, execute.quick, review.quick, with no step (or step:null). Each stage gets one notes box and still needs its Selah. Full-mode notes are retained when switching modes.
{"type":"set_note","task":"<task id or title>","slide":"vision.why","step":0,"text":"...","mode":"append"}
  - "step" is the step number from the list above. Leave it out for the slide's general notes.
  - "mode" is "append" (default when something is already written) or "replace".
  - Filling a step also ticks it. Add "tick": false to leave it unticked.
{"type":"tick","task":"...","slide":"vision.why","step":1,"done":true}
{"type":"pass_selah","task":"...","answer":"their answer to the stage pause question"}   (the next unpassed stage only)
{"type":"loop_back","task":"...","stage":"research"}   (go back on purpose; clears Selah passes from there)
{"type":"finish","task":"..."}  or  {"type":"reopen","task":"..."}
{"type":"set_task","task":"...","priority":"P1","due":"2026-12-31"}
{"type":"set_task","task":"...","mode":"quick"} switches mode without deleting any notes.
{"type":"rename","task":"id","name":"New name"} or {"type":"rename","project":"id","name":"New name"}
{"type":"move_task","task":"id","project":"destination id"}
{"type":"reorder","kind":"projects","order":["project id","project id"]} or {"type":"reorder","kind":"tasks","project":"id","item":"task id","position":1}
Reorder accepts the full list of ids exactly once, or one item at a 1-based position. Never omit other ids from a full order.
Task priority is P1, P2, P3 or P4. Due is a real calendar date YYYY-MM-DD. Include only fields requested; use null to clear priority or due. Never invent a due date or priority.
Finish requires all five Selahs. Only when the person explicitly chooses early finish use {"type":"finish","task":"...","force":true,"reason":"their short reason (1–240 characters)"}.
{"type":"delete_task","task":"...","confirm":true}  or  {"type":"delete_project","project":"...","confirm":true}
{"type":"focus","task":"<task id or title>"}   (switch which task you are working on)
Use [] for actions when there is nothing to change.`;
}

function legacyStateText(focusId) {
  const projects = store.projects();
  if (!projects.length) return 'There are no projects or tasks yet.';
  const lines = ['Projects and tasks:'];
  for (const p of projects) {
    lines.push(`- project ${p.id} "${p.name}"`);
    for (const d of store.decksOf(p.id)) {
      const sl = slideFor(d);
      const where = d.finished ? 'finished' : sl.stage ? `${sl.stage.name}, slide ${slidePosition(d) + 1} of ${slidesFor(d).length}` : 'not started';
      lines.push(`  - task ${d.id} "${d.title}" (${where}; mode: ${isQuick(d) ? 'quick' : 'full'}; priority: ${d.priority || 'none'}; due: ${d.due || 'none'})${d.id === focusId ? '  <- working on this' : ''}`);
    }
  }
  const f = focusId && store.deck(focusId);
  if (f) {
    lines.push('', `Notes in the task you are working on ("${f.title}"). Empty steps are marked (empty):`);
    let used = 0;
    for (const sl of slidesFor(f)) {
      if (!['sub', 'quick'].includes(sl.type)) continue;
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
    lines.push(`Selah passed: ${passed.length ? passed.join(', ') : 'none yet'}.`);
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

// ---- Applying actions (the rules live in apply.js) -----------------------------------

export function applyActions(actions, { focusId = null } = {}) {
  return applyWith(actions, { focusId, db: store });
}

export function applyModelTurn(actions, { focusId = null } = {}) {
  return applyModelActions(actions, { focusId, db: store, by: 'ai' });
}
export function systemPrompt() {
  return `You are Vesper, a calm planning assistant. Reply with JSON {"reply":"...","actions":[]}.
Area is a named group. Project is a Full Vesper flow (27 slides, 34 steps), belongs to exactly one Area and never nests.
A simple Task has title, done tick, priority, due and one short note; no slides/Selah. It lives in Inbox, an Area or a Project.
Quick mode was removed. Never create it. Never interview a simple Task.
Never invent personal answers. Preserve the person's words. Omit unchanged fields; null clears priority/due.
Priority P1/P2/P3/P4 or null; due YYYY-MM-DD or null.
Actions:
{"type":"create_area","name":"Work"}
{"type":"create_project","area":"area id/name","title":"Full project"}
{"type":"create_task","title":"Small action","area":"optional area id","project":"OR optional project id","note":"optional"}
With no location a Task goes to Inbox; never give both area and project.
{"type":"update_task","task":"simple task id","done":true,"title":"optional","note":"optional","priority":"P1","due":null}
{"type":"move_task","task":"simple task id","inbox":true} or area/project.
{"type":"promote_task","task":"open simple task id","area":"required only for Inbox"}
{"type":"demote_project","project":"empty Full Project id"}
{"type":"rename","area":"id","name":"..."} or project or task.
{"type":"move_project","project":"id","area":"id"}
{"type":"reorder","kind":"areas|projects|tasks","area":"for projects/Area tasks","order":["all ids"]} or item and position.
{"type":"delete_task","task":"simple task id","confirm":true}; delete_project uses project; delete_area uses area.
Delete only after explicit confirmation from the person.
For Full Project flow actions use project id (legacy task is accepted as a Project alias):
{"type":"set_note","project":"id","slide":"vision.why","step":0,"text":"...","mode":"append"}
{"type":"tick","project":"id","slide":"vision.why","step":0,"done":true}
{"type":"pass_selah","project":"id","stage":"vision","answer":"the person's answer"}
{"type":"loop_back","project":"id","stage":"research"}
{"type":"finish","project":"id"}; requires all Selahs, unless force:true and their short reason.
{"type":"reopen","project":"id"}; {"type":"set_project","project":"id","priority":"P1","due":null}
{"type":"focus","project":"id"}
Only the person decides Selah answers. Do not pass one silently. Simple Tasks never block Project Finish.
Full Project framework:\n${frameworkText()}`;
}
export function stateText(focusId) {
  const lines = ['Areas, Projects and simple Tasks:'];
  for (const area of store.areas()) {
    lines.push(`Area ${area.id} "${area.name}"`);
    for (const project of store.projectsIn(area.id)) lines.push(` Project ${project.id} "${project.title}" priority:${project.priority || 'none'} due:${project.due || 'none'} ${project.id === focusId ? '(focused)' : ''} ${project.finished ? 'finished' : 'open'}`);
  }
  for (const task of store.tasks()) lines.push(`Task ${task.id} "${task.title}" ${task.done ? 'done' : 'open'} ${JSON.stringify(task.location)} priority:${task.priority || 'none'} due:${task.due || 'none'} note:${task.note || ''}`);
  const focused = store.flowProject(focusId);
  if (focused) {
    lines.push(`Focused Full Project notes: ${JSON.stringify(focused.notes)}; ticks:${JSON.stringify(focused.ticks)}; Selahs:${JSON.stringify(focused.selah)}`);
    for (const slide of SLIDES.filter((s) => s.type === 'sub')) {
      const notes = slide.sub.steps.map((_, i) => `[${i}] ${focused.notes[`${slide.key}#${i}`] || '(empty)'}`);
      if (notes.length) lines.push(`${slide.key}: ${notes.join('; ')}`);
    }
  }
  return lines.join('\n');
}
