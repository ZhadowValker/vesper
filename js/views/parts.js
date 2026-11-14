import { STAGES, SLIDES, firstSlideOf, selahIndex } from '../framework.js';
import { esc } from '../util.js';
import { PRIORITIES, validDue, isOverdue, saveTaskPrefs, getTaskPrefs } from '../task-meta.js';
import { isFinishedEarly } from '../task-status.js';
import { rerender } from '../nav.js';

export function taskChips(deck) {
  const priority = PRIORITIES.includes(deck.priority) ? `<span class="chip priority">${esc(deck.priority)}</span>` : '';
  const due = validDue(deck.due) ? `<span class="chip ${isOverdue(deck) ? 'overdue' : ''}">${isOverdue(deck) ? 'Overdue' : 'Due'} <time datetime="${deck.due}">${deck.due}</time></span>` : '';
  const early = isFinishedEarly(deck) ? '<span class="chip think">finished early</span>' : '';
  return priority || due || early ? `<div class="row wrap task-chips">${priority}${due}${early}</div>` : '';
}

export function taskListControls(prefs) {
  return `<div class="task-controls row wrap">
    <label>Sort tasks<select data-task-sort aria-label="Sort tasks">${[['updated', 'Recently changed'], ['priority', 'Priority'], ['due', 'Due date']].map(([v, label]) => `<option value="${v}" ${prefs.sort === v ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
    <label>Priority filter<select data-task-filter aria-label="Filter by priority">${[['all', 'All priorities'], ...PRIORITIES.map((p) => [p, p]), ['none', 'No priority']].map(([v, label]) => `<option value="${v}" ${prefs.priority === v ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
  </div>`;
}

export function bindTaskListControls(root) {
  const change = (e) => {
    if (!e.target.matches('[data-task-sort],[data-task-filter]')) return;
    const prefs = getTaskPrefs();
    if (e.target.matches('[data-task-sort]')) prefs.sort = e.target.value;
    else prefs.priority = e.target.value;
    saveTaskPrefs(prefs);
    rerender();
  };
  root.addEventListener('change', change);
  return () => root.removeEventListener('change', change);
}

const CHEVRON = '<svg aria-hidden="true" class="crumb-sep" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';

// The name shown on the chip for a slide.
export function slideName(slide) {
  if (slide.type === 'cover') return 'Cover';
  if (slide.type === 'recap') return 'Recap';
  if (slide.type === 'selah') return 'Selah';
  return slide.sub.name;
}

// "Resume" button with the full path underneath: project, deck, chip.
// target 'tree' opens the deck's mind map; 'slide' opens the slide you were on.
export function resumeButton(deck, project, extraClass = '', target = 'slide') {
  const verb = deck.finished ? 'Open recap' : deck.reached === 0 ? 'Begin' : 'Resume';
  const path = [project ? project.name : '', deck.title, slideName(SLIDES[deck.slide])].filter(Boolean).map(esc).join(CHEVRON);
  return `<a class="btn primary resume ${extraClass}" href="${target === 'tree' ? `#/d/${deck.id}` : `#/d/${deck.id}/s/${deck.slide}`}"><span class="resume-v">${verb}</span><span class="resume-p">${path}</span></a>`;
}

// Five segments, one per stage, filled as you move through that stage's slides.
export function stageBar(n) {
  const segs = STAGES.map((st) => {
    const from = firstSlideOf(st.id);
    const to = selahIndex(st.id);
    const w = Math.max(0, Math.min(1, (n - from + 1) / (to - from + 1)));
    return `<span class="s-${st.id}"><i style="width:${Math.round(w * 100)}%"></i></span>`;
  }).join('');
  return `<div class="progress" role="img" aria-label="Slide ${n + 1} of ${SLIDES.length}">${segs}</div>`;
}

// One bar for many tasks: each stage's segment shows how far the tasks have got through that stage, on average.
export function projectBar(decks) {
  if (!decks.length) return `<div class="progress item-bar" role="img" aria-label="No tasks yet">${STAGES.map((st) => `<span class="s-${st.id}"><i style="width:0"></i></span>`).join('')}</div>`;
  const segs = STAGES.map((st) => {
    const from = firstSlideOf(st.id);
    const to = selahIndex(st.id);
    const total = decks.reduce((sum, d) => {
      const n = d.finished ? SLIDES.length : d.reached;
      return sum + Math.max(0, Math.min(1, (n - from + 1) / (to - from + 1)));
    }, 0);
    return `<span class="s-${st.id}"><i style="width:${Math.round((total / decks.length) * 100)}%"></i></span>`;
  }).join('');
  const done = decks.filter((d) => d.finished).length;
  return `<div class="progress item-bar" role="img" aria-label="${decks.length} tasks, ${done} finished">${segs}</div>`;
}
