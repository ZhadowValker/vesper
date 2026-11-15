import { store } from '../store.js';
import { esc, ask, confirmBox, notice, ICON, $ } from '../util.js';
import { go, rerender } from '../nav.js';
import { orderedItems } from '../organize.js';
import { sortFilterTasks, getTaskPrefs, PRIORITIES, validDue, isOverdue } from '../task-meta.js';
import { taskListControls, bindTaskListControls, stageBar } from './parts.js';
import { themeControlHTML, bindThemeControl } from '../theme.js';
import { syncDialog } from '../connect-ui.js';
import { syncReady } from '../sync.js';
import { buildSample } from '../sample.js';

const areaName = (area) => area?.name || area?.title || '';
const listFor = (kind, id) => kind === 'inbox' ? store.tasksAt('inbox') :
  kind === 'area' ? store.tasksAt('area', id) :
    kind === 'project' ? store.tasksAt('project', id) : [];
const byId = (items, id) => items.findIndex((item) => item.id === id);

function areaOptions(selected = '') {
  return orderedItems(store.areas()).map((area) =>
    `<option value="${esc(area.id)}" ${area.id === selected ? 'selected' : ''}>${esc(areaName(area))}</option>`).join('');
}

function locationLabel(location) {
  if (!location || location.kind === 'inbox') return 'Inbox';
  if (location.kind === 'area') return areaName(store.area(location.id)) || 'Area';
  const project = store.flowProject(location.id);
  return project ? project.title : 'Project';
}

function mixedTaskMarkup(task, location) {
  const due = validDue(task.due) ? `<span class="chip ${isOverdue(task) ? 'overdue' : ''}">${isOverdue(task) ? 'Overdue' : 'Due'} <time datetime="${esc(task.due)}">${esc(task.due)}</time></span>` : '';
  const priority = PRIORITIES.includes(task.priority) ? `<span class="chip priority">${esc(task.priority)}</span>` : '';
  const note = task.note ? `<p class="model-task-note">${esc(task.note)}</p>` : '';
  const moves = `<option value="inbox">Inbox</option>${orderedItems(store.areas()).map((a) => `<option value="area:${esc(a.id)}" ${location?.kind === 'area' && location.id === a.id ? 'selected' : ''}>Area · ${esc(areaName(a))}</option>`).join('')}${orderedItems(store.flowProjects()).map((p) => `<option value="project:${esc(p.id)}" ${location?.kind === 'project' && location.id === p.id ? 'selected' : ''}>Project · ${esc(p.title)}</option>`).join('')}`;
  const areaForPromote = task.location?.kind === 'area' ? task.location.id : task.location?.kind === 'project' ? store.flowProject(task.location.id)?.areaId : '';
  return `<article class="model-task ${task.done ? 'is-done' : ''} ${isOverdue(task) ? 'is-overdue' : ''}" data-task-card="${esc(task.id)}">
    <div class="model-task-top">
      <input class="model-task-check" type="checkbox" data-task-done="${esc(task.id)}" aria-label="${task.done ? 'Mark open' : 'Mark done'}: ${esc(task.title)}" ${task.done ? 'checked' : ''}>
      <div class="model-task-copy">
        <div class="model-task-title">${esc(task.title)}</div>
        ${note}
        <div class="model-task-tags">${priority}${due}<span class="model-open-task-link">${esc(locationLabel(task.location))}</span></div>
      </div>
    </div>
    <div class="model-task-actions">
      <button type="button" class="btn small" data-task-edit="${esc(task.id)}">Edit</button>
      <label class="sr-only" for="move-${esc(task.id)}">Move ${esc(task.title)}</label>
      <select id="move-${esc(task.id)}" data-task-move="${esc(task.id)}" aria-label="Move ${esc(task.title)}">${moves}</select>
      <button type="button" class="btn small" data-task-promote="${esc(task.id)}" data-area="${esc(areaForPromote || '')}" ${task.done ? 'disabled title="Done tasks cannot become Projects"' : ''}>Make this a project</button>
      <button type="button" class="btn small danger" data-task-delete="${esc(task.id)}">Delete</button>
    </div>
  </article>`;
}

