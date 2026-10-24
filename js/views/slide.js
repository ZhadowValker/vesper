import { store } from '../store.js';
import {
  CONFIG, STAGES, SLIDES, firstSlideOf, selahIndex, tickKey, stagePending, subDone, slideIndex,
} from '../framework.js';
import { esc, $, formatDate, ICON } from '../util.js';
import { go, rerender } from '../nav.js';
import { stageBar } from './parts.js';
import { aiReady } from '../ai/settings.js';
import { draftDialog, reviewDialog } from '../ai/ui.js';

export function slideView(deckId, nStr) {
  const deck = store.deck(deckId);
  if (!deck) return { html: notFound() };
  const n = Math.min(Math.max(parseInt(nStr, 10) || 0, 0), SLIDES.length - 1);
  const slide = SLIDES[n];
  deck.slide = n;
  deck.reached = Math.max(deck.reached, n);
  store.save(deck);
  const project = store.project(deck.projectId);
  const last = SLIDES.length - 1;

  const html = `<div class="player">
    <div class="head">
      <a class="back" href="#/d/${deck.id}" aria-label="Back to task">${ICON.back}</a>
      <div class="meta">${esc(deck.title)}${project ? ', ' + esc(project.name) : ''}</div>
    </div>
    ${stageBar(n)}
    ${body(deck, slide, project)}
    <div class="nav no-print">
      <button class="btn" data-nav="prev" aria-label="Previous slide" ${n === 0 ? 'disabled' : ''}>${ICON.back}</button>
      <span class="count">${n + 1} of ${SLIDES.length}</span>
      <button class="btn" data-nav="next" aria-label="Next slide" ${n === last ? 'disabled' : ''}>${ICON.next}</button>
    </div>
  </div>`;

  function mount(root) {
    let timerId = null;
    let touchX = null;
    let touchY = null;

    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchend', onTouchEnd, { passive: true });
    document.addEventListener('keydown', onKey);
    if (slide.type === 'sub' && slide.sub.timer) startTicker();
    // Note boxes grow with their text so long notes are never clipped.
    const fit = (t) => { t.style.height = 'auto'; t.style.height = `${t.scrollHeight + 2}px`; };
    const fitAll = () => root.querySelectorAll('textarea').forEach(fit);
    fitAll();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitAll);

    return () => {
      root.removeEventListener('click', onClick);
      root.removeEventListener('change', onChange);
      root.removeEventListener('input', onInput);
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('keydown', onKey);
      if (timerId) clearInterval(timerId);
    };

    function goSlide(i) {
      if (i < 0 || i > last) return;
      go(`#/d/${deck.id}/s/${i}`);
    }

    function onKey(e) {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      if (e.key === 'ArrowRight') goSlide(n + 1);
      else if (e.key === 'ArrowLeft') goSlide(n - 1);
    }

    function onTouchStart(e) {
      const t = e.changedTouches[0];
      touchX = t.clientX;
      touchY = t.clientY;
    }

    function onTouchEnd(e) {
      if (touchX === null) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchX;
      const dy = t.clientY - touchY;
      touchX = null;
      if (e.target.closest('textarea, input, button, a')) return;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) goSlide(dx < 0 ? n + 1 : n - 1);
    }

    function onChange(e) {
      const box = e.target.closest('[data-tick]');
      if (!box) return;
      deck.ticks[box.dataset.tick] = box.checked;
      store.save(deck);
    }

    function onInput(e) {
      const area = e.target.closest('[data-note]');
      if (!area) return;
      fit(area);
      deck.notes[area.dataset.note] = area.value;
      store.save(deck);
    }

    function onClick(e) {
      const el = e.target.closest('[data-nav],[data-selah],[data-loop],[data-act]');
      if (!el) return;
      if (el.dataset.nav) {
        goSlide(el.dataset.nav === 'next' ? n + 1 : n - 1);
      } else if (el.dataset.selah) {
        onSelah(el.dataset.selah);
      } else if (el.dataset.loop) {
        onLoop(el.dataset.loop);
      } else if (el.dataset.act === 'finish') {
        deck.finished = Date.now();
        store.save(deck);
        rerender();
      } else if (el.dataset.act === 'reopen') {
        deck.finished = null;
        store.save(deck);
        rerender();
      } else if (el.dataset.act === 'ai-draft') {
        draftDialog(deck, slide);
      } else if (el.dataset.act === 'ai-review') {
        reviewDialog(deck, slide.stage);
      } else if (el.dataset.act === 'print') {
        window.print();
      } else if (el.dataset.act === 'timer-start') {
        const minutes = Math.max(1, Math.min(600, parseInt($('#tmin', root).value, 10) || 15));
        deck.timer = { minutes, endAt: Date.now() + minutes * 60000 };
        deck.ticks[tickKey(slide.stage, slide.sub, 0)] = true;
        store.save(deck);
        rerender();
      } else if (el.dataset.act === 'timer-clear') {
        deck.timer = null;
        store.save(deck);
        rerender();
      }
    }

    function onSelah(choice) {
      const stage = slide.stage;
      const pending = stagePending(deck, stage);
      if (choice === 'not') {
        const firstOpen = stage.subs.find((sub) => !subDone(deck, stage, sub));
        goSlide(firstOpen ? slideIndex(`${stage.id}.${firstOpen.id}`) : firstSlideOf(stage.id));
        return;
      }
      if (!CONFIG.softSelah && pending > 0) {
        const msg = $('#selah-msg', root);
        if (msg) {
          msg.hidden = false;
          msg.textContent = `Tick the ${pending} remaining step${pending === 1 ? '' : 's'} first.`;
        }
        return;
      }
      deck.selah[stage.id] = true;
      store.save(deck);
      goSlide(n + 1);
    }

    function onLoop(target) {
      const key = tickKey(slide.stage, slide.sub, 0);
      deck.ticks[key] = true;
      if (target === 'none') {
        store.save(deck);
        goSlide(n + 1);
        return;
      }
      const from = STAGES.findIndex((s) => s.id === target);
      for (let i = from; i < STAGES.length; i++) delete deck.selah[STAGES[i].id];
      deck.loops += 1;
      deck.passes += 1;
      deck.finished = null;
      store.save(deck);
      goSlide(firstSlideOf(target));
    }

    function startTicker() {
      const out = $('#tleft', root);
      const paint = () => {
        if (!out) return;
        if (!deck.timer) { out.textContent = 'Not started'; return; }
        const ms = deck.timer.endAt - Date.now();
        if (ms <= 0) { out.textContent = 'Time is up'; return; }
        const s = Math.ceil(ms / 1000);
        out.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      };
      paint();
      timerId = setInterval(paint, 1000);
    }
  }

  return { html, mount };
}

