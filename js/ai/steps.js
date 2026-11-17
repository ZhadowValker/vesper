// The 34 steps in framework order, which are empty, and how far along a task is.
// Plain functions with no screen code, shared by the interview and the online connector.
import { SLIDES, STAGES, isQuick, QUICK_SLIDES, tickKey } from '../framework.js';
import { QUESTIONS } from './questions.js';

export const stepKey = (slide, i) => `${slide.key}#${i}`;
export const filled = (deck, key) => !!(deck.notes[key] || '').trim();

// Every step of the task in framework order, with its question.
export function allSteps(deck) {
  if (isQuick(deck)) return QUICK_SLIDES.filter((s) => s.type === 'quick').map((slide) => ({
    key: slide.key, slide, step: null, text: `${slide.stage.name} notes`,
    question: `What do you need for ${slide.stage.name.toLowerCase()} on this task? Consider: ${slide.stage.subs.map((s) => s.name).join(', ')}.`,
  }));
  const out = [];
  for (const slide of SLIDES) {
    if (slide.type !== 'sub') continue;
    slide.sub.steps.forEach((text, i) => out.push({ key: stepKey(slide, i), slide, step: i, text, question: QUESTIONS[stepKey(slide, i)] }));
  }
  return out;
}

// Steps still to ask, in order. `skipped` is a list of step keys the person passed on.
export function emptySteps(deck, skipped = []) {
  return allSteps(deck).filter((s) => !filled(deck, s.key) && !skipped.includes(s.key));
}

// What the connector should ask next: nothing on a finished project, nothing from a stage whose
// Selah is already passed (so it starts at the current stage), and no step that is already ticked.
export function nextQuestionSteps(deck) {
  if (deck.finished) return [];
  const open = new Set(STAGES.filter((st) => !deck.selah?.[st.id]).map((st) => st.id));
  return emptySteps(deck).filter((s) => open.has(s.slide.stage.id) &&
    (s.step === null || !deck.ticks?.[tickKey(s.slide.stage, s.slide.sub, s.step)]));
}

export function progress(deck) {
  const steps = allSteps(deck);
  return { filled: steps.filter((s) => filled(deck, s.key)).length, total: steps.length };
}

