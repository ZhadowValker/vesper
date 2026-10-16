import { store } from '../store.js';
import { STAGES, SLIDES, deckStatus, atSelah } from '../framework.js';
import { esc, ask, $, formatDate } from '../util.js';
import { go, rerender } from '../nav.js';

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
    return `<div class="soft">
      <p class="sub">Continue</p>
      <p style="font-weight:500">${esc(last.title)}</p>
      <p class="sub" style="margin-bottom:8px">${esc(project ? project.name : '')} · ${esc(st.label)}, slide ${last.slide + 1} of ${SLIDES.length}</p>
      <div class="bar" style="margin-bottom:10px"><i style="width:${st.pct}%"></i></div>
      <a class="btn block" href="#/d/${last.id}/s/${last.slide}">Resume</a>
    </div>`;
  })() : '';

  const banner = selahCount
    ? `<div class="banner"><span aria-hidden="true">⏸</span><div><strong style="font-weight:500">${selahCount} deck${selahCount === 1 ? '' : 's'} paused at Selah</strong><br><span style="font-size:13px">Answer to move ${selahCount === 1 ? 'it' : 'them'} on</span></div></div>`
    : '';

  const projectCards = projects.map((p) => {
    const ds = store.decksOf(p.id);
    const fin = ds.filter((d) => d.finished).length;
    const pct = ds.length ? Math.round(ds.reduce((n, d) => n + deckStatus(d).pct, 0) / ds.length) : 0;
    return `<a class="item" href="#/p/${p.id}">
      <div class="row between"><span class="t">${esc(p.name)}</span><span class="sub">${ds.length} deck${ds.length === 1 ? '' : 's'}${fin ? `, ${fin} finished` : ''}</span></div>
      <div class="bar" style="margin-top:8px"><i style="width:${pct}%"></i></div>
    </a>`;
  }).join('');

  const empty = `<div class="card empty">
    <h2>Start your first project</h2>
    <p class="muted" style="margin-bottom:14px">A project holds decks. Each deck walks one task from vision to review.</p>
    <button class="btn primary" data-act="new-project">New project</button>
  </div>`;

  const html = `<div class="page stack">
    <div class="top" style="margin-bottom:0">
      <div class="grow"><h1>Vesper</h1><p class="sub">Vision, Research, Plan, Execute, Review</p></div>
      <button class="btn small" data-act="new-project">+ Project</button>
    </div>
    ${projects.length ? '' : empty}
    ${cont}
    ${banner}
    ${projects.length ? `<div class="grid2">
      <div class="metric"><div class="l">Active decks</div><div class="n">${active.length}</div></div>
      <div class="metric"><div class="l">At Selah</div><div class="n">${selahCount}</div></div>
      <div class="metric"><div class="l">Finished</div><div class="n">${decks.length - active.length}</div></div>
      <div class="metric"><div class="l">Loops so far</div><div class="n">${loops}</div></div>
    </div>
    <p class="section">Where decks are now</p>
    <div class="stack" style="gap:6px">${spread.map(({ s, n }) => `<div class="spread"><span class="lab">${s.name}</span><div class="bar ${s.tone === 'do' ? 'do' : ''}"><i style="width:${Math.round((n / max) * 100)}%"></i></div><span class="num">${n}</span></div>`).join('')}</div>
    <p class="section">Your projects</p>
    <div class="list">${projectCards}</div>` : ''}
    <p class="section">Backup</p>
    <div class="footer-tools">
      <button class="btn small" data-act="export">Export backup</button>
      <button class="btn small" data-act="import">Import backup</button>
      <input type="file" accept="application/json,.json" id="import-file" hidden>
    </div>
    <p class="sub">Everything is stored on this device only. Export a backup to move it elsewhere.</p>
  </div>`;

  function mount(root) {
    root.addEventListener('click', onClick);
    const file = $('#import-file', root);
    if (file) file.addEventListener('change', onFile);
    return () => root.removeEventListener('click', onClick);

    function onClick(e) {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'new-project') {
        const name = ask('Project name');
        if (name) go(`#/p/${store.addProject(name).id}`);
      } else if (act === 'export') {
        const blob = new Blob([store.exportJSON()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `vesper-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      } else if (act === 'import') {
        $('#import-file', root).click();
      }
    }

    function onFile(e) {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      f.text().then((text) => {
        if (!window.confirm('Importing replaces everything on this device. Continue?')) return;
        try { store.importJSON(text); rerender(); } catch (err) { window.alert(err.message); }
      });
    }
  }

  return { html, mount };
}
