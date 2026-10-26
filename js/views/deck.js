import { store } from '../store.js';
import { SLIDES, deckStatus, atSelah } from '../framework.js';
import { esc, confirmBox, ICON } from '../util.js';
import { deckMap, mapLegend, drawTree } from '../mindmaps.js';
import { go } from '../nav.js';
import { resumeButton, stageBar } from './parts.js';

export function deckView(id) {
  const deck = store.deck(id);
  if (!deck) return { html: notFound() };
  const project = store.project(deck.projectId);
  const st = deckStatus(deck);
  const slide = SLIDES[deck.slide];

  let now;
  if (deck.finished) now = 'Finished';
  else if (slide.type === 'cover') now = deck.reached === 0 ? 'Not started' : 'At the cover';
  else if (slide.type === 'recap') now = 'Recap';
  else if (slide.type === 'selah') now = `${slide.stage.name}, Selah${atSelah(deck) ? ' (waiting)' : ''}`;
  else now = `${slide.stage.name}, ${slide.sub.name}`;

  const html = `<div class="page stack">
    <div class="top">
      <a class="back" href="#/p/${deck.projectId}" aria-label="Back to project">${ICON.back}</a>
      <div class="grow"><h1>${esc(deck.title)}</h1><p class="sub">${esc(project ? project.name : '')}${deck.passes > 1 ? `, pass ${deck.passes}` : ''}</p></div>
    </div>
    <div class="card now-card">
      <div class="now-text"><p class="sub">Now</p><p class="now-t">${esc(now)}</p><p class="sub">Slide ${deck.slide + 1} of ${SLIDES.length}</p>${stageBar(deck.slide)}</div>
      ${resumeButton(deck, project, 'block')}
    </div>
    <h2 class="section">Mind map</h2>
    <div class="card">${deckMap(deck)}${mapLegend('Done', 'Current', 'Not yet')}<p class="sub map-note">Tap any name to jump to that slide. Selah is the pause at the end of each stage.</p></div>
    <div class="footer-tools"><button class="btn small danger" data-act="delete-deck">Delete task</button></div>
  </div>`;

  function mount(root) {
    root.addEventListener('click', onClick);
    const stopTree = drawTree(root);
    const here = root.querySelector('.dt-chip.now');
    if (here && here.scrollIntoView) here.scrollIntoView({ block: 'center', behavior: 'auto' });
    return () => { root.removeEventListener('click', onClick); stopTree(); };
    async function onClick(e) {
      const btn = e.target.closest('[data-act="delete-deck"]');
      if (!btn) return;
      const yes = await confirmBox(`Delete "${deck.title}"?`, 'Its notes and progress are deleted too. You can\'t undo it.');
      if (yes) { store.removeDeck(id); go(`#/p/${deck.projectId}`); }
    }
  }
  return { html, mount };
}

function notFound() {
  return `<div class="page"><div class="card empty"><h2>Task not found</h2><p class="muted lead-gap">It may have been deleted.</p><a class="btn" href="#/overview">Back to overview</a></div></div>`;
}
