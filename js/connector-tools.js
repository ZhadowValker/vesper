// Shared helpers for the connector's planning tools: work status, stage moves, title-prefix
// migration, counts, agenda and note search. Plain functions over v2 state; no screen code.
import { STAGES, SLIDES, slideIndex, firstSlideOf, tickKey } from './framework.js';
import { PRIORITIES, validDue, WORK_STATUSES, STORED_STATUSES, workStatus } from './task-meta.js';
import { finishTask, missingSelahs } from './task-status.js';
import { allSteps, nextQuestionSteps } from './ai/steps.js';
import { modelOverview } from './model-overview.js';

// kind is 'project' (Full Project) or 'task' (simple Task). Returns an error text or null.
export function setWorkStatus(item, kind, status) {
  if (!WORK_STATUSES.includes(status)) return `status must be one of ${WORK_STATUSES.join(', ')}.`;
  if (kind === 'project') {
    if (status === 'finished') return 'Finish a Project with vesper_finish so the Selah rules apply.';
    if (item.finished) return 'This Project is finished. Reopen it with vesper_finish (reopen: true) first.';
    if (status === 'parked') item.parked = true; else if (item.parked === true) item.parked = false;
  } else {
    if (status === 'parked') return 'Simple Tasks cannot be parked; use discuss, recurring, active or finished.';
    if (status === 'finished') item.done = true; else if (item.done === true) item.done = false;
  }
  if (STORED_STATUSES.includes(status)) item.status = status; else delete item.status;
  return null;
}

export function stepCounts(deck) {
  const steps = allSteps(deck);
  const note = (s) => !!String(deck.notes?.[s.key] || '').trim();
  const tick = (s) => s.step !== null && !!deck.ticks?.[tickKey(s.slide.stage, s.slide.sub, s.step)];
  return { total: steps.length, notes: steps.filter(note).length, ticked: steps.filter(tick).length, answered: steps.filter((s) => note(s) || tick(s)).length };
}

// Index into STAGES of the first stage whose Selah is open; STAGES.length when all are passed.
const openStageIndex = (deck) => { const i = STAGES.findIndex((st) => !deck.selah?.[st.id]); return i < 0 ? STAGES.length : i; };

// Moves the current slide without passing or clearing a Selah.
export function setStage(deck, { stage, slide, force = false, reason = '' } = {}) {
  if (deck.finished) return { error: 'This Project is finished. Reopen it with vesper_finish (reopen: true) first.' };
  const open = openStageIndex(deck);
  let idx;
  if (slide !== undefined && slide !== null && slide !== '') {
    idx = slideIndex(String(slide));
    if (idx < 0 || !['sub', 'selah'].includes(SLIDES[idx]?.type)) return { error: `There is no slide "${slide}".` };
  } else if (stage !== undefined && stage !== null && stage !== '') {
    const ref = String(stage).trim().toLowerCase();
    if (ref === 'recap') idx = SLIDES.length - 1;
    else {
      const st = STAGES.find((x) => x.id === ref || x.name.toLowerCase() === ref);
      if (!st) return { error: `There is no stage "${stage}".` };
      idx = firstSlideOf(st.id);
    }
  } else idx = open < STAGES.length ? firstSlideOf(STAGES[open].id) : SLIDES.length - 1;
  const target = SLIDES[idx].stage ? STAGES.indexOf(SLIDES[idx].stage) : STAGES.length;
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (target !== open && !(force === true && why && why.length <= 240)) {
    const openName = open < STAGES.length ? STAGES[open].name : 'none (all passed)';
    const problem = target > open ? `it is past the open ${STAGES[open].name} Selah` : `the ${STAGES[target].name} Selah is already passed`;
    return { error: `Cannot move to ${SLIDES[idx].key}: ${problem}. The open stage is ${openName}. Use vesper_loop_back to redo a stage, or force: true with a reason (1–240 characters).` };
  }
  const from = SLIDES[deck.slide || 0]?.key || 'cover';
  deck.slide = idx;
  deck.reached = Math.max(deck.reached || 0, idx);
  return { from, to: SLIDES[idx].key, forced: target !== open };
}

