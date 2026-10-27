import { store } from '../store.js';
import { STAGES, SLIDES, deckStatus, atSelah } from '../framework.js';
import { esc, ask, confirmBox, notice, ICON, $ } from '../util.js';
import { go, rerender } from '../nav.js';
import { resumeButton, stageBar } from './parts.js';
import { buildSample } from '../sample.js';
import { showGuide, guideSeen } from '../guide.js';
import { openChatPanel } from '../ai/panel.js';
import { syncDialog } from '../connect-ui.js';
import { accountButton, maybeFirstLogin } from '../account.js';
import { syncReady } from '../sync.js';

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
      <p class="sub hero-s">${esc(st.label)}, slide ${last.slide + 1} of ${SLIDES.length}, ${st.pct}% done</p>
      ${stageBar(last.slide)}
      ${resumeButton(last, project, 'block', 'tree')}
    </div>`;
  })() : '';

  const banner = selahCount
    ? `<button type="button" class="banner banner-btn" data-metric="selah"><span aria-hidden="true">${ICON.star}</span><div><strong style="font-weight:500">${selahCount} task${selahCount === 1 ? '' : 's'} paused at Selah</strong><br><span style="font-size:13px">Tap to see ${selahCount === 1 ? 'it' : 'them'} and move on</span></div></button>`
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
      <button class="icon-btn ai-set" data-act="ai" aria-label="Open the AI assistant">AI</button>
      <button class="icon-btn" data-act="guide" aria-label="How to use Vesper">?</button>
      <button class="btn small" data-act="new-project">${ICON.plus}Project</button>
      ${accountButton()}
    </div>
    <div class="col">
      ${projects.length ? '' : `<div class="o1">${empty}</div>`}
      ${cont ? `<div class="o1">${cont}</div>` : ''}
      ${banner ? `<div class="o2">${banner}</div>` : ''}
      ${projects.length ? `<div class="o5 stack"><h2 class="section">Your projects</h2><div class="list">${projectCards}</div></div>` : ''}
    </div>
    <div class="col">
      ${projects.length ? `<div class="o3 grid2">
        <button type="button" class="metric" data-metric="active"><div class="l">Active tasks</div><div class="n">${active.length}</div></button>
        <button type="button" class="metric" data-metric="selah"><div class="l">At Selah</div><div class="n">${selahCount}</div></button>
        <button type="button" class="metric" data-metric="finished"><div class="l">Finished</div><div class="n">${decks.length - active.length}</div></button>
        <button type="button" class="metric" data-metric="loops"><div class="l">Loops so far</div><div class="n">${loops}</div></button>
      </div>
      <div class="o4 card stack tight">
        <h2>Where tasks are now</h2>
        ${spread.map(({ s, n }) => `<button type="button" class="spread spread-btn" data-metric="stage:${s.id}" aria-label="${s.name}: ${n} task${n === 1 ? '' : 's'}"><span class="lab">${s.name}</span><div class="bar s-${s.id}"><i style="width:${Math.round((n / max) * 100)}%"></i></div><span class="num">${n}</span></button>`).join('')}
      </div>` : ''}
      <div class="o6 stack tight">
        <h2 class="section">Backup</h2>
        <div class="footer-tools">
          <button class="btn small" data-act="export">Export backup</button>
          <button class="btn small" data-act="import">Import backup</button>
          <button class="btn small" data-act="sample">Sample</button>
          <button class="btn small" data-act="sync">${syncReady() ? 'Sync: on' : 'Sync and Claude'}</button>
          <input type="file" accept="application/json,.json" id="import-file" hidden>
        </div>
        <p class="sub">Everything is stored on this device unless you turn on Sync. Export a backup to move it elsewhere. Sample adds a book-writing project you can open, edit or delete.</p>
      </div>
    </div>
  </div>`;

  function mount(root) {
    root.addEventListener('click', onClick);
    maybeFirstLogin().then(() => { if (!guideSeen()) return showGuide().then((r) => { if (r === 'sample') openSample(); }); });
    const file = $('#import-file', root);
    if (file) file.addEventListener('change', onFile);
    return () => root.removeEventListener('click', onClick);

    // Tap a number to see the tasks behind it.
    function showList(kind) {
      const all = store.allDecks();
      const sets = {
        active: ['Active tasks', all.filter((d) => !d.finished), 'No active tasks.'],
        selah: ['At Selah', all.filter(atSelah), 'Nothing is waiting at a Selah.'],
        finished: ['Finished', all.filter((d) => d.finished), 'No finished tasks yet.'],
        loops: ['Loops so far', all.filter((d) => d.loops > 0), 'No task has looped back yet.'],
      };
      if (kind.startsWith('stage:')) {
        const st = STAGES.find((x) => x.id === kind.slice(6));
        sets[kind] = [st ? st.name : 'Stage', all.filter((d) => !d.finished && deckStatus(d).stageId === kind.slice(6)), 'No tasks are in this stage.'];
      }
      const [title, list, none] = sets[kind];
      const sorted = [...list].sort((a, b) => b.updated - a.updated);
      const rows = sorted.map((d) => {
        const p = store.project(d.projectId);
        const st = deckStatus(d);
        const sub = d.finished ? 'Finished' : atSelah(d) ? `${st.label}, paused at Selah` : st.label === 'Not started' ? 'Not started' : `${st.label}, ${st.pct}%`;
        const extra = kind === 'loops' ? ` · ${d.loops} loop${d.loops === 1 ? '' : 's'}` : '';
        return `<a class="item s-${st.stageId || ''}" href="#/d/${d.id}" data-close>
          <span class="t">${esc(d.title)}</span><span class="sub">${esc(p ? p.name : '')} · ${esc(sub)}${extra}</span></a>`;
      }).join('');
      const dlg = document.createElement('dialog');
      dlg.className = 'modal tasklist';
      dlg.innerHTML = `<div class="tl-head"><h2>${esc(title)}</h2><span class="sub">${list.length}</span></div>
        <div class="tl-body">${rows ? `<div class="list">${rows}</div>` : `<p class="muted">${esc(none)}</p>`}</div>
        <div class="modal-actions"><button type="button" class="btn" data-close>Close</button></div>`;
      document.body.appendChild(dlg);
      const done = () => { dlg.close(); dlg.remove(); };
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(); });
      dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) done(); });
      dlg.showModal();
    }

    function openSample() {
      const have = store.findSample('book');
      go(`#/p/${(have || store.insertSample(buildSample())).id}`);
    }

    function onClick(e) {
      const tile = e.target.closest('[data-metric]');
      if (tile) { showList(tile.dataset.metric); return; }
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
      } else if (act === 'account' || act === 'sync') {
        syncDialog({ onChange: rerender });
      } else if (act === 'sample') {
        openSample();
      } else if (act === 'ai') {
        openChatPanel();
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