function body(deck, slide, project) {
  if (slide.type === 'cover') return cover(deck, project);
  if (slide.type === 'sub') return sub(deck, slide);
  if (slide.type === 'selah') return selah(deck, slide);
  return recap(deck, project);
}

function cover(deck, project) {
  return `<div class="slide center">
    <div class="orb" aria-hidden="true"><img src="img/selah.webp" alt="" width="168" height="168"></div>
    <h1 class="cover-t">${esc(deck.title)}</h1>
    <p class="lead">${esc(project ? project.name : '')}</p>
    <p class="lead">Five stages, each ending in a Selah pause. ${SLIDES.length} slides.</p>
    <div class="btns"><button class="btn primary" data-nav="next">Begin</button></div>
  </div>`;
}

function sub(deck, slide) {
  const { stage, sub: s } = slide;
  const steps = s.steps.map((text, i) => {
    const k = tickKey(stage, s, i);
    const nk = `${slide.key}#${i}`;
    return `<li><label><input type="checkbox" data-tick="${k}" ${deck.ticks[k] ? 'checked' : ''}><span>${esc(text)}</span></label>
      <textarea class="step-note" rows="2" data-note="${nk}" aria-label="Note for: ${esc(text)}" placeholder="Add a note">${esc(deck.notes[nk] || '')}</textarea></li>`;
  }).join('');

  let extra = '';
  if (s.timer) {
    extra = `<div class="timer no-print">
      <label>Minutes <input id="tmin" type="number" min="1" max="600" value="${deck.timer ? deck.timer.minutes : 15}"></label>
      <button class="btn small" data-act="timer-start">${deck.timer ? 'Restart' : 'Start'}</button>
      ${deck.timer ? '<button class="btn small" data-act="timer-clear">Clear</button>' : ''}
      <span class="left" id="tleft" aria-live="off"></span>
    </div>`;
  }
  if (s.loop) {
    const earlier = STAGES.filter((st) => st.id !== 'review');
    extra = `<div class="loops no-print">
      ${earlier.map((st) => `<button class="btn small" data-loop="${st.id}">Revisit ${st.name}</button>`).join('')}
      <button class="btn small primary" data-loop="none">No loop needed</button>
    </div>`;
  }

  return `<div class="slide s-${stage.id}">
    <div><span class="chip s-${stage.id}">${stage.name} ${slide.n} of ${stage.subs.length}</span></div>
    <div><h1>${esc(s.name)}</h1><p class="lead">${esc(s.what)}</p></div>
    <ul class="steps">${steps}</ul>
    ${aiReady() ? '<div class="no-print"><button class="btn small ai-btn" data-act="ai-draft">Help me with this</button></div>' : ''}
    ${extra}
    <label class="notes">Notes for this slide<textarea data-note="${slide.key}" placeholder="Write here">${esc(deck.notes[slide.key] || '')}</textarea></label>
  </div>`;
}

