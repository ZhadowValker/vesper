// The 34 steps in framework order, which are empty, and how far along a task is.
// Plain functions with no screen code, shared by the interview and the online connector.
import { SLIDES } from '../framework.js';
import { QUESTIONS } from './questions.js';

export const stepKey = (slide, i) => `${slide.key}#${i}`;
export const filled = (deck, key) => !!(deck.notes[key] || '').trim();

// Every step of the task in framework order, with its question.
export function allSteps() {
  const out = [];
  for (const slide of SLIDES) {
    if (slide.type !== 'sub') continue;
    slide.sub.steps.forEach((text, i) => out.push({ key: stepKey(slide, i), slide, step: i, text, question: QUESTIONS[stepKey(slide, i)] }));
  }
  return out;
}

// Steps still to ask, in order. `skipped` is a list of step keys the person passed on.
export function emptySteps(deck, skipped = []) {
  return allSteps().filter((s) => !filled(deck, s.key) && !skipped.includes(s.key));
}

export function progress(deck) {
  const steps = allSteps();
  return { filled: steps.filter((s) => filled(deck, s.key)).length, total: steps.length };
}

