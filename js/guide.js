// Welcome guide: a short walkthrough shown the first time Vesper opens, and from the ? button.
import { ICON } from './util.js';

const SEEN = 'vesper.guide.seen';

export function guideSeen() {
  try { return localStorage.getItem(SEEN) === '1'; } catch (e) { return false; }
}
function markSeen() {
  try { localStorage.setItem(SEEN, '1'); } catch (e) { /* storage may be blocked */ }
}

const PAGES = [
  {
    title: 'Welcome to Vesper',
    text: 'A calm way to get any piece of work done, one stage at a time. Every task walks the same five stages, and after each one you pause for Selah: a single question to check before you move on.',
    art: `<div class="g-art g-stages" aria-hidden="true">
      <span class="chip s-vision">Vision</span><span class="chip s-research">Research</span><span class="chip s-plan">Plan</span>
      <span class="chip s-execute">Execute</span><span class="chip s-review">Review</span>
      <span class="g-selah">${ICON.star}Selah after each</span></div>`,
  },
  {
    title: 'How it is organised',
    text: 'A project holds tasks. Each task is a deck of slides that you flip through, one stage after another. The map of a task shows every stage and slide, and Resume takes you back to where you stopped.',
    art: `<div class="g-art g-levels" aria-hidden="true">
      <div class="g-level"><b>Project</b><span>Office move</span></div>${ICON.next}
      <div class="g-level"><b>Task</b><span>Plan it</span></div>${ICON.next}
      <div class="g-level"><b>Slide</b><span>Findings</span></div></div>`,
  },
  {
    title: 'What you do on a slide',
    text: 'Tick each step when it is done and write a note under it. At the end of a stage, answer the Selah question honestly: "Not yet" takes you back, "Continue" moves on. In Review you can loop back to any earlier stage.',
    art: `<div class="g-art g-mock" aria-hidden="true">
      <div class="g-row"><i class="g-tick"></i><span>Note what you learned</span></div>
      <div class="g-note">Readers finish short books.</div>
      <div class="g-row"><i class="g-tick off"></i><span>Note what is still unknown</span></div>
      <div class="g-note faint">Add a note</div></div>`,
  },
  {
    title: 'Ready to begin',
    text: 'Everything is saved on this device only, so use Export backup now and then. Want to see it filled in first? The book-writing sample has four tasks at different points, with every step written out.',
    art: `<div class="g-art g-ready" aria-hidden="true">${ICON.star}</div>`,
  },
];

// Resolves to 'sample', 'start' or 'close'.
export function showGuide() {
  return new Promise((resolve) => {
    let i = 0;
    const dlg = document.createElement('dialog');
    dlg.className = 'modal guide';
    dlg.setAttribute('aria-label', 'How to use Vesper');
    document.body.appendChild(dlg);
    const finish = (v) => { markSeen(); dlg.close(); dlg.remove(); resolve(v); };

    function paint() {
      const p = PAGES[i];
      const last = i === PAGES.length - 1;
      dlg.innerHTML = `<div class="g-body">
        <div class="g-top"><span class="g-count">${i + 1} of ${PAGES.length}</span>${last ? '' : '<button type="button" class="g-skip" data-g="close">Skip</button>'}</div>
        ${p.art}
        <h2>${p.title}</h2>
        <p class="muted g-text">${p.text}</p>
        <div class="g-dots" aria-hidden="true">${PAGES.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
        <div class="modal-actions g-actions">
          ${last
            ? '<button type="button" class="btn" data-g="start">Start on my own</button><button type="button" class="btn primary" data-g="sample">Try the book sample</button>'
            : `${i > 0 ? '<button type="button" class="btn" data-g="back">Back</button>' : ''}<button type="button" class="btn primary" data-g="next">Next</button>`}
        </div></div>`;
      const primary = dlg.querySelector('.btn.primary');
      if (primary) primary.focus();
    }

    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) return finish('close');
      const b = e.target.closest('[data-g]');
      if (!b) return;
      const g = b.dataset.g;
      if (g === 'next') { i = Math.min(i + 1, PAGES.length - 1); paint(); }
      else if (g === 'back') { i = Math.max(i - 1, 0); paint(); }
      else finish(g);
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish('close'); });
    paint();
    dlg.showModal();
  });
}
