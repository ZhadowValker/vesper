import { STAGES, SLIDES, slideIndex, selahIndex, chipState, stageState, deckStatus, atSelah } from './framework.js';
import { esc } from './util.js';

// Project dashboard: the same tree as the deck map. The project on the left, a branch to each deck.
export function projectMap(project, decks) {
  if (!decks.length) {
    return '<div class="soft muted empty-map">No decks yet. Add the first one.</div>';
  }
  const rows = decks.map((d) => {
    const st = deckStatus(d);
    const sub = d.finished ? 'Finished' : st.label === 'Not started' ? 'Not started'
      : atSelah(d) ? `${st.label}, paused at Selah` : `${st.label}, ${st.pct}%`;
    return `<div class="dt-row deck ${st.stageId ? 's-' + st.stageId : ''} ${st.state}">
      <a class="dt-node" href="#/d/${d.id}"><span class="dt-title">${esc(d.title)}</span><span class="dt-sub">${esc(sub)}</span></a>
    </div>`;
  }).join('');
  return `<div class="dt" role="group" aria-label="Mind map of ${esc(project.name)} with ${decks.length} deck${decks.length === 1 ? '' : 's'}">
    <svg class="dt-links" aria-hidden="true"></svg>
    <div class="dt-root"><span>${esc(project.name)}</span></div>
    <div class="dt-rows">${rows}</div>
  </div>`;
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
    <div class="dt-root"><span>${esc(deck.title)}</span></div>
    <div class="dt-rows">${rows}</div>
  </div>`;
}

// Draw the curved branches from the root node to each row node (used by both maps).
export function drawTree(scope) {
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
      return `<path class="${[...row.classList].filter((c) => c.startsWith('s-')).join(' ')}" d="M${x0} ${y0} C${mid} ${y0} ${mid} ${y1} ${x1} ${y1}"/>`;
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
