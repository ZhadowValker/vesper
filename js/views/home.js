import { store } from '../store.js';
import { STAGES, SLIDES, deckStatus, atSelah } from '../framework.js';
import { esc, ask, confirmBox, notice, ICON, $ } from '../util.js';
import { go, rerender } from '../nav.js';
import { resumeButton } from './parts.js';
import { buildSample } from '../sample.js';
import { showGuide, guideSeen } from '../guide.js';

export function home() {
  const decks = store.allDecks();
  const active = decks.filter((d) => !d.finished);
  const last = [...active].sort((a, b) => b.updated - a.updated)[0];
  const selahCount = active.filter(atSelah).length;
  const loops = decks.reduce((n, d) => n + d.loops, 0);
  const spread = STAGES.map((s) => ({ s, n: active.filter((d) => deckStatus(d).stageId === s.id).length }));
  const max = Math.max(1, ...spread.map((x) => x.n));
  const projects = store.projects();

  const cont = last ? (() => {
    const st = deckStatus(last);
    const project = store.project(last.projectId);
    return `<div class="soft s-${st.stageId || ''}">
      <p class="sub">${esc(project ? project.name : '')}</p>
      <p class="hero-t">${esc(last.title)}</p>
      <p class="sub hero-s">${esc(st.label)}, slide ${last.slide + 1} of ${SLIDES.length}</p>
      <div class="bar hero-bar"><i style="width:${st.pct}%"></i></div>
      ${resumeButton(last, project, 'block', 'tree')}
    </div>`;
  })() : '';

  const banner = selahCount
    ? `<div class="banner"><span aria-hidden="true">${ICON.star}</span><div><strong style="font-weight:500">${selahCount} task${selahCount === 1 ? '' : 's'} paused at Selah</strong><br><span style="font-size:13px">Answer to move ${selahCount === 1 ? 'it' : 'them'} on</span></div></div>`
    : '';

  const projectCards = projects.map((p) => {
    const ds = store.decksOf(p.id);
    const fin = ds.filter((d) => d.finished).length;
    const pct = ds.length ? Math.round(ds.reduce((n, d) => n + deckStatus(d).pct, 0) / ds.length) : 0;
    return `<a class="item" href="#/p/${p.id}">
      <div class="row between"><span class="t">${esc(p.name)}</span><span class="sub">${ds.length} task${ds.length === 1 ? '' : 's'}${fin ? `, ${fin} finished` : ''}</span></div>
      <div class="bar item-bar"><i style="width:${pct}%"></i></div>
    </a>`;
  }).join('');

  const empty = `<div class="card empty">
    <h2>Start your first project</h2>
    <p class="muted lead-gap">A project holds tasks. Each task walks from vision to review, one slide at a time.</p>
    <div class="row wrap center-row"><button class="btn primary" data-act="new-project">New project</button><button class="btn" data-act="sample">Try the book sample</button></div>
  </div>`;

  const html = `<div class="page stack home">
    <div class="top">
      <div class="grow"><h1>Vesper</h1><p class="sub">Vision, Research, Plan, Execute, Review</p></div>
      <button class="icon-btn" data-act="guide" aria-label="How to use Vesper">?</button>
      <button class="btn small" data-act="new-project">${ICON.plus}Project</button>
    </div>
    <div class="col">
      ${projects.length ? '' : `<div class="o1">${empty}</div>`}
      ${cont ? `<div class="o1">${cont}</div>` : ''}
      ${banner ? `<div class="o2">${banner}</div>` : ''}
      ${projects.length ? `<div class="o5 stack"><h2 class="section">Your projects</h2><div class="list">${projectCards}</div></div>` : ''}
    </div>
    <div class="col">
      ${projects.length ? `<div class="o3 grid2">
        <div class="metric"><div class="l">Active tasks</div><div class="n">${active.length}</div></div>
        <div class="metric"><div class="l">At Selah</div><div class="n">${selahCount}</div></div>
        <div class="metric"><div class="l">Finished</div><div class="n">${decks.length - active.length}</div></div>
        <div class="metric"><div class="l">Loops so far</div><div class="n">${loops}</div></div>
      </div>
      <div class="o4 card stack tight">
        <h2>Where tasks are now</h2>
        ${spread.map(({ s, n }) => `<div class="spread"><span class="lab">${s.name}</span><div class="bar s-${s.id}"><i style="width:${Math.round((n / max) * 100)}%"></i></div><span class="num">${n}</span></div>`).join('')}
      </div>` : ''}
      <div class="o6 stack tight">
        <h2 class="section">Backup</h2>
        <div class="footer-tools">
          <button class="btn small" data-act="export">Export backup</button>
          <button class="btn small" data-act="import">Import backup</button>
          <button class="btn small" data-act="sample">Sample</button>
          <input type="file" accept="application/json,.json" id="import-file" hidden>
        </div>
        <p class="sub">Everything is stored on this device only. Export a backup to move it elsewhere. Sample adds a book-writing project you can open, edit or delete.</p>
      </div>
    </div>
  </div>`;

  function mount(root) {
    root.addEventListener('click', onClick);
    if (!guideSeen()) showGuide().then((r) => { if (r === 'sample') openSample(); });
    const file = $('#import-file', root);
    if (file) file.addEventListener('change', onFile);
    return () => root.removeEventListener('click', onClick);

    function openSample() {
      const have = store.findSample('book');
      go(`#/p/${(have || store.insertSample(buildSample())).id}`);
    }

    function onClick(e) {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'new-project') {
        ask('Name your project', { ok: 'Create project', placeholder: 'Office relocation' }).then((name) => {
          if (name) go(`#/p/${store.addProject(name).id}`);
        });
      } else if (act === 'export') {
        const blob = new Blob([store.exportJSON()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `vesper-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      } else if (act === 'sample') {
        openSample();
      } else if (act === 'guide') {
        showGuide().then((r) => { if (r === 'sample') openSample(); });
      } else if (act === 'import') {
        $('#import-file', root).click();
      }
    }

    function onFile(e) {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      f.text().then(async (text) => {
        const yes = await confirmBox('Replace everything on this device?', 'Importing a backup replaces all projects and tasks stored here.', { ok: 'Import backup', danger: false });
        if (!yes) return;
        try { store.importJSON(text); rerender(); } catch (err) { notice('That file could not be imported', err.message); }
      });
    }
  }

  return { html, mount };
}
