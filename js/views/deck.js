import { store } from '../store.js';
import { SLIDES, deckStatus, atSelah, slideFor, slidesFor, slidePosition, setTaskMode, isQuick } from '../framework.js';
import { esc, confirmBox, notice, ICON } from '../util.js';
import { deckMap, mapLegend, drawTree } from '../mindmaps.js';
import { go, rerender } from '../nav.js';
import { finishInApp } from './task-actions.js';
import { isFinishedEarly } from '../task-status.js';
import { bindOrganize } from './organize-ui.js';
import { applyActions } from '../ai/agent.js';
import { resumeButton, stageBar, taskChips } from './parts.js';
import { PRIORITIES, setProjectMeta } from '../task-meta.js';
import { openChatPanel } from '../ai/panel.js';
import { exportDialog, calendarDialog } from '../connect-ui.js';
import { taskListHTML, bindTaskList, addTaskDialog } from './model-ui.js';

export function deckView(id) {
  const deck = store.deck(id);
  if (!deck) return { html: notFound() };
  const project = store.project(deck.projectId);
  const st = deckStatus(deck);
  const slide = slideFor(deck);

  let now;
  if (deck.finished) now = isFinishedEarly(deck) ? 'Finished early' : 'Finished';
  else if (slide.type === 'cover') now = deck.reached === 0 ? 'Not started' : 'At the cover';
  else if (slide.type === 'recap') now = 'Recap';
  else if (slide.type === 'selah') now = `${slide.stage.name}, Selah${atSelah(deck) ? ' (waiting)' : ''}`;
  else now = `${slide.stage.name}, ${slide.type === 'quick' ? 'Quick notes' : slide.sub.name}`;

  const html = `<div class="page stack">
    <div class="top">
      <a class="back" href="#/p/${deck.projectId}" aria-label="Back to project">${ICON.back}</a>
      <div class="grow"><h1>${esc(deck.title)}</h1><p class="sub">${esc(project ? project.name : '')}${deck.passes > 1 ? `, pass ${deck.passes}` : ''}</p></div>
    </div>
    ${taskChips(deck)}
    <form class="card task-meta-form" data-task-meta>
      <h2>Project details</h2>
      <div class="row wrap">
        <label>Priority<select name="priority"><option value="">No priority</option>${PRIORITIES.map((p) => `<option value="${p}" ${deck.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
        <label>Due date<input name="due" type="date" min="0001-01-01" max="9999-12-31" value="${esc(deck.due || '')}"></label>
      </div>
      <label class="row"><input type="checkbox" name="parked" role="switch" ${deck.parked === true ? 'checked' : ''}>Parked</label>
      <button class="btn small primary" type="submit">Save details</button>
      <p class="sub">Choose no priority or clear the date to remove it.</p>
    </form>
    <form class="card task-meta-form" data-move-task>
      <label>Area<select name="project">${store.areas().map((p) => `<option value="${esc(p.id)}" ${p.id === deck.areaId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <div class="row wrap"><button class="btn small" type="submit">Move Project</button><button class="btn small" type="button" data-organize="rename" data-kind="tasks" data-item="${esc(id)}" data-name="${esc(deck.title)}">Rename Project</button></div>
    </form>
    <div class="card now-card">
      <div class="now-text"><p class="sub">Now</p><p class="now-t">${esc(now)}</p><p class="sub">Slide ${slidePosition(deck) + 1} of ${slidesFor(deck).length}</p>${stageBar(deck.slide, deck)}</div>
      ${resumeButton(deck, project, 'block')}
    </div>
    <h2 class="section">Mind map</h2>
    <div class="card">${deckMap(deck)}${mapLegend('Done', 'Current', 'Not yet')}<p class="sub map-note">Tap any name to jump to that slide. Selah is the pause at the end of each stage.</p></div>
    ${taskListHTML('project', id)}
    <div class="row wrap"><button class="btn" data-act="add-simple-task">Add task</button><button class="btn" data-act="demote-project">Make this a task</button></div>
    <div class="footer-tools"><button class="btn small" data-act="${deck.finished ? 'reopen' : 'finish'}">${deck.finished ? 'Reopen' : 'Finish'}</button><button class="btn small" data-act="calendar">Add to calendar</button><button class="btn small" data-act="export">Send elsewhere</button><button class="btn small danger" data-act="delete-deck">Delete Project</button></div>
  </div>`;

  function mount(root) {
    root.addEventListener('click', onClick);
    const stopTasks = bindTaskList(root);
    const stopOrganize = bindOrganize(root);
    const moveForm = root.querySelector('[data-move-task]');
    function moveTask(e) {
      e.preventDefault();
      const result = applyActions([{ type: 'move_task', task: id, project: new FormData(moveForm).get('project') }]);
      if (result.skipped.length) notice('Could not move task', result.skipped.join(' '));
      else rerender();
    }
    moveForm.addEventListener('submit', moveTask);
    const stopDetails = bindTaskDetails(root, deck);
    const stopTree = drawTree(root);
    const here = root.querySelector('.dt-chip.now');
    if (here && here.scrollIntoView) here.scrollIntoView({ block: 'center', behavior: 'auto' });
    return () => { root.removeEventListener('click', onClick); stopDetails(); stopTasks(); moveForm.removeEventListener('submit', moveTask); stopOrganize(); stopTree(); };
    async function onClick(e) {
      if (e.target.closest('[data-act="add-simple-task"]')) { await addTaskDialog({ kind: 'project', id }); rerender(); return; }
      if (e.target.closest('[data-act="demote-project"]')) {
        if (!(await confirmBox('Make this a task?', 'Only an empty flow can become a Task. Any contained tasks move to its Area.', { ok: 'Make this a task', danger: false }))) return;
        try { store.demoteProject(id); go(`#/p/${deck.areaId}`); } catch (error) { notice('Could not make Task', error.message); }
        return;
      }
      const statusBtn = e.target.closest('[data-act="finish"],[data-act="reopen"]');
      if (statusBtn) {
        if (statusBtn.dataset.act === 'finish') { if (!(await finishInApp(deck))) return; }
        else { deck.finished = null; deck.finishedEarly = null; }
        store.save(deck); rerender(); return;
      }
      const chatBtn = e.target.closest('[data-act="ai-chat"]');
      if (chatBtn) { openChatPanel({ focusId: id }); return; }
      const other = e.target.closest('[data-act="calendar"],[data-act="export"]');
      if (other) { if (other.dataset.act === 'calendar') calendarDialog(deck); else exportDialog({ deck, project }); return; }
      const btn = e.target.closest('[data-act="delete-deck"]');
      if (!btn) return;
      const yes = await confirmBox(`Delete "${deck.title}"?`, 'Its flow notes and progress are deleted too. Its simple Tasks move to Inbox. You can\'t undo it.');
      if (yes) { store.removeDeck(id); go(`#/p/${deck.projectId}`); }
    }
  }
  return { html, mount };
}

export function bindTaskDetails(root, deck) {
  const form = root.querySelector('[data-task-meta]');
  function saveDetails(e) {
    e.preventDefault();
    const data = new FormData(form);
    const patch = { priority: data.get('priority') || null, due: data.get('due') || null };
    // Guard also keeps external callers using the older details form compatible.
    if (form.querySelector('[name=parked]')) patch.parked = data.get('parked') !== null;
    const error = setProjectMeta(deck, patch);
    if (error) { notice('Could not save task details', error); return; }
    store.save(deck); rerender();
  }
  form.addEventListener('submit', saveDetails);
  return () => { form.removeEventListener('submit', saveDetails); };
}

function notFound() {
  return `<div class="page"><div class="card empty"><h2>Project not found</h2><p class="muted lead-gap">It may have been deleted.</p><a class="btn" href="#/">Back to dashboard</a></div></div>`;
}
