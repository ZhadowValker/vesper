import { STAGES, SLIDES, slideIndex, selahIndex, chipState, stageState, deckStatus, atSelah } from './framework.js';
import { esc, trunc, twoLines } from './util.js';

const cls = (state) => ({ done: 'n-done', now: 'n-now', todo: 'n-todo' }[state]);
const tcls = (state) => ({ done: 't-done', now: 't-now', todo: 't-todo' }[state]);

// Project dashboard: the project in the middle-left, each deck branching to the right.
export function projectMap(project, decks) {
  if (!decks.length) {
    return '<div class="soft muted" style="text-align:center">No decks yet. Add the first one.</div>';
  }
  const pitch = 48;
  const H = decks.length * pitch + 10;
  const cy = H / 2;
  const lines = twoLines(project.name);
  let out = `<svg class="mm" viewBox="0 0 340 ${H}" role="img" aria-label="Mind map of ${esc(project.name)} with ${decks.length} decks">`;
  out += `<rect class="n-todo" x="0" y="${cy - 30}" width="84" height="60" rx="8"/>`;
  lines.forEach((line, i) => {
    const y = lines.length === 1 ? cy : cy - 9 + i * 18;
    out += `<text class="tt t-root" x="42" y="${y}" text-anchor="middle" dominant-baseline="central">${esc(line)}</text>`;
  });
  decks.forEach((d, i) => {
    const y = 8 + i * pitch;
    const c = y + 20;
    const st = deckStatus(d);
    const sub = d.finished ? 'Finished' : st.label === 'Not started' ? 'Not started'
      : atSelah(d) ? `${st.label}, paused at Selah` : `${st.label}, ${st.pct}%`;
    out += `<path class="link" d="M84 ${cy} C98 ${cy} 98 ${c} 112 ${c}"/>`;
    out += `<a href="#/d/${d.id}"><rect class="${cls(st.state)}" x="112" y="${y}" width="228" height="40" rx="8"/>`;
    out += `<text class="tt ${tcls(st.state)}" x="124" y="${y + 15}" dominant-baseline="central">${esc(trunc(d.title, 26))}</text>`;
    out += `<text class="ts ${tcls(st.state)}" x="124" y="${y + 31}" dominant-baseline="central">${esc(sub)}</text></a>`;
  });
  return out + '</svg>';
}

// Deck dashboard: the deck on the left, five stages, each with chips for its slides.
export function deckMap(deck) {
  const rowPitch = 46;
  const H = STAGES.length * rowPitch + 12;
  const cy = H / 2;
  const lines = twoLines(deck.title, 9);
  let out = `<svg class="mm" viewBox="0 0 340 ${H}" role="img" aria-label="Mind map of ${esc(deck.title)} with five stages">`;
  out += `<rect class="n-todo" x="0" y="${cy - 25}" width="64" height="50" rx="8"/>`;
  lines.forEach((line, i) => {
    const y = lines.length === 1 ? cy : cy - 9 + i * 18;
    out += `<text class="tt t-root" style="font-size:12px" x="32" y="${y}" text-anchor="middle" dominant-baseline="central">${esc(line)}</text>`;
  });
  STAGES.forEach((stage, i) => {
    const y = 10 + i * rowPitch;
    const c = y + 17;
    const state = stageState(deck, stage);
    out += `<path class="link" d="M64 ${cy} C76 ${cy} 76 ${c} 88 ${c}"/>`;
    out += `<a href="#/d/${deck.id}/s/${slideIndex(stage.subs[0] ? `${stage.id}.${stage.subs[0].id}` : '')}">`;
    out += `<rect class="${cls(state)}" x="88" y="${y}" width="82" height="34" rx="8"/>`;
    out += `<text class="tt ${tcls(state)}" style="font-size:12px" x="129" y="${c}" text-anchor="middle" dominant-baseline="central">${esc(stage.name)}</text></a>`;
    out += `<path class="link" d="M170 ${c} L182 ${c}"/>`;
    const chips = [
      ...stage.subs.map((sub, j) => ({ idx: slideIndex(`${stage.id}.${sub.id}`), label: String(j + 1), title: sub.name })),
      { idx: selahIndex(stage.id), label: 'S', title: 'Selah' },
    ];
    chips.forEach((chip, j) => {
      const x = 184 + j * 30;
      const cs = chipState(deck, SLIDES[chip.idx], chip.idx);
      out += `<a href="#/d/${deck.id}/s/${chip.idx}"><title>${esc(stage.name)}: ${esc(chip.title)}</title>`;
      out += `<rect class="${cls(cs)}" x="${x}" y="${c - 12}" width="26" height="24" rx="6"/>`;
      out += `<text class="ts ${tcls(cs)}" x="${x + 13}" y="${c}" text-anchor="middle" dominant-baseline="central">${chip.label}</text></a>`;
    });
  });
  return out + '</svg>';
}

export const mapLegend = (doneLabel = 'Done', nowLabel = 'Current', todoLabel = 'Not yet') =>
  `<div class="legend"><span><i class="d"></i>${doneLabel}</span><span><i class="n"></i>${nowLabel}</span><span><i class="t"></i>${todoLabel}</span></div>`;
