import { finishTask } from '../task-status.js';
import { setTaskMeta, setProjectMeta } from '../task-meta.js';
import { reorderItems, appendOrder } from '../organize.js';
// Applies the assistant's actions to task data. It works on any "db" with the same small
// interface as the app's store, so the app and the online connector share one set of rules:
// it can fill and tick steps, pass a Selah (with the person's answer recorded and who passed it), loop back, finish or reopen a task, and delete a task or project when told to confirm.
import { STAGES, SLIDES, slideIndex, selahIndex, firstSlideOf, tickKey, slideFor, setTaskMode } from '../framework.js';

const MAX_TEXT = 2000;

// ---- Applying actions -----------------------------------------------------------------

const norm = (s) => String(s || '').trim().toLowerCase();

// The furthest slide a task may sit on: its first Selah the person has not passed yet.
function limitIndex(deck) {
  const open = STAGES.find((st) => !deck.selah[st.id]);
  return open ? selahIndex(open.id) : SLIDES.length - 1;
}

function slideLabel(slide, step) {
  return step == null ? `${slide.sub.name} notes` : `${slide.sub.name} › ${slide.sub.steps[step]}`;
}

export function applyActions(actions, { focusId = null, db, by = 'ai' } = {}) {
  const changes = [];
  const skipped = [];
  const touched = new Map();   // deck id -> highest slide index touched
  const made = { projects: {}, decks: {} };
  let focus = focusId;

  const findProject = (ref) => {
    const r = norm(ref);
    if (r) {
      const list = db.projects();
      const hit = list.find((p) => p.id === ref) || list.find((p) => norm(p.name) === r);
      if (hit) return hit;
      if (made.projects[r]) return made.projects[r];
    }
    const f = focus && db.deck(focus);
    if (!r && f) return db.project(f.projectId);
    return db.projects().length === 1 && !r ? db.projects()[0] : null;
  };
  const findTask = (ref) => {
    const r = norm(ref);
    if (!r) return focus ? db.deck(focus) : null;
    const all = db.allDecks();
    const byId = all.find((d) => d.id === ref);
    if (byId) return byId;
    const byTitle = all.filter((d) => norm(d.title) === r);
    if (byTitle.length === 1) return byTitle[0];
    return made.decks[r] || null;
  };
  const touch = (deck, idx) => touched.set(deck.id, Math.max(touched.get(deck.id) ?? -1, idx));

  for (const a of actions) {
    const type = a.type;
    if (type === 'create_project') {
      const name = String(a.name || '').trim().slice(0, 80);
      if (!name) { skipped.push('A project had no name.'); continue; }
      const have = db.projects().find((p) => norm(p.name) === norm(name));
      if (have) { made.projects[norm(name)] = have; continue; }
      const p = db.addProject(name);
      made.projects[norm(name)] = p;
      changes.push({ text: `Created project "${p.name}"`, href: `#/p/${p.id}` });
    } else if (type === 'create_task') {
      const title = String(a.title || '').trim().slice(0, 80);
      const project = findProject(a.project);
      if (a.mode !== undefined && a.mode !== 'full') { skipped.push('Quick mode was removed. Create a simple Task instead.'); continue; }
      if (!title) { skipped.push('A task had no name.'); continue; }
      if (!project) { skipped.push(`No project found for "${title}".`); continue; }
      const have = db.decksOf(project.id).find((d) => norm(d.title) === norm(title));
      const d = have || db.addDeck(project.id, title, a.mode || 'full');
      made.decks[norm(title)] = d;
      focus = d.id;
      if (!have) changes.push({ text: `Created task "${d.title}" in ${project.name}`, href: `#/d/${d.id}` });
    } else if (type === 'focus') {
      const d = findTask(a.task);
      if (d) focus = d.id; else skipped.push(`Could not find the task "${a.task}".`);
    } else if (type === 'set_note' || type === 'tick') {
      const deck = findTask(a.task);
      if (!deck) { skipped.push(`Could not find the task "${a.task || ''}".`); continue; }
      const idx = slideIndex(String(a.slide || ''));
      if (String(a.slide || '').endsWith('.quick')) { skipped.push('Retained Quick notes are read-only.'); continue; }
      const slide = SLIDES[idx];
      if (!slide || !['sub', 'quick'].includes(slide.type) || (slide.type === 'quick' && slide.key !== a.slide)) { skipped.push(`There is no slide "${a.slide}".`); continue; }
      const hasStep = a.step !== undefined && a.step !== null && a.step !== '';
      const step = hasStep ? Number(a.step) : null;
      if (hasStep && !(Number.isInteger(step) && step >= 0 && step < slide.sub.steps.length)) {
        skipped.push(`"${slide.sub.name}" has no step ${a.step}.`); continue;
      }
      focus = deck.id;
      if (type === 'tick') {
        if (step === null) { skipped.push('A tick needs a step.'); continue; }
        const key = tickKey(slide.stage, slide.sub, step);
        const done = a.done !== false;
        if (!!deck.ticks[key] === done) continue;
        deck.ticks[key] = done;
        touch(deck, idx);
        changes.push({ text: `${done ? 'Ticked' : 'Unticked'} ${slideLabel(slide, step)}`, href: `#/d/${deck.id}/s/${idx}` });
        continue;
      }
      const text = String(a.text || '').trim().slice(0, MAX_TEXT);
      if (!text) { skipped.push(`Empty text for ${slide.sub.name}.`); continue; }
      const nk = step === null ? slide.key : `${slide.key}#${step}`;
      const old = (deck.notes[nk] || '').trim();
      let next = text;
      if (old) {
        if (a.mode === 'replace') next = text;
        else if (old.includes(text)) continue;
        else next = `${old}\n${text}`;
      }
      deck.notes[nk] = next;
      if (step !== null && a.tick !== false) deck.ticks[tickKey(slide.stage, slide.sub, step)] = true;
      touch(deck, idx);
      changes.push({ text: `${old ? 'Added to' : 'Filled'} ${slideLabel(slide, step)}`, href: `#/d/${deck.id}/s/${idx}` });
    } else if (type === 'pass_selah') {
      const deck = findTask(a.task);
      if (!deck) { skipped.push(`Could not find the task "${a.task || ''}".`); continue; }
      const next = STAGES.find((st) => !deck.selah[st.id]);
      if (!next) { skipped.push(`"${deck.title}" has no Selah left to pass.`); continue; }
      const stage = a.stage ? STAGES.find((st) => st.id === norm(a.stage) || norm(st.name) === norm(a.stage)) : next;
      if (!stage) { skipped.push(`There is no stage "${a.stage}".`); continue; }
      if (stage.id !== next.id) { skipped.push(`Pass ${next.name} first, then ${stage.name}.`); continue; }
      const answer = String(a.answer || '').trim().slice(0, MAX_TEXT);
      if (answer.length < 3) { skipped.push(`Passing the ${stage.name} Selah needs the answer to: ${stage.selah}`); continue; }
      const key = `${stage.id}.selah`;
      deck.notes[key] = `${answer}${(deck.notes[key] || '').trim() ? '\n' + deck.notes[key].trim() : ''}`;
      deck.selah[stage.id] = true;
      deck.selahBy = { ...(deck.selahBy || {}), [stage.id]: by };
      const at = selahIndex(stage.id);
      if (deck.slide <= at) deck.slide = Math.min(at + 1, SLIDES.length - 1);
      deck.reached = Math.max(deck.reached, deck.slide);
      db.save(deck);
      focus = deck.id;
      changes.push({ text: `Passed the ${stage.name} Selah (${by === 'claude' ? 'by Claude' : 'by Vesper AI'})`, href: `#/d/${deck.id}/s/${at}` });
    } else if (type === 'loop_back') {
      const deck = findTask(a.task);
      if (!deck) { skipped.push(`Could not find the task "${a.task || ''}".`); continue; }
      const stage = STAGES.find((st) => st.id === norm(a.stage) || norm(st.name) === norm(a.stage));
      if (!stage) { skipped.push(`There is no stage "${a.stage}" to go back to.`); continue; }
      const from = STAGES.indexOf(stage);
      for (let i = from; i < STAGES.length; i++) { delete deck.selah[STAGES[i].id]; if (deck.selahBy) delete deck.selahBy[STAGES[i].id]; }
      deck.loops += 1; deck.passes += 1; deck.finished = null;
      deck.slide = firstSlideOf(stage.id);
      db.save(deck);
      focus = deck.id;
      changes.push({ text: `Looped "${deck.title}" back to ${stage.name}`, href: `#/d/${deck.id}` });
    } else if (type === 'rename') {
      if (!!a.task === !!a.project) { skipped.push('Give exactly one task or project to rename.'); continue; }
      const name = typeof a.name === 'string' ? a.name.trim() : '';
      if (!name || name.length > 80) { skipped.push('Name must be 1–80 characters.'); continue; }
      const target = a.task ? findTask(a.task) : findProject(a.project);
      if (!target) { skipped.push('Task or project not found.'); continue; }
      if (a.task) { target.title = name; db.save(target); }
      else { target.name = name; db.saveProject(target); }
      changes.push({ text: `Renamed ${a.task ? 'task' : 'project'} to "${name}"`, href: a.task ? `#/d/${target.id}` : `#/p/${target.id}` });
    } else if (type === 'move_task') {
      const deck = findTask(a.task), project = findProject(a.project);
      if (!deck || !project) { skipped.push('Task or destination project not found.'); continue; }
      if (deck.projectId === project.id) continue;
      deck.projectId = project.id;
      deck.order = appendOrder(db.decksOf(project.id).filter((d) => d.id !== deck.id));
      db.save(deck);
      changes.push({ text: `Moved "${deck.title}" to "${project.name}"`, href: `#/d/${deck.id}` });
    } else if (type === 'reorder') {
      const project = a.kind === 'tasks' ? findProject(a.project) : null;
      if (!['projects', 'tasks'].includes(a.kind) || (a.kind === 'tasks' && !project)) { skipped.push('Choose projects, or tasks with an existing project.'); continue; }
      const items = a.kind === 'projects' ? db.projects() : db.decksOf(project.id);
      const error = reorderItems(items, a);
      if (error) { skipped.push(error); continue; }
      db.saveItems(items, a.kind);
      changes.push({ text: `Reordered ${a.kind}`, href: project ? `#/p/${project.id}` : '#/' });
    } else if (type === 'set_task') {
      const deck = findTask(a.task);
      if (!deck) { skipped.push(`Could not find the task "${a.task || ''}".`); continue; }
      if (a.mode !== undefined && a.mode !== 'full') { skipped.push('Quick mode was removed.'); continue; }
      const error = Object.hasOwn(a, 'priority') || Object.hasOwn(a, 'due') || Object.hasOwn(a, 'parked') || a.mode === undefined ? setProjectMeta(deck, a) : null;
      if (error) { skipped.push(error); continue; }
      if (a.mode !== undefined) setTaskMode(deck, a.mode);
      db.save(deck);
      changes.push({ text: `Updated task details for "${deck.title}"`, href: `#/d/${deck.id}` });
    } else if (type === 'finish' || type === 'reopen') {
      const deck = findTask(a.task);
      if (!deck) { skipped.push(`Could not find the task "${a.task || ''}".`); continue; }
      if (type === 'finish') {
        const error = finishTask(deck, { force: a.force, reason: a.reason });
        if (error) { skipped.push(error); continue; }
      } else { deck.finished = null; deck.finishedEarly = null; }
      db.save(deck);
      changes.push({ text: `${type === 'finish' ? 'Finished' : 'Reopened'} "${deck.title}"`, href: `#/d/${deck.id}` });
    } else if (type === 'delete_task' || type === 'delete_project') {
      if (a.confirm !== true) { skipped.push('Deleting needs confirm: true, after the person has said yes.'); continue; }
      if (type === 'delete_task') {
        const deck = findTask(a.task);
        if (!deck) { skipped.push(`Could not find the task "${a.task || ''}".`); continue; }
        db.removeDeck(deck.id);
        if (focus === deck.id) focus = null;
        changes.push({ text: `Deleted task "${deck.title}"`, href: '#/' });
      } else {
        const project = findProject(a.project);
        if (!project) { skipped.push(`Could not find the project "${a.project || ''}".`); continue; }
        db.removeProject(project.id);
        changes.push({ text: `Deleted project "${project.name}" and its tasks`, href: '#/' });
      }
    } else {
      skipped.push(`Unknown action "${type}".`);
    }
  }

  // Move each touched task forward to where the work now is, but never past an unpassed Selah.
  for (const [id, idx] of touched) {
    const deck = db.deck(id);
    if (!deck || deck.finished) continue;
    const target = Math.min(idx, limitIndex(deck));
    if (target > deck.slide) deck.slide = target;
    deck.reached = Math.max(deck.reached, deck.slide);
    db.save(deck);
  }
  return { changes, skipped, focus };
}
