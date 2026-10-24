// Builds what the model is told. Pure functions: easy to test, no network.
import { SLIDES } from '../framework.js';

const MAX_CONTEXT = 6000;

// Everything the person has written so far in this task, before the given slide index.
export function contextBefore(deck, upTo) {
  const lines = [];
  for (let i = 0; i < upTo; i++) {
    const sl = SLIDES[i];
    if (sl.type !== 'sub') continue;
    const got = [];
    sl.sub.steps.forEach((text, k) => {
      const v = (deck.notes[`${sl.key}#${k}`] || '').trim();
      if (v) got.push(`  - ${text}: ${v}`);
    });
    const n = (deck.notes[sl.key] || '').trim();
    if (n) got.push(`  - Notes: ${n}`);
    if (got.length) lines.push(`${sl.stage.name} / ${sl.sub.name}:\n${got.join('\n')}`);
  }
  let out = lines.join('\n');
  if (out.length > MAX_CONTEXT) out = '…' + out.slice(out.length - MAX_CONTEXT);
  return out || '(nothing written yet)';
}

const SYSTEM = 'You are a calm, practical coach inside a work-planning app. The person moves through five stages: Vision, Research, Plan, Execute, Review. Use plain, everyday words. Be short and concrete. Never invent facts about their situation; build only on what they wrote. Reply with one JSON object and nothing else.';

export function draftMessages(deck, project, slide) {
  const { stage, sub } = slide;
  const idx = SLIDES.indexOf(slide);
  const existing = sub.steps.map((t, k) => (deck.notes[`${slide.key}#${k}`] || '').trim());
  const steps = sub.steps.map((t, k) => `${k + 1}. ${t}${existing[k] ? `  (they already wrote: ${existing[k]})` : ''}`).join('\n');
  const user = `Project: ${project ? project.name : '(none)'}
Task: ${deck.title}

What they have written so far:
${contextBefore(deck, idx)}

Now they are on: ${stage.name}, "${sub.name}" (${sub.what}).
Steps on this slide:
${steps}

Write a short suggestion for each step, in the same order, as if the person wrote it (first person where it fits, one to three short sentences each). If they already wrote something for a step, improve or extend it instead of replacing its meaning.
Reply as JSON: {"steps": ["text for step 1", "text for step 2", ...]} with exactly ${sub.steps.length} strings.`;
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
}

export function reviewMessages(deck, project, stage) {
  const end = SLIDES.findIndex((s) => s.key === `${stage.id}.selah`);
  const here = [];
  for (const sl of SLIDES) {
    if (sl.type !== 'sub' || sl.stage.id !== stage.id) continue;
    sl.sub.steps.forEach((text, k) => {
      const v = (deck.notes[`${sl.key}#${k}`] || '').trim();
      const ticked = !!deck.ticks[`${stage.id}.${sl.sub.id}:${k}`];
      here.push(`- ${sl.sub.name} / ${text} [${ticked ? 'ticked' : 'not ticked'}]: ${v || '(empty)'}`);
    });
    const n = (deck.notes[sl.key] || '').trim();
    if (n) here.push(`- ${sl.sub.name} / Notes: ${n}`);
  }
  const user = `Project: ${project ? project.name : '(none)'}
Task: ${deck.title}

Earlier stages:
${contextBefore(deck, end)}

The "${stage.name}" stage, as written:
${here.join('\n')}

The pause question for this stage is: "${stage.selah}"
Judge only from what is written. Name real gaps: empty or thin steps, things that contradict earlier stages, or an answer that does not address the pause question. Do not praise. At most four gaps, each one short sentence.
Reply as JSON: {"verdict": "ready" | "almost" | "not_yet", "summary": "one or two sentences", "gaps": ["...", "..."]}`;
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
}

// Check a draft reply before it is shown: right count, all strings.
export function validDraft(obj, count) {
  return !!obj && Array.isArray(obj.steps) && obj.steps.length === count && obj.steps.every((x) => typeof x === 'string');
}

export function validReview(obj) {
  return !!obj && ['ready', 'almost', 'not_yet'].includes(obj.verdict) && typeof obj.summary === 'string' && Array.isArray(obj.gaps);
}