// "Done · ", "Discuss: ", "P1 - " and similar leading markers, repeated.
const PREFIX = /^\s*(done|discuss|recurring|parked|p[1-4])\s*[·:|\-–—]\s*/i;
export function parseTitlePrefixes(title) {
  let rest = String(title || '');
  const found = [];
  for (let m = PREFIX.exec(rest); m; m = PREFIX.exec(rest)) { found.push(m[1].toLowerCase()); rest = rest.slice(m[0].length); }
  return { title: rest.trim(), prefixes: found };
}

// Plans (and, on the given db, applies) the title-prefix migration for every Project and Task.
export function migrateTitlePrefixes(db) {
  const changed = [], notApplied = [];
  const items = [...db.flowProjects().map((x) => ['project', x]), ...db.tasks().map((x) => ['task', x])];
  for (const [kind, item] of items) {
    const { title, prefixes } = parseTitlePrefixes(item.title);
    if (!prefixes.length) continue;
    const label = `${kind} "${item.title}" (${item.id})`;
    if (!title) { notApplied.push(`${label}: nothing would be left of the title.`); continue; }
    const effects = [];
    let error = null;
    const next = JSON.parse(JSON.stringify(item));
    for (const p of prefixes) {
      if (/^p[1-4]$/.test(p)) {
        const pr = p.toUpperCase();
        if (!next.priority) { next.priority = pr; effects.push(`priority ${pr}`); }
        else if (next.priority !== pr) effects.push(`kept existing priority ${next.priority} (title said ${pr})`);
      } else if (p === 'done') {
        if (kind === 'task') { next.done = true; effects.push('done'); }
        else if (!next.finished) {
          if (missingSelahs(next).length) { error = `"Done" but Selahs not passed (${missingSelahs(next).map((s) => s.name).join(', ')}). Finish it with vesper_finish (force and a reason) yourself, then rerun.`; break; }
          finishTask(next, {}); effects.push('finished');
        }
      } else {
        const e = setWorkStatus(next, kind, p);
        if (e) { error = e; break; }
        effects.push(`status ${p}`);
      }
    }
    if (error) { notApplied.push(`${label}: ${error}`); continue; }
    for (const key of ['priority', 'done', 'finished', 'finishedEarly', 'parked', 'status']) {
      if (Object.hasOwn(next, key)) item[key] = next[key]; else delete item[key];
    }
    item.title = title;
    db.save(item);
    changed.push({ id: item.id, kind, from: `${prefixes.join(' · ')} · ${title}`, title, set: effects });
  }
  return { changed, notApplied };
}

export function todayIn(timeZone) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch (e) { return new Date().toISOString().slice(0, 10); }
}
export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function summaryCounts(state, { area, today } = {}) {
  const rows = modelOverview(state, { area, limit: 1000 }, { today });
  const soon = addDays(today, 7);
  const count = (list, key) => list.reduce((o, r) => { const k = r[key] || 'none'; o[k] = (o[k] || 0) + 1; return o; }, {});
  const projects = rows.filter((r) => r.kind === 'project'), tasks = rows.filter((r) => r.kind === 'task');
  const open = rows.filter((r) => r.workStatus !== 'finished');
  return {
    today, total: rows.length, projects: projects.length, tasks: tasks.length,
    byStage: count(projects.filter((r) => r.workStatus !== 'finished'), 'stage'),
    byPriority: count(open, 'priority'), byWorkStatus: count(rows, 'workStatus'),
    overdue: open.filter((r) => r.overdue).length,
    dueNext7Days: open.filter((r) => validDue(r.due) && r.due >= today && r.due <= soon).length,
  };
}

