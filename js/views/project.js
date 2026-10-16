import { store } from '../store.js';
import { deckStatus, atSelah } from '../framework.js';
import { esc, ask, confirmBox, ICON } from '../util.js';
import { projectMap, mapLegend, drawTree } from '../mindmaps.js';
import { go } from '../nav.js';

export function projectView(id) {
  const project = store.project(id);
  if (!project) return { html: notFound() };
  const decks = store.decksOf(id);
  const finished = decks.filter((d) => d.finished).length;
  const selah = decks.filter(atSelah).length;

  const list = decks.map((d) => {
    const st = deckStatus(d);
    return `<a class="item" href="#/d/${d.id}">
      <div class="row between"><span class="t">${esc(d.title)}</span><span class="chip ${st.stageId ? 's-' + st.stageId : st.tone}">${esc(st.label)}</span></div>
      <div class="bar item-bar ${st.stageId ? 's-' + st.stageId : 'do'}"><i style="width:${st.pct}%"></i></div>
    </a>`;
  }).join('');

  const html = `<div class="page stack">
    <div class="top">
      <a class="back" href="#/" aria-label="Back to dashboard">${ICON.back}</a>
      <div class="grow"><h1>${esc(project.name)}</h1><p class="sub">Project</p></div>
      <button class="btn small" data-act="new-deck">${ICON.plus}Deck</button>
    </div>
    <div class="row wrap">
      <span class="chip">${decks.length} deck${decks.length === 1 ? '' : 's'}</span>
      ${finished ? `<span class="chip do">${finished} finished</span>` : ''}
      ${selah ? `<span class="chip think">${selah} at Selah</span>` : ''}
    </div>
    <div class="card">${projectMap(project, decks)}${decks.length ? mapLegend('Finished', 'In progress', 'Not started') : ''}</div>
    ${decks.length ? `<h2 class="section">Decks</h2><div class="list">${list}</div>` : ''}
    <div class="footer-tools"><button class="btn small danger" data-act="delete-project">Delete project</button></div>
  </div>`;

  function mount(root) {
    root.addEventListener('click', onClick);
    const stopTree = drawTree(root);
    return () => { root.removeEventListener('click', onClick); stopTree(); };
    async function onClick(e) {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      if (btn.dataset.act === 'new-deck') {
        const title = await ask('Name this deck (one task)', { ok: 'Create deck', placeholder: 'Plan the move' });
        if (title) go(`#/d/${store.addDeck(id, title).id}`);
      } else if (btn.dataset.act === 'delete-project') {
        const yes = await confirmBox(`Delete "${project.name}"?`, `This also deletes its ${decks.length} deck${decks.length === 1 ? '' : 's'}. You can't undo it.`);
        if (yes) { store.removeProject(id); go('#/'); }
      }
    }
  }
  return { html, mount };
}

function notFound() {
  return `<div class="page"><div class="card empty"><h2>Project not found</h2><p class="muted lead-gap">It may have been deleted.</p><a class="btn" href="#/">Back to dashboard</a></div></div>`;
}