function taskRows(items, kind, id) {
  const ordered = [...items];
  const prefs = getTaskPrefs();
  return ordered.map((task) => {
    const fullList = orderedItems(listFor(kind, id));
    const at = byId(fullList, task.id);
    const controls = prefs.sort === 'order' ? `<div class="row model-order" aria-label="Reorder Task">
      <button type="button" class="btn small" data-task-order="up" data-task-id="${esc(task.id)}" data-kind="${esc(kind)}" data-location-id="${esc(id || '')}" aria-label="Move ${esc(task.title)} up" ${at === 0 ? 'disabled' : ''}>Up</button>
      <button type="button" class="btn small" data-task-order="down" data-task-id="${esc(task.id)}" data-kind="${esc(kind)}" data-location-id="${esc(id || '')}" aria-label="Move ${esc(task.title)} down" ${at === fullList.length - 1 ? 'disabled' : ''}>Down</button>
    </div>` : '';
    return `${mixedTaskMarkup(task, task.location)}${controls}`;
  }).join('');
}

export function taskListHTML(kind = 'inbox', id = '') {
  const items = listFor(kind, id);
  const prefs = getTaskPrefs();
  const sorted = sortFilterTasks(items, prefs);
  const label = kind === 'inbox' ? 'Inbox tasks' : 'Tasks';
  return `<section class="model-section" data-model-task-list="${esc(kind)}" data-list-id="${esc(id)}">
    <div class="model-section-head"><h2>${label}</h2><span class="model-count">${items.length} ${items.length === 1 ? 'Task' : 'Tasks'}</span></div>
    ${taskListControls(prefs)}
    <div class="model-mixed-list">${sorted.length ? taskRows(sorted, kind, id) : `<div class="model-empty">${items.length ? 'No Tasks match this priority.' : 'Nothing here yet. Leave a Task here when you are ready.'}</div>`}</div>
  </section>`;
}

function projectCardHTML(project, siblingProjects) {
  const tasks = store.tasksAt('project', project.id);
  const idx = siblingProjects.findIndex((x) => x.id === project.id);
  const controls = `<div class="model-project-actions">
    <button type="button" class="btn small" data-project-task="${esc(project.id)}">Add Task</button>
    <button type="button" class="btn small" data-project-order="up" data-project-id="${esc(project.id)}" data-area="${esc(project.areaId)}" aria-label="Move ${esc(project.title)} up" ${idx === 0 ? 'disabled' : ''}>Up</button>
    <button type="button" class="btn small" data-project-order="down" data-project-id="${esc(project.id)}" data-area="${esc(project.areaId)}" aria-label="Move ${esc(project.title)} down" ${idx === siblingProjects.length - 1 ? 'disabled' : ''}>Down</button>
  </div>`;
  return `<article class="model-project-card">
    <div class="model-project-main"><a class="model-project-link" href="#/d/${esc(project.id)}">
      <span class="model-project-kind">Project</span><span class="model-project-title">${esc(project.title)}</span>
      <span class="model-project-sub">${tasks.length} ${tasks.length === 1 ? 'Task' : 'Tasks'}${project.finished ? ' · Finished' : ''}</span>
      ${stageBar(project.finished ? 26 : project.reached || 0, project)}
    </a></div>${controls}
  </article>`;
}

function areaCardHTML(area, areas) {
  const projects = orderedItems(store.projectsIn(area.id));
  const tasks = store.tasksAt('area', area.id);
  const at = areas.findIndex((x) => x.id === area.id);
  return `<div class="model-area-wrap">
    <a class="model-area-card" href="#/p/${esc(area.id)}">
      <span class="model-area-mark" aria-hidden="true"></span><span class="model-kicker">Area</span>
      <h3>${esc(areaName(area))}</h3>
      <p class="model-area-meta">${projects.length} ${projects.length === 1 ? 'Project' : 'Projects'} · ${tasks.length} loose ${tasks.length === 1 ? 'Task' : 'Tasks'}</p>
    </a>
    <div class="model-area-actions">
      <button type="button" class="btn small" data-area-action="rename" data-area-id="${esc(area.id)}" data-area-name="${esc(areaName(area))}">Rename</button>
      <button type="button" class="btn small" data-area-order="up" data-area-id="${esc(area.id)}" aria-label="Move ${esc(areaName(area))} up" ${at === 0 ? 'disabled' : ''}>Up</button>
      <button type="button" class="btn small" data-area-order="down" data-area-id="${esc(area.id)}" aria-label="Move ${esc(areaName(area))} down" ${at === areas.length - 1 ? 'disabled' : ''}>Down</button>
    </div>
  </div>`;
}