export function agenda(state, { days = 7, limit = 10, today } = {}) {
  const n = Math.max(0, Math.min(365, Number.isInteger(days) ? days : 7));
  const cap = Math.max(1, Math.min(50, Number.isInteger(limit) ? limit : 10));
  const rows = modelOverview(state, { limit: 1000 }, { today }).filter((r) => r.workStatus !== 'finished');
  const until = addDays(today, n);
  const line = (r) => ({ id: r.id, kind: r.kind, title: r.title, area: r.area, project: r.project, stage: r.stage, priority: r.priority, due: r.due, workStatus: r.workStatus });
  const byDue = (a, b) => String(a.due).localeCompare(String(b.due));
  const next = [];
  for (const p of state.projects) {
    if (workStatus(p) === 'finished' || workStatus(p) === 'parked') continue;
    const step = nextQuestionSteps(p)[0];
    const open = STAGES.find((st) => !p.selah?.[st.id]);
    next.push({ id: p.id, title: p.title, priority: p.priority || null, due: p.due || null, currentStage: open ? open.name : null,
      nextStep: step ? { slide: step.slide.key, step: step.step, stepText: step.text, question: step.question } : null,
      ...(step || !open ? {} : { selahQuestion: open.selah }) });
  }
  const rank = (x) => PRIORITIES.includes(x.priority) ? PRIORITIES.indexOf(x.priority) : 4;
  next.sort((a, b) => rank(a) - rank(b) || String(a.due || '9999').localeCompare(String(b.due || '9999')));
  return {
    today, days: n,
    overdue: rows.filter((r) => r.overdue).sort(byDue).slice(0, cap).map(line),
    dueSoon: rows.filter((r) => validDue(r.due) && r.due >= today && r.due <= until).sort(byDue).slice(0, cap).map(line),
    p1Open: rows.filter((r) => r.priority === 'P1').slice(0, cap).map(line),
    projectNextSteps: next.slice(0, cap),
  };
}

// Every term must appear (case-insensitive) in one text: a title, step note, slide note,
// archived Selah answer or Task note.
export function searchNotes(state, { query, area, limit = 20 } = {}) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) throw new Error('query is required.');
  const cap = Math.max(1, Math.min(100, Number.isInteger(limit) ? limit : 20));
  const areaId = area ? (state.areas.find((a) => a.id === area) || state.areas.find((a) => a.name.toLowerCase() === String(area).trim().toLowerCase()))?.id : null;
  if (area && !areaId) return [];
  const hits = [];
  const snippet = (text) => {
    const at = text.toLowerCase().indexOf(terms[0]);
    const from = Math.max(0, at - 60);
    return (from ? '…' : '') + text.slice(from, at + terms[0].length + 80).replace(/\s+/g, ' ').trim() + (at + terms[0].length + 80 < text.length ? '…' : '');
  };
  const consider = (base, where, text) => {
    const t = String(text || '');
    if (t && terms.every((x) => t.toLowerCase().includes(x))) hits.push({ ...base, where, snippet: snippet(t) });
  };
  const labelOf = (key) => {
    const [slideKey, rest] = key.split('#');
    const s = SLIDES[slideIndex(slideKey)];
    if (!s) return key;
    if (s.type === 'selah') return `${s.stage.name} Selah${rest ? ` (archived ${rest})` : ''}`;
    if (s.type === 'sub' && rest !== undefined && /^\d+$/.test(rest)) return `${s.stage.name} › ${s.sub.name} › ${s.sub.steps[Number(rest)]}`;
    return s.sub ? `${s.stage.name} › ${s.sub.name}` : key;
  };
  for (const p of state.projects) {
    if (areaId && p.areaId !== areaId) continue;
    const base = { id: p.id, kind: 'project', title: p.title };
    consider(base, 'title', p.title);
    for (const [key, text] of Object.entries(p.notes || {})) consider({ ...base, key }, labelOf(key), text);
  }
  for (const t of state.tasks) {
    if (t.promotedTo) continue;
    const tArea = t.location?.kind === 'area' ? t.location.id : t.location?.kind === 'project' ? state.projects.find((p) => p.id === t.location.id)?.areaId : null;
    if (areaId && tArea !== areaId) continue;
    const base = { id: t.id, kind: 'task', title: t.title };
    consider(base, 'title', t.title);
    consider(base, 'note', t.note);
  }
  return hits.slice(0, cap);
}

