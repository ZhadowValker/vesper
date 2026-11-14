import { STAGES, SLIDES, selahIndex } from './framework.js';

export const missingSelahs = (deck) => STAGES.filter((s) => !deck.selah?.[s.id]);

// Shared finish policy for the UI, local agent and both hub deployments.
export function finishTask(deck, { force = false, reason = '' } = {}) {
  const missing = missingSelahs(deck);
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (missing.length && !(force === true && why && why.length <= 240)) {
    return `Selahs not passed: ${missing.map((s) => s.name).join(', ')}. To finish early, use force: true and a reason of 1–240 characters.`;
  }
  deck.finished = Date.now();
  deck.finishedEarly = missing.length ? { skipped: missing.map((s) => s.id), reason: why } : null;
  return null;
}

export const isFinishedEarly = (deck) => !!deck.finished && (!!deck.finishedEarly || missingSelahs(deck).length > 0);

export function taskCheck(deck) {
  const notes = [];
  const missing = missingSelahs(deck);
  if (deck.finished && missing.length) notes.push(`Finished with Selahs missing: ${missing.map((s) => s.name).join(', ')}`);
  const slide = SLIDES[deck.slide];
  if (!slide) { notes.push('Current slide is invalid'); return notes.join('; '); }
  const current = slide.type === 'recap' ? STAGES.length : STAGES.indexOf(slide.stage);
  const later = STAGES.filter((s, i) => deck.selah?.[s.id] && i > current);
  if (later.length) notes.push(`Selahs passed beyond current stage: ${later.map((s) => s.name).join(', ')}`);
  const ahead = STAGES.filter((s) => deck.selah?.[s.id] && deck.slide <= selahIndex(s.id));
  if (ahead.length) notes.push(`Current slide is at or before passed Selahs: ${ahead.map((s) => s.name).join(', ')}`);
  return notes.join('; ');
}