function taskOrderControl(task, collection, areaId) {
  if (getTaskPrefs().sort !== 'order') return '';
  const list = orderedItems(collection);
  const at = list.findIndex((item) => item.id === task.id);
  return `<div class="row model-order" aria-label="Reorder Task">
    <button type="button" class="btn small" data-task-order="up" data-task-id="${esc(task.id)}" data-kind="area" data-location-id="${esc(areaId)}" aria-label="Move ${esc(task.title)} up" ${at === 0 ? 'disabled' : ''}>Up</button>
    <button type="button" class="btn small" data-task-order="down" data-task-id="${esc(task.id)}" data-kind="area" data-location-id="${esc(areaId)}" aria-label="Move ${esc(task.title)} down" ${at === list.length - 1 ? 'disabled' : ''}>Down</button>
  </div>`;
}

export function modelHomePanelHTML() {
  return `<section class="model-section model-home-panel">
    <div class="model-section-head"><h2>Preferences &amp; portability</h2><span class="model-count">This device</span></div>
    <div class="model-settings">
      <div><p>Choose your reading light, keep a local backup, or connect Vesper to Sync.</p>${themeControlHTML()}</div>
      <div class="footer-tools">
        <button class="btn small" type="button" data-model-setting="export">Export backup</button>
        <button class="btn small" type="button" data-model-setting="import">Import backup</button>
        <button class="btn small" type="button" data-model-setting="sync">${syncReady() ? 'Sync: on' : 'Sync'}</button>
        <button class="btn small" type="button" data-model-setting="sample">Book sample</button>
        <input type="file" accept="application/json,.json" data-model-import hidden>
      </div>
    </div>
  </section>`;
}

function homeMixedHTML() {
  const entries = [
    ...store.flowProjects().map((project) => ({ ...project, _modelType: 'project', updated: project.updated || project.created })),
    ...store.tasks().map((task) => ({ ...task, _modelType: 'task' })),
  ];
  const sorted = sortFilterTasks(entries, getTaskPrefs());
  const markup = sorted.map((entry) => entry._modelType === 'project'
    ? `<article class="model-project-card"><div class="model-project-main"><a class="model-project-link" href="#/d/${esc(entry.id)}"><span class="model-project-kind">Project · ${esc(areaName(store.area(entry.areaId)))}</span><span class="model-project-title">${esc(entry.title)}</span>${stageBar(entry.finished ? 26 : entry.reached || 0, entry)}</a></div><div class="model-project-actions"><button class="btn small" type="button" data-project-task="${esc(entry.id)}">Add Task</button></div></article>`
    : mixedTaskMarkup(entry, entry.location)).join('');
  return `<section class="model-section">
    <div class="model-section-head"><h2>On the table</h2><span class="model-count">${entries.length} items</span></div>
    ${taskListControls(getTaskPrefs())}
    <div class="model-mixed-list">${markup || `<div class="model-empty">Your plan begins with one small thing. Add a Task or begin a Project.</div>`}</div>
  </section>`;
}

