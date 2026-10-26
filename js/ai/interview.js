// The interview: the app walks a task's steps in order and asks one plain question each.
// The AI only turns each answer into clean notes. Everything here is plain logic with no
// screen code, so it can be tested. If the AI fails, the person's own words are saved.
import { STAGES, SLIDES, slideIndex, selahIndex } from '../framework.js';
import { contextBefore } from './prompts.js';
import { applyActions } from './agent.js';

import { stepKey, allSteps, emptySteps, progress, filled } from './steps.js';
export { stepKey, allSteps, emptySteps, progress };
const label = (s) => `${s.slide.stage.name} › ${s.slide.sub.name}`;

// The text of the next question, with a heading when the slide or stage changes and a
// Selah reminder when a stage has just been completed. prev is the step just answered (or null).
export function nextQuestion(deck, skipped, prev) {
  const rest = emptySteps(deck, skipped);
  const next = rest[0] || null;
  const links = [];
  const parts = [];
  if (prev) {
    const stage = prev.slide.stage;
    const stageLeft = rest.some((s) => s.slide.stage.id === stage.id);
    if (!stageLeft && !deck.selah[stage.id]) {
      const idx = selahIndex(stage.id);
      parts.push(`**${stage.name}** is filled in. When you are ready, take its Selah pause and answer for yourself: "${stage.selah}"`);
      links.push({ text: `Open ${stage.name} Selah`, href: `#/d/${deck.id}/s/${idx}` });
    }
  }
  if (!next) {
    parts.push('Everything that can be asked is filled in. Open the task to read it through. Your notes are saved.');
    links.push({ text: 'Open the task map', href: `#/d/${deck.id}` });
    return { text: parts.join('\n\n'), target: null, links };
  }
  const head = (!prev || prev.slide.key !== next.slide.key) ? `**${label(next)}**\n` : '';
  parts.push(`${head}${next.question}`);
  return { text: parts.join('\n\n'), target: next, links };
}

// ---- Turning an answer into notes -------------------------------------------------------

const SYSTEM = `You are the note-taker in an interview. The person answers plain questions about a task. Turn their answer into clean notes for the right step, in their own voice, short (one to three sentences, or a tight list), plain everyday words. Never invent facts or add advice. Reply with one JSON object and nothing else:
{"ack": "one short friendly sentence reacting to their answer, max 15 words", "notes": [{"slide": "vision.why", "step": 1, "text": "..."}]}
Always include a note for the step being asked about. Add notes for other listed steps only if the answer clearly covers them.`;

export function extractMessages(deck, project, target, answer, skipped = []) {
  const idx = slideIndex(target.slide.key);
  const others = emptySteps(deck, skipped).filter((s) => s.key !== target.key).slice(0, 8);
  const user = `Project: ${project ? project.name : '(none)'}
Task: ${deck.title}

Already written:
${contextBefore(deck, idx + 1)}

Step being asked about: slide "${target.slide.key}", step ${target.step} ("${target.text}")
Question asked: ${target.question}

Other empty steps you may also fill if the answer covers them:
${others.map((s) => `- slide "${s.slide.key}", step ${s.step} ("${s.text}"): ${s.question}`).join('\n') || '(none)'}

Their answer:
${answer}`;
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
}

// Save the answer. `reply` is the parsed AI object or null. Only empty steps may be written
// by the AI; the asked step always gets something (the person's own words if the AI gave nothing).
export function saveAnswer(deck, target, answer, reply, skipped = []) {
  const allowed = new Set([target.key, ...emptySteps(deck, skipped).map((s) => s.key)]);
  const notes = reply && Array.isArray(reply.notes) ? reply.notes : [];
  const actions = notes
    .filter((n) => n && typeof n.text === 'string' && allowed.has(`${n.slide}#${n.step}`))
    .map((n) => ({ type: 'set_note', task: deck.id, slide: n.slide, step: n.step, text: n.text }));
  const out = actions.length ? applyActions(actions, { focusId: deck.id }) : { changes: [], skipped: [] };
  let fallback = false;
  if (!filled(deck, target.key)) {
    const r = applyActions([{ type: 'set_note', task: deck.id, slide: target.slide.key, step: target.step, text: answer }], { focusId: deck.id });
    out.changes.push(...r.changes);
    fallback = true;
  }
  const ack = reply && typeof reply.ack === 'string' ? reply.ack.trim().slice(0, 140) : '';
  return { changes: out.changes, ack, fallback };
}

// Quick local intents so "skip" never needs the AI.
export function intentOf(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[.!]+$/, '');
  if (['skip', 'pass', 'skip this', 'next', 'not sure', 'dont know', "don't know", 'later'].includes(t)) return 'skip';
  if (['stop', 'pause', 'end', 'quit', 'stop interview', 'done for now'].includes(t)) return 'stop';
  return null;
}

export { STAGES };
