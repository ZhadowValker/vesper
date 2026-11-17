import { STAGES, slideFor, selahIndex } from './framework.js';

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
  const slide = slideFor(deck);
  if (!slide) { notes.push('Current slide is invalid'); return notes.join('; '); }
  const current = slide.type === 'recap' ? STAGES.length : STAGES.indexOf(slide.stage);
  const later = STAGES.filter((s, i) => deck.selah?.[s.id] && i > current);
  if (later.length) notes.push(`Selahs passed beyond current stage: ${later.map((s) => s.name).join(', ')}`);
  const ahead = STAGES.filter((s) => deck.selah?.[s.id] && deck.slide <= selahIndex(s.id));
  if (ahead.length) notes.push(`Current slide is at or before passed Selahs: ${ahead.map((s) => s.name).join(', ')}`);
  return notes.join('; ');
}

// Un-pass the Selahs from one stage on (loop back). Each passed Selah's answer is archived to
// "<stage>.selah#pass<N>" so the next pass starts clean but the earlier answer is kept.
// "#" keeps archived answers out of slide notes and steps. Shared by the app and the connector.
export function unpassSelahsFrom(deck, fromIndex) {
  deck.notes ||= {};
  for (let i = Math.max(0, fromIndex); i < STAGES.length; i++) {
    const id = STAGES[i].id;
    const key = `${id}.selah`;
    const answer = String(deck.notes[key] || '').trim();
    if (deck.selah?.[id] && answer) {
      const archive = `${key}#pass${deck.passes || 1}`;
      const kept = String(deck.notes[archive] || '').trim();
      deck.notes[archive] = kept ? `${kept}\n${answer}` : answer;
      delete deck.notes[key];
    }
    if (deck.selah) delete deck.selah[id];
    if (deck.selahBy) delete deck.selahBy[id];
  }
}