export function modelHome() {
  const areas = orderedItems(store.areas());
  const inbox = store.tasksAt('inbox');
  const resume = store.flowProjects()
    .filter((project) => !project.finished && project.mode !== 'quick')
    .sort((a, b) => (b.updated || b.created || 0) - (a.updated || a.created || 0))[0];
  const html = `<main class="page stack model-page">
    <header class="model-hero">
      <span class="model-kicker">Vesper · a personal planning notebook</span>
      <h1>Make room for what matters.</h1>
      <p>Five stages for the work, Selah pauses for the person doing it. Keep your next step close and let the rest unfold.</p>
      <div class="model-head-actions"><button class="btn primary" type="button" data-model-create>New Task or Project</button><button class="btn" type="button" data-model-add-area>New Area</button></div>
    </header>
    ${resume ? `<section class="model-resume"><div><span class="model-kicker">Pick up where you left off</span><strong>${esc(resume.title)}</strong><span class="sub">${esc(areaName(store.area(resume.areaId)))}</span></div><a class="btn primary" href="#/d/${esc(resume.id)}/s/${Number.isInteger(resume.slide) ? resume.slide : 0}">Resume Project</a></section>` : ''}
    <section class="model-inbox model-section">
      <div class="model-section-head"><div><span class="model-kicker">A quiet landing place</span><h2>Inbox</h2></div><div class="row"><span class="model-count-pill"><i></i>${inbox.length} ${inbox.length === 1 ? 'Task' : 'Tasks'}</span><button class="btn small" type="button" data-model-create-task data-location="inbox">Add Task</button></div></div>
      ${taskListControls(getTaskPrefs())}
      <div class="model-mixed-list">${inbox.length ? taskRows(sortFilterTasks(inbox, getTaskPrefs()), 'inbox', '') : `<div class="model-empty">No loose ends in Inbox. A Task can wait here until it belongs somewhere.</div>`}</div>
    </section>
    ${homeMixedHTML()}
    <section class="model-section">
      <div class="model-section-head"><h2>Your Areas</h2><span class="model-count">${areas.length} ${areas.length === 1 ? 'Area' : 'Areas'}</span></div>
      ${areas.length ? `<div class="model-grid">${areas.map((area) => areaCardHTML(area, areas)).join('')}</div>` : `<div class="model-empty">Create an Area to give your Projects a place to grow.</div>`}
    </section>
    ${modelHomePanelHTML()}
  </main>`;
  return { html, mount(root) {
    return bindModelHomePanel(root);
  } };
}

export function modelArea(areaId) {
  const area = store.area(areaId);
  if (!area) return { html: `<main class="page model-page"><div class="card empty"><h2>Area not found</h2><p class="muted lead-gap">This Area may have been removed.</p><a class="btn" href="#/">Back to Vesper</a></div></main>`, mount() { return () => {}; } };
  const areas = orderedItems(store.areas());
  const projects = orderedItems(store.projectsIn(areaId));
  const looseTasks = store.tasksAt('area', areaId);
  const mixed = [
    ...projects.map((project) => ({ ...project, _modelType: 'project' })),
    ...looseTasks.map((task) => ({ ...task, _modelType: 'task' })),
  ];
  const sortedMixed = sortFilterTasks(mixed, getTaskPrefs());
  const mixedRows = sortedMixed.map((entry) => entry._modelType === 'project'
    ? projectCardHTML(entry, projects)
    : `${mixedTaskMarkup(entry, entry.location)}${taskOrderControl(entry, looseTasks, areaId)}`).join('');
  const html = `<main class="page stack model-page model-area-layout">
    <header class="top model-area-top">
      <a class="back model-back" href="#/" aria-label="Back to Vesper">${ICON.back}</a>
      <div class="grow"><span class="model-kicker">Area</span><h1>${esc(areaName(area))}</h1></div>
      <button class="btn primary small" type="button" data-model-create data-location="area:${esc(areaId)}">New Task or Project</button>
    </header>
    <div class="model-area-intro"><p class="model-kicker">Room for related work</p><p>${projects.length} ${projects.length === 1 ? 'Project' : 'Projects'} and ${looseTasks.length} loose ${looseTasks.length === 1 ? 'Task' : 'Tasks'} live here. Every Project belongs to exactly one Area and never nests inside another Project.</p></div>
    <div class="model-area-toolbar">
      <button class="btn small" type="button" data-area-action="rename" data-area-id="${esc(areaId)}" data-area-name="${esc(areaName(area))}">Rename Area</button>
      <button class="btn small" type="button" data-area-order="up" data-area-id="${esc(areaId)}" aria-label="Move ${esc(areaName(area))} up" ${areas.findIndex((item) => item.id === areaId) === 0 ? 'disabled' : ''}>Move up</button>
      <button class="btn small" type="button" data-area-order="down" data-area-id="${esc(areaId)}" aria-label="Move ${esc(areaName(area))} down" ${areas.findIndex((item) => item.id === areaId) === areas.length - 1 ? 'disabled' : ''}>Move down</button>
      <button class="btn small" type="button" data-model-create-project data-area="${esc(areaId)}">New Project</button>
      <button class="btn small" type="button" data-model-create-task data-location="area:${esc(areaId)}">Add loose Task</button>
      <button class="btn small danger" type="button" data-area-action="delete" data-area-id="${esc(areaId)}">Delete Area</button>
    </div>
    <section class="model-section">
      <div class="model-section-head"><h2>Projects &amp; loose Tasks</h2><span class="model-count">${mixed.length} items</span></div>
      ${taskListControls(getTaskPrefs())}
      <div class="model-project-list">${mixedRows || `<div class="model-empty">This Area is clear. Add a Project for a longer journey, or a loose Task for a single next step.</div>`}</div>
    </section>
  </main>`;
  return { html, mount(root) { return bindModelHomePanel(root); } };
}

