import { store } from '../store.js';
import { SLIDES, deckStatus, atSelah } from '../framework.js';
import { esc } from '../util.js';
import { deckMap, mapLegend } from '../mindmaps.js';
import { go } from '../nav.js';

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
    <div class="top" style="margin-bottom:0">
      <a class="back" href="#/p/${deck.projectId}" aria-label="Back to project">←</a>
      <div class="grow"><h1>${esc(deck.title)}</h1><p class="sub">${esc(project ? project.name : '')}${deck.passes > 1 ? ` · pass ${deck.passes}` : ''}</p></div>
    </div>
    <div class="soft"><p style="font-size:14px">Now: ${esc(now)} <span class="muted">(slide ${deck.slide + 1} of ${SLIDES.length})</span></p></div>
    <div class="card">${deckMap(deck)}${mapLegend('Done', 'Current', 'Not yet')}<p class="sub" style="margin-top:6px">S marks the Selah pause. Tap any chip to jump to that slide.</p></div>
    <a class="btn primary block" href="#/d/${deck.id}/s/${deck.slide}">${deck.reached === 0 && !deck.finished ? 'Begin' : deck.finished ? 'Open recap' : `Resume at slide ${deck.slide + 1}`}</a>
    <div class="footer-tools"><button class="btn small danger" data-act="delete-deck">Delete deck</button></div>
  </div>`;

  function mount(root) {
    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
    function onClick(e) {
      const btn = e.target.closest('[data-act="delete-deck"]');
      if (!btn) return;
      if (window.confirm(`Delete deck "${deck.title}"?`)) {
        store.removeDeck(id);
        go(`#/p/${deck.projectId}`);
      }
    }
  }
  return { html, mount };
}

function notFound() {
  return `<div class="page"><div class="card empty"><h2>Deck not found</h2><p class="muted" style="margin-bottom:14px">It may have been deleted.</p><a class="btn" href="#/">Back to dashboard</a></div></div>`;
}