function selah(deck, slide) {
  const { stage } = slide;
  const pending = stagePending(deck, stage);
  const passed = !!deck.selah[stage.id];
  return `<div class="slide center s-${stage.id}">
    <div class="orb" aria-hidden="true"><img src="img/selah.webp" alt="" width="168" height="168"></div>
    <p class="selah-word">Selah</p>
    <span class="chip s-${stage.id}">${stage.name}, pause and check</span>
    <p class="q">${esc(stage.selah)}</p>
    ${pending > 0 ? `<p class="hint">${pending} step${pending === 1 ? '' : 's'} not ticked yet.</p>` : ''}
    <p class="hint" id="selah-msg" hidden></p>
    ${passed ? '<p class="lead">You already continued from here.</p>' : ''}
    <div class="btns">
      <button class="btn" data-selah="not">Not yet</button>
      <button class="btn primary" data-selah="ok">Continue</button>
    </div>
    ${aiReady() ? '<div class="no-print"><button class="btn small ai-btn" data-act="ai-review">Review this stage</button></div>' : ''}
  </div>`;
}

function recap(deck, project) {
  const sections = STAGES.map((st) => {
    const parts = st.subs.map((s) => {
      const key = `${st.id}.${s.id}`;
      const v = (deck.notes[key] || '').trim();
      const stepNotes = s.steps.map((text, i) => {
        const sv = (deck.notes[`${key}#${i}`] || '').trim();
        return sv ? `<p class="sub step-q">${esc(text)}</p><pre>${esc(sv)}</pre>` : '';
      }).join('');
      return v || stepNotes ? `<h3>${esc(s.name)}</h3>${stepNotes}${v ? `<pre>${esc(v)}</pre>` : ''}` : '';
    }).join('');
    return parts ? `<div><span class="chip s-${st.id}">${st.name}</span>${parts}</div>` : '';
  }).join('');

  return `<div class="slide recap">
    <div><span class="chip do">Recap</span></div>
    <div><h1>${esc(deck.title)}</h1><p class="lead">${esc(project ? project.name : '')}, started ${esc(formatDate(deck.created))}${deck.finished ? `, finished ${esc(formatDate(deck.finished))}` : ''}</p></div>
    <p class="lead">${deck.passes} pass${deck.passes === 1 ? '' : 'es'}, ${deck.loops} loop${deck.loops === 1 ? '' : 's'} back.</p>
    ${sections || '<p class="muted">No notes written yet. Notes you add on each slide appear here.</p>'}
    <div class="row wrap no-print">
      ${deck.finished ? '<button class="btn" data-act="reopen">Reopen</button>' : '<button class="btn primary" data-act="finish">Mark finished</button>'}
      <button class="btn" data-act="print">Print summary</button>
      <a class="btn" href="#/p/${deck.projectId}">Back to project</a>
    </div>
  </div>`;
}

function notFound() {
  return `<div class="page"><div class="card empty"><h2>Task not found</h2><p class="muted lead-gap">It may have been deleted.</p><a class="btn" href="#/">Back to dashboard</a></div></div>`;
}