export async function createItem({ kind, location } = {}) {
  if (!kind) {
    const selected = await chooseCreateType();
    if (!selected) return null;
    kind = selected;
  }
  if (kind === 'task') {
    const created = await addTaskDialog(location || { kind: 'inbox' });
    if (created) rerender();
    return created;
  }
  if (kind !== 'project') return null;
  const contextArea = location?.kind === 'area' ? location.id : '';
  const created = await addProjectDialog(contextArea);
  if (created) {
    rerender();
    go(`#/d/${created.id}`);
  }
  return created;
}

export async function addTaskDialog(location = { kind: 'inbox' }) {
  if (typeof location === 'string') location = location.startsWith('area:') ? { kind: 'area', id: location.slice(5) } :
    location.startsWith('project:') ? { kind: 'project', id: location.slice(8) } : { kind: 'inbox' };
  const data = await formDialog({
    title: 'A new Task',
    submit: 'Add Task',
    body: taskFields(location),
    read: (dialog) => ({
      title: dialog.querySelector('[name=title]').value.trim(),
      location: getFormLocation(dialog),
      priority: dialog.querySelector('[name=priority]').value || undefined,
      due: dialog.querySelector('[name=due]').value || undefined,
      note: dialog.querySelector('[name=note]').value,
    }),
  });
  if (!data?.title) return null;
  try {
    return store.addTask(data.title, { location: data.location, priority: data.priority, due: data.due, note: data.note });
  } catch (error) { await notice('Task not added', error.message); return null; }
}

