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
    out += `<a href="#/d/${d.id}" class="${st.stageId ? 's-' + st.stageId : ''}"><rect class="${cls(st.state)}" x="112" y="${y}" width="228" height="40" rx="8"/>`;
    out += `<text class="tt ${tcls(st.state)}" x="124" y="${y + 15}" dominant-baseline="central">${esc(trunc(d.title, 26))}</text>`;
    out += `<text class="ts ${tcls(st.state)}" x="124" y="${y + 31}" dominant-baseline="central">${esc(sub)}</text></a>`;
  });
  return out + '</svg>';
}

// Deck dashboard: a tree. The deck on the left, branches to the five stages,
// and each stage lists its slides by name. Curves are drawn by drawDeckTree() after render.
export function deckMap(deck) {
  const star = '<svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z"/></svg>';
  const rows = STAGES.map((stage) => {
    const state = stageState(deck, stage);
    const chips = [
      ...stage.subs.map((sub) => ({ idx: slideIndex(`${stage.id}.${sub.id}`), label: esc(sub.name), title: sub.name })),
      { idx: selahIndex(stage.id), label: `${star}Selah`, title: 'Selah' },
    ].map((chip) => {
      const cs = chipState(deck, SLIDES[chip.idx], chip.idx);
      return `<a class="dt-chip ${cs}" href="#/d/${deck.id}/s/${chip.idx}" title="${esc(stage.name)}: ${esc(chip.title)}">${chip.label}</a>`;
    }).join('');
    const first = slideIndex(`${stage.id}.${stage.subs[0].id}`);
    return `<div class="dt-row s-${stage.id} ${state}">
      <a class="dt-node" data-stage="${stage.id}" href="#/d/${deck.id}/s/${first}"><span>${esc(stage.name)}</span></a>
      <span class="dt-stub" aria-hidden="true"></span>
      <div class="dt-chips">${chips}</div>
    </div>`;
  }).join('');
  return `<div class="dt" role="group" aria-label="Mind map of ${esc(deck.title)}">
    <svg class="dt-links" aria-hidden="true"></svg>
    <div class="dt-root" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z"/></svg></div>
    <div class="dt-rows">${rows}</div>
  </div>`;
}

// Draw the curved branches from the deck node to each stage node.
export function drawDeckTree(scope) {
  const tree = scope.querySelector('.dt');
  if (!tree) return () => {};
  const svg = tree.querySelector('.dt-links');
  const draw = () => {
    const box = tree.getBoundingClientRect();
    const r = tree.querySelector('.dt-root').getBoundingClientRect();
    const x0 = r.right - box.left;
    const y0 = r.top + r.height / 2 - box.top;
    svg.setAttribute('width', box.width);
    svg.setAttribute('height', box.height);
    svg.innerHTML = [...tree.querySelectorAll('.dt-row')].map((row) => {
      const n = row.querySelector('.dt-node').getBoundingClientRect();
      const x1 = n.left - box.left;
      const y1 = n.top + n.height / 2 - box.top;
      const mid = (x0 + x1) / 2;
      return `<path class="${row.classList[1]}" d="M${x0} ${y0} C${mid} ${y0} ${mid} ${y1} ${x1} ${y1}"/>`;
    }).join('');
  };
  draw();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(draw) : null;
  if (ro) ro.observe(tree);
  window.addEventListener('resize', draw);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
  return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', draw); };
}

export const mapLegend = (doneLabel = 'Done', nowLabel = 'Current', todoLabel = 'Not yet') =>
  `<div class="legend"><span><i class="d"></i>${doneLabel}</span><span><i class="n"></i>${nowLabel}</span><span><i class="t"></i>${todoLabel}</span></div>`;
