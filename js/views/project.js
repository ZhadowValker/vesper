import { store } from '../store.js';
import { deckStatus, atSelah } from '../framework.js';
import { esc, ask } from '../util.js';
import { projectMap, mapLegend } from '../mindmaps.js';
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
      <div class="row between"><span class="t">${esc(d.title)}</span><span class="chip ${st.tone}">${esc(st.label)}</span></div>
      <div class="bar ${st.tone === 'do' ? 'do' : ''}" style="margin-top:8px"><i style="width:${st.pct}%"></i></div>
    </a>`;
  }).join('');

  const html = `<div class="page stack">
    <div class="top" style="margin-bottom:0">
      <a class="back" href="#/" aria-label="Back to dashboard">←</a>
      <div class="grow"><h1>${esc(project.name)}</h1><p class="sub">Project</p></div>
      <button class="btn small" data-act="new-deck">+ Deck</button>
    </div>
    <div class="row" style="flex-wrap:wrap">
      <span class="chip">${decks.length} deck${decks.length === 1 ? '' : 's'}</span>
      ${finished ? `<span class="chip do">${finished} finished</span>` : ''}
      ${selah ? `<span class="chip think">${selah} at Selah</span>` : ''}
    </div>
    <div class="card">${projectMap(project, decks)}${decks.length ? mapLegend('Finished', 'In progress', 'Not started') : ''}</div>
    ${decks.length ? `<p class="section">Decks</p><div class="list">${list}</div>` : ''}
    <div class="footer-tools"><button class="btn small danger" data-act="delete-project">Delete project</button></div>
  </div>`;

  function mount(root) {
    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
    function onClick(e) {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      if (btn.dataset.act === 'new-deck') {
        const title = ask('Deck name (one task)');
        if (title) go(`#/d/${store.addDeck(id, title).id}`);
      } else if (btn.dataset.act === 'delete-project') {
        if (window.confirm(`Delete "${project.name}" and its ${decks.length} deck${decks.length === 1 ? '' : 's'}?`)) {
          store.removeProject(id);
          go('#/');
        }
      }
    }
  }
  return { html, mount };
}

function notFound() {
  return `<div class="page"><div class="card empty"><h2>Project not found</h2><p class="muted" style="margin-bottom:14px">It may have been deleted.</p><a class="btn" href="#/">Back to dashboard</a></div></div>`;
}