function taskFields(location = { kind: 'inbox' }, task = {}) {
  const currentKind = location?.kind || 'inbox';
  const currentId = location?.id || '';
  const options = `<option value="inbox" ${currentKind === 'inbox' ? 'selected' : ''}>Inbox</option>
    <optgroup label="Areas">${orderedItems(store.areas()).map((a) => `<option value="area:${esc(a.id)}" ${currentKind === 'area' && currentId === a.id ? 'selected' : ''}>${esc(areaName(a))}</option>`).join('')}</optgroup>
    <optgroup label="Projects">${orderedItems(store.flowProjects()).map((p) => `<option value="project:${esc(p.id)}" ${currentKind === 'project' && currentId === p.id ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</optgroup>`;
  return `<label>Task title<input name="title" required maxlength="200" autocomplete="off" placeholder="A small, clear next step" value="${esc(task.title || '')}"></label>
    <label>Location<select name="location">${options}</select></label>
    <div class="model-form-grid">
      <label>Priority<select name="priority"><option value="">No priority</option>${PRIORITIES.map((p) => `<option value="${p}" ${task.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
      <label>Due date<input type="date" name="due" value="${esc(task.due || '')}"></label>
    </div>
    <label>Note<textarea name="note" maxlength="2000" placeholder="A little context, if useful">${esc(task.note || '')}</textarea></label>
    <p class="model-status" data-form-error aria-live="polite"></p>`;
}

function getFormLocation(dialog) {
  const value = dialog.querySelector('[name=location]').value;
  if (value === 'inbox') return { kind: 'inbox' };
  const [kind, id] = value.split(':');
  return { kind, id };
}

async function chooseCreateType() {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal model-modal';
  dlg.innerHTML = `<form method="dialog"><span class="model-kicker">Start somewhere</span><h2>What are you making?</h2>
    <div class="model-type-choice"><button class="model-choice" type="button" data-choice="task"><strong>Task</strong><span>One step, wherever it belongs.</span></button><button class="model-choice" type="button" data-choice="project"><strong>Project</strong><span>A longer journey through five stages.</span></button></div>
    <div class="modal-actions"><button type="button" class="btn" data-cancel>Cancel</button></div></form>`;
  document.body.appendChild(dlg);
  return new Promise((resolve) => {
    const done = (value) => { if (dlg.open) dlg.close(); dlg.remove(); resolve(value); };
    dlg.addEventListener('cancel', (event) => { event.preventDefault(); done(null); });
    dlg.addEventListener('click', (event) => {
      const choice = event.target.closest('[data-choice]');
      if (choice) done(choice.dataset.choice);
      else if (event.target === dlg || event.target.closest('[data-cancel]')) done(null);
    });
    dlg.showModal();
    dlg.querySelector('[data-choice=task]').focus();
  });
}

async function addProjectDialog(areaId = '') {
  const areas = orderedItems(store.areas());
  if (!areas.length) {
    await notice('An Area comes first', 'Create an Area before starting a Project.');
    return null;
  }
  const body = `<label>Project title<input name="title" required maxlength="200" autocomplete="off" placeholder="A meaningful piece of work"></label>
    <label>Area<select name="area" required>${areaOptions(areaId)}</select></label>
    <div class="model-form-grid"><label>Priority<select name="priority"><option value="">No priority</option>${PRIORITIES.map((p) => `<option value="${p}">${p}</option>`).join('')}</select></label><label>Due date<input type="date" name="due"></label></div>`;
  const data = await formDialog({ title: 'Begin a Project', submit: 'Create Project', body, read: (dialog) => ({
    title: dialog.querySelector('[name=title]').value.trim(),
    areaId: dialog.querySelector('[name=area]').value,
    priority: dialog.querySelector('[name=priority]').value,
    due: dialog.querySelector('[name=due]').value,
  }) });
  if (!data?.title || !data.areaId) return null;
  try {
    const project = store.addFlowProject(data.areaId, data.title);
    if (data.priority || data.due) {
      if (data.priority) project.priority = data.priority;
      if (data.due) project.due = data.due;
      store.save(project);
    }
    return project;
  } catch (error) { await notice('Project not created', error.message); return null; }
}

function formDialog({ title, submit, body, read }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal model-modal';
  dlg.innerHTML = `<form><span class="model-kicker">Vesper notebook</span><h2>${esc(title)}</h2>${body}<div class="modal-actions"><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn primary">${esc(submit)}</button></div></form>`;
  document.body.appendChild(dlg);
  return new Promise((resolve) => {
    const finish = (value) => { if (dlg.open) dlg.close(); dlg.remove(); resolve(value); };
    dlg.addEventListener('cancel', (event) => { event.preventDefault(); finish(null); });
    dlg.addEventListener('click', (event) => { if (event.target === dlg || event.target.closest('[data-cancel]')) finish(null); });
    dlg.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      const value = read(dlg);
      if (!value.title) { dlg.querySelector('[name=title]').focus(); return; }
      finish(value);
    });
    dlg.showModal();
    dlg.querySelector('input')?.focus();
  });
}

export function bindTaskList(root) {
  const click = async (event) => {
    const target = event.target;
    const taskEdit = target.closest('[data-task-edit]');
    if (taskEdit) { await editTask(taskEdit.dataset.taskEdit); return; }
    const remove = target.closest('[data-task-delete]');
    if (remove) {
      const task = store.task(remove.dataset.taskDelete);
      if (task && await confirmBox(`Delete “${task.title}”?`, 'This removes the Task and its note from this device.')) {
        store.removeTask(task.id); rerender();
      }
      return;
    }
    const promote = target.closest('[data-task-promote]');
    if (promote && !promote.disabled) { await promoteTask(promote.dataset.taskPromote, promote.dataset.area); return; }
    const taskOrder = target.closest('[data-task-order]');
    if (taskOrder && !taskOrder.disabled) { reorderTask(taskOrder.dataset.taskId, taskOrder.dataset.kind, taskOrder.dataset.locationId, taskOrder.dataset.taskOrder); return; }
    const addProjectTask = target.closest('[data-project-task]');
    if (addProjectTask) { await createItem({ kind: 'task', location: { kind: 'project', id: addProjectTask.dataset.projectTask } }); return; }
    const projectOrder = target.closest('[data-project-order]');
    if (projectOrder && !projectOrder.disabled) { reorderProject(projectOrder.dataset.projectId, projectOrder.dataset.area, projectOrder.dataset.projectOrder); return; }
    const areaOrder = target.closest('[data-area-order]');
    if (areaOrder && !areaOrder.disabled) { reorderArea(areaOrder.dataset.areaId, areaOrder.dataset.areaOrder); return; }
    const areaAction = target.closest('[data-area-action]');
    if (areaAction) { await handleAreaAction(areaAction); return; }
    const newArea = target.closest('[data-model-add-area]');
    if (newArea) { await createArea(); return; }
    const newType = target.closest('[data-model-create]');
    if (newType) {
      const location = parseLocation(newType.dataset.location);
      await createItem({ location });
      return;
    }
    const newTask = target.closest('[data-model-create-task]');
    if (newTask) { await createItem({ kind: 'task', location: parseLocation(newTask.dataset.location) }); return; }
    const newProject = target.closest('[data-model-create-project]');
    if (newProject) { await createItem({ kind: 'project', location: { kind: 'area', id: newProject.dataset.area } }); return; }
    const setting = target.closest('[data-model-setting]');
    if (setting) { await handleSetting(setting.dataset.modelSetting, root); return; }
  };
  const change = async (event) => {
    const done = event.target.closest('[data-task-done]');
    if (done) {
      try { store.updateTask(done.dataset.taskDone, { done: done.checked }); rerender(); }
      catch (error) { await notice('Task not updated', error.message); }
      return;
    }
    const move = event.target.closest('[data-task-move]');
    if (move) {
      const value = move.value;
      const location = value === 'inbox' ? { kind: 'inbox' } : { kind: value.split(':')[0], id: value.split(':')[1] };
      try { store.moveTask(move.dataset.taskMove, location); rerender(); }
      catch (error) { await notice('Task not moved', error.message); }
    }
  };
  root.addEventListener('click', click);
  root.addEventListener('change', change);
  const stopControls = bindTaskListControls(root);
  return () => { root.removeEventListener('click', click); root.removeEventListener('change', change); stopControls(); };
}

export function bindModelHomePanel(root) {
  const stopTasks = bindTaskList(root);
  const stopTheme = bindThemeControl(root);
  const change = async (event) => {
    const importFile = event.target.closest('[data-model-import]');
    if (!importFile || !importFile.files?.[0]) return;
    const file = importFile.files[0];
    try {
      const yes = await confirmBox('Replace this notebook?', 'Importing a backup replaces Areas, Projects and Tasks stored on this device.', { ok: 'Import backup' });
      if (!yes) { importFile.value = ''; return; }
      store.importJSON(await file.text());
      rerender();
    } catch (error) { await notice('Backup could not be imported', error.message); }
    importFile.value = '';
  };
  root.addEventListener('change', change);
  return () => { stopTasks(); stopTheme(); root.removeEventListener('change', change); };
}

async function handleSetting(action, root) {
  if (action === 'export') {
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `vesper-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } else if (action === 'import') {
    $( '[data-model-import]', root)?.click();
  } else if (action === 'sync') {
    syncDialog({ onChange: rerender });
  } else if (action === 'sample') {
    const sampleArea = store.findSample('book') || store.insertSample(buildSample());
    go(`#/p/${sampleArea.id}`);
  }
}

function parseLocation(value = '') {
  if (!value || value === 'inbox') return { kind: 'inbox' };
  const [kind, id] = value.split(':');
  return { kind, id };
}

async function editTask(id) {
  const task = store.task(id);
  if (!task) return;
  const body = taskFields(task.location, task);
  const data = await formDialog({ title: 'Edit Task', submit: 'Save Task', body, read: (dialog) => ({
    title: dialog.querySelector('[name=title]').value.trim(),
    location: getFormLocation(dialog),
    priority: dialog.querySelector('[name=priority]').value || null,
    due: dialog.querySelector('[name=due]').value || null,
    note: dialog.querySelector('[name=note]').value,
  }) });
  if (!data) return;
  try {
    store.updateTask(id, { title: data.title, priority: data.priority, due: data.due, note: data.note });
    if (task.location.kind !== data.location.kind || task.location.id !== data.location.id) store.moveTask(id, data.location);
    rerender();
  } catch (error) { await notice('Task not saved', error.message); }
}

async function promoteTask(id, areaId = '') {
  const task = store.task(id);
  if (!task) return;
  if (task.done) { await notice('Task stays a Task', 'A done Task cannot become a Project. Mark it open first if you want to continue the work.'); return; }
  let destination = areaId || (task.location.kind === 'area' ? task.location.id : task.location.kind === 'project' ? store.flowProject(task.location.id)?.areaId : '');
  if (!destination) {
    const selected = await chooseArea();
    if (!selected) return;
    destination = selected;
  }
  try {
    const project = store.promoteTask(id, destination);
    rerender();
    if (project) go(`#/d/${project.id}`);
  } catch (error) { await notice('Task not promoted', error.message); }
}

function chooseArea() {
  const areas = orderedItems(store.areas());
  if (!areas.length) return notice('Create an Area first', 'Inbox Tasks need an Area before they can become Projects.').then(() => null);
  return selectDialog('Choose an Area', 'Promote Task', `<label>Area<select name="area" required>${areaOptions()}</select></label>`, (dialog) => dialog.querySelector('[name=area]').value);
}

function selectDialog(title, submit, body, read) {
  return formDialog({ title, submit, body, read: (dialog) => ({ value: read(dialog) }) }).then((result) => result?.value || null);
}

async function createArea() {
  const name = await ask('Name this Area', { ok: 'Create Area', placeholder: 'Home, studio, next chapter' });
  if (!name) return;
  try { store.addArea(name); rerender(); }
  catch (error) { await notice('Area not created', error.message); }
}

async function handleAreaAction(button) {
  const area = store.area(button.dataset.areaId);
  if (!area) return;
  if (button.dataset.areaAction === 'rename') {
    const name = await ask('Rename Area', { ok: 'Save name', value: areaName(area) });
    if (!name) return;
    area.name = name;
    store.save(area);
    rerender();
  } else if (button.dataset.areaAction === 'delete') {
    const projects = store.projectsIn(area.id);
    const tasks = store.tasksAt('area', area.id);
    const projectTasks = projects.reduce((sum, project) => sum + store.tasksAt('project', project.id).length, 0);
    const confirmed = await confirmBox(`Delete “${areaName(area)}”?`, `This deletes ${projects.length} ${projects.length === 1 ? 'Project' : 'Projects'} and moves ${tasks.length + projectTasks} contained ${tasks.length + projectTasks === 1 ? 'Task' : 'Tasks'} to Inbox. Project flow records are removed.`, { ok: 'Delete Area' });
    if (confirmed) { store.removeArea(area.id); go('#/'); }
  }
}

function reorderWithin(items, id, direction, collectionName) {
  const list = orderedItems(items);
  const index = list.findIndex((item) => item.id === id);
  const target = index + (direction === 'up' ? -1 : 1);
  if (index < 0 || target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target], list[index]];
  list.forEach((item, i) => { item.order = i; });
  if (collectionName === 'areas') store.saveItems(list, 'areas');
  else store.saveItems(list, collectionName);
  rerender();
}

function reorderTask(id, kind, locationId, direction) {
  reorderWithin(listFor(kind, locationId), id, direction, 'tasks');
}
function reorderProject(id, areaId, direction) {
  reorderWithin(store.projectsIn(areaId), id, direction, 'projects');
}
function reorderArea(id, direction) {
  reorderWithin(store.areas(), id, direction, 'areas');
}

