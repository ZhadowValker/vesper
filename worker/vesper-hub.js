// ---- Vesper hub (Cloudflare Worker) ----------------------------------------------------
// One free Worker that does three jobs:
//   1. /sync            keeps one online copy of your data so your devices match
//   2. /mcp/<token>     a connector so Claude can read your tasks, fill steps and run the interview
//   3. /v1/chat/completions   a proxy for NVIDIA's free AI API (keeps your NVIDIA key off the phone)
//
// Set up (details in worker/README.md):
//   KV namespace binding   VESPER                (stores your data)
//   Secret                 APP_TOKEN             (a long random text; the app and Claude use it)
//   Secret (optional)      NVIDIA_API_KEY        (only for the AI proxy)
//   Variable (optional)    ORIGINS               (extra website addresses allowed to call /sync, comma-separated)
//   Google Calendar (optional): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (secret), PUBLIC_URL (this site's address,
//                          for example https://vesper.soundmind.org.in), GOOGLE_TZ (default Asia/Kolkata),
//                          GOOGLE_CALENDAR_ID (which calendar gets the events; default your main one)
//   Sign in with Google (optional, needs the Google settings above): OWNER_EMAIL (your Google email: that login
//                          opens YOUR data), ALLOWED_EMAILS (comma list: only these may sign in; empty = anyone),
//                          MAX_USERS (default 100)
//   Variable (optional)    MODELS                (comma-separated model names the AI proxy allows)
//
// GENERATED FILE: edit worker/hub.src.js and the app modules, then run: node worker/build.js

// ---- from js/framework.js ----
// The Vesper framework as data. Edit stages, sub-stages and steps here only;
// every screen in the app is generated from this file.

const CONFIG = {
  // true: Selah warns about unticked steps but still lets you continue.
  // false: Continue stays blocked until every step in the stage is ticked.
  softSelah: true,
};

const STAGES = [
  {
    id: 'vision', name: 'Vision', tone: 'think',
    selah: 'Can I say it in two sentences?',
    subs: [
      { id: 'why', name: 'Why', what: 'Reason it matters', steps: ['Ask: why this task?', 'Write a one-line reason'] },
      { id: 'goal', name: 'Goal', what: 'How it looks once finished', steps: ['Picture the finished result', 'Describe it in two sentences'] },
      { id: 'check', name: 'Check', what: "How I'll know it worked", steps: ['Choose how to verify it', 'Write the pass condition'] },
      { id: 'limits', name: 'Limits', what: 'What stays out', steps: ['List what stays out'] },
    ],
  },
  {
    id: 'research', name: 'Research', tone: 'think',
    selah: 'Do I know enough to choose?',
    subs: [
      { id: 'questions', name: 'Questions', what: 'WH questions about your vision', steps: ['List the WH questions', 'Keep the top three', 'Learn the answers'] },
      { id: 'timelimit', name: 'Time limit', what: 'Cap the search time', steps: ['Set a stop time'], timer: true },
      { id: 'findings', name: 'Findings', what: 'Note what you learn', steps: ['Note what you learned', 'Note what is still unknown'] },
      { id: 'decide', name: 'Decide', what: 'Pick one option', steps: ['Choose one option'] },
    ],
  },
  {
    id: 'plan', name: 'Plan', tone: 'think',
    selah: 'Could someone else follow it?',
    subs: [
      { id: 'map', name: 'Map', what: 'Map your execution, start to finish', steps: ['List every action', 'Order them start to finish', 'Mark what blocks what'] },
      { id: 'time', name: 'Time', what: 'Estimate each action', steps: ['Estimate each action', 'Add up the total'] },
      { id: 'risks', name: 'Risks', what: 'Discard unneeded actions', steps: ['Spot unneeded actions', 'Discard them'] },
      { id: 'firststep', name: 'First step', what: 'Doable today', steps: ['Pick one doable today'] },
    ],
  },
  {
    id: 'execute', name: 'Execute', tone: 'do',
    selah: 'Does the slice work?',
    subs: [
      { id: 'slice', name: 'Slice', what: 'Divide each action into slices', steps: ['Break each action into slices', 'Make each slice doable'] },
      { id: 'learn', name: 'Learn', what: 'Note what surprised you', steps: ['Note what surprised you'] },
      { id: 'adjust', name: 'Adjust', what: 'Change the plan if needed', steps: ['Spot what changed', 'Update the map'] },
      { id: 'check', name: 'Check', what: 'Slice works before the next', steps: ['Test that the slice works'] },
    ],
  },
  {
    id: 'review', name: 'Review', tone: 'do',
    selah: 'Pass, partly, or no?',
    subs: [
      { id: 'successful', name: 'Successful?', what: 'Slice completed and working', steps: ['Is the slice complete?', 'Is it working?'] },
      { id: 'change', name: 'Change', what: 'List what to improve', steps: ['List what to improve', 'Pick what to apply'] },
      { id: 'loopback', name: 'Loop back', what: 'Pick a stage to revisit', steps: ['Choose a stage to revisit'], loop: true },
      { id: 'done', name: 'Done?', what: 'Close or iterate', steps: ['Close, or start the next pass'] },
    ],
  },
];

function stageById(id) {
  return STAGES.find((s) => s.id === id);
}

// Slide order for one deck: cover, then per stage its sub-stage slides and a Selah slide, then recap.
const SLIDES = (() => {
  const out = [{ type: 'cover', key: 'cover' }];
  for (const stage of STAGES) {
    stage.subs.forEach((sub, i) => out.push({ type: 'sub', key: `${stage.id}.${sub.id}`, stage, sub, n: i + 1 }));
    out.push({ type: 'selah', key: `${stage.id}.selah`, stage });
  }
  out.push({ type: 'recap', key: 'recap' });
  return out;
})();

const slideIndex = (key) => SLIDES.findIndex((s) => s.key === key);
const firstSlideOf = (stageId) => slideIndex(`${stageId}.${stageById(stageId).subs[0].id}`);
const selahIndex = (stageId) => slideIndex(`${stageId}.selah`);

const tickKey = (stage, sub, i) => `${stage.id}.${sub.id}:${i}`;

function subProgress(deck, stage, sub) {
  let done = 0;
  for (let i = 0; i < sub.steps.length; i++) if (deck.ticks[tickKey(stage, sub, i)]) done++;
  return { done, total: sub.steps.length };
}

function subDone(deck, stage, sub) {
  const p = subProgress(deck, stage, sub);
  return p.done === p.total;
}

function stagePending(deck, stage) {
  let pending = 0;
  for (const sub of stage.subs) {
    const p = subProgress(deck, stage, sub);
    pending += p.total - p.done;
  }
  return pending;
}

// 'done' | 'now' | 'todo' for one slide chip.
function chipState(deck, slide, idx) {
  const finishedChip = slide.type === 'sub' ? subDone(deck, slide.stage, slide.sub) : !!deck.selah[slide.stage.id];
  if (finishedChip) return 'done';
  return deck.slide === idx ? 'now' : 'todo';
}

function stageState(deck, stage) {
  const idxs = [...stage.subs.map((s) => slideIndex(`${stage.id}.${s.id}`)), selahIndex(stage.id)];
  const allDone = idxs.every((i) => chipState(deck, SLIDES[i], i) === 'done');
  if (allDone) return 'done';
  if (idxs.includes(deck.slide)) return 'now';
  return 'todo';
}

function atSelah(deck) {
  const slide = SLIDES[deck.slide];
  return !deck.finished && slide.type === 'selah' && !deck.selah[slide.stage.id];
}

function deckStatus(deck) {
  const pct = Math.round((deck.reached / (SLIDES.length - 1)) * 100);
  if (deck.finished) return { label: 'Finished', stageId: null, pct: 100, tone: 'do', state: 'done' };
  const slide = SLIDES[deck.slide];
  if (slide.stage) return { label: slide.stage.name, stageId: slide.stage.id, pct, tone: slide.stage.tone, state: 'now' };
  if (slide.type === 'cover' && deck.reached === 0) return { label: 'Not started', stageId: null, pct: 0, tone: 'think', state: 'todo' };
  return { label: 'Recap', stageId: null, pct, tone: 'do', state: 'now' };
}

// ---- from js/ai/questions.js ----
// One plain-language question for every step, in framework order. The interview asks these,
// so it works even when the AI model is weak or offline. Key: "<slide key>#<step number>".
const QUESTIONS = {
  'vision.why#0': 'Why this task? What made you want to do it now?',
  'vision.why#1': 'In one line, what is the reason it matters?',
  'vision.goal#0': 'Picture it finished. What do you see?',
  'vision.goal#1': 'Say it in two sentences: what is the finished result?',
  'vision.check#0': 'How will you check that it worked?',
  'vision.check#1': 'What is the pass condition? What must be true to call it a success?',
  'vision.limits#0': 'What is NOT part of this? What stays out?',
  'research.questions#0': 'What do you need to find out? Write the who, what, when, where, why and how questions you have.',
  'research.questions#1': 'Which three of those questions matter most?',
  'research.questions#2': 'What answers have you learned so far?',
  'research.timelimit#0': 'How long will you allow yourself to search? Set a stop time.',
  'research.findings#0': 'What did you learn?',
  'research.findings#1': 'What is still unknown?',
  'research.decide#0': 'Which one option will you go with?',
  'plan.map#0': 'List every action it takes, start to finish.',
  'plan.map#1': 'In what order do those actions go?',
  'plan.map#2': 'Which actions block others? What has to wait for what?',
  'plan.time#0': 'Roughly how long will each action take?',
  'plan.time#1': 'What is the total?',
  'plan.risks#0': 'Which of those actions are not really needed?',
  'plan.risks#1': 'What will you drop?',
  'plan.firststep#0': 'What is one step you could do today?',
  'execute.slice#0': 'Break each action into small slices. What are the slices?',
  'execute.slice#1': 'Is every slice doable in one sitting? What would you make smaller?',
  'execute.learn#0': 'What surprised you while doing it?',
  'execute.adjust#0': 'What changed from the plan?',
  'execute.adjust#1': 'What will you update in the plan?',
  'execute.check#0': 'Does the slice work? How did you test it?',
  'review.successful#0': 'Is the slice complete?',
  'review.successful#1': 'Is it working?',
  'review.change#0': 'What would you improve?',
  'review.change#1': 'Which of those will you actually apply?',
  'review.loopback#0': 'Which stage, if any, do you want to revisit?',
  'review.done#0': 'Close it, or start the next pass? What is your call?',
};

// ---- from js/ai/steps.js ----
// The 34 steps in framework order, which are empty, and how far along a task is.
// Plain functions with no screen code, shared by the interview and the online connector.

const stepKey = (slide, i) => `${slide.key}#${i}`;
const filled = (deck, key) => !!(deck.notes[key] || '').trim();

// Every step of the task in framework order, with its question.
function allSteps() {
  const out = [];
  for (const slide of SLIDES) {
    if (slide.type !== 'sub') continue;
    slide.sub.steps.forEach((text, i) => out.push({ key: stepKey(slide, i), slide, step: i, text, question: QUESTIONS[stepKey(slide, i)] }));
  }
  return out;
}

// Steps still to ask, in order. `skipped` is a list of step keys the person passed on.
function emptySteps(deck, skipped = []) {
  return allSteps().filter((s) => !filled(deck, s.key) && !skipped.includes(s.key));
}

function progress(deck) {
  const steps = allSteps();
  return { filled: steps.filter((s) => filled(deck, s.key)).length, total: steps.length };
}

// ---- from js/ai/apply.js ----
// Applies the assistant's actions to task data. It works on any "db" with the same small
// interface as the app's store, so the app and the online connector share one set of rules:
// it can fill and tick steps, but never pass a Selah, delete anything, or finish a task.

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

function applyActions(actions, { focusId = null, db } = {}) {
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
      if (!title) { skipped.push('A task had no name.'); continue; }
      if (!project) { skipped.push(`No project found for "${title}".`); continue; }
      const have = db.decksOf(project.id).find((d) => norm(d.title) === norm(title));
      const d = have || db.addDeck(project.id, title);
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
      const slide = SLIDES[idx];
      if (!slide || slide.type !== 'sub') { skipped.push(`There is no slide "${a.slide}".`); continue; }
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

// ---- from js/merge.js ----
// Merging two copies of the data (for sync). Newest edit wins per project or task, and a
// deletion wins over an older edit. Plain functions, shared by the app and the Worker.
const stamp = (x) => x.updated || x.created || 0;

function pick(a, b) {
  const byId = new Map();
  const order = [];
  for (const item of [...a, ...b]) {
    const have = byId.get(item.id);
    if (!have) { byId.set(item.id, item); order.push(item.id); }
    else if (stamp(item) > stamp(have)) byId.set(item.id, item);
  }
  return order.map((id) => byId.get(id));
}

function emptyState() {
  return { version: 1, projects: [], decks: [], deleted: {} };
}

function mergeStates(a, b) {
  a = a || emptyState(); b = b || emptyState();
  const deleted = { ...(a.deleted || {}) };
  for (const [id, ts] of Object.entries(b.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, ts);
  const alive = (x) => !(deleted[x.id] && deleted[x.id] >= stamp(x));
  const projects = pick(a.projects || [], b.projects || []).filter(alive);
  const ids = new Set(projects.map((p) => p.id));
  const decks = pick(a.decks || [], b.decks || []).filter(alive).filter((d) => ids.has(d.projectId));
  return { version: 1, projects, decks, deleted };
}

// True when two states hold the same data (ignoring order of keys).
function sameState(a, b) {
  const norm = (s) => JSON.stringify({ p: [...s.projects].sort((x, y) => (x.id > y.id ? 1 : -1)), d: [...s.decks].sort((x, y) => (x.id > y.id ? 1 : -1)), x: s.deleted || {} });
  return norm(a) === norm(b);
}

// ---- hub ----
const ALLOWED_ORIGINS = [
  'https://zhadowvalker.github.io',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
];
const UPSTREAM = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MAX_BODY = 5000000;
const MAX_AI_BODY = 100000;
const MAX_TOKENS = 4096;

// ---- small helpers ---------------------------------------------------------------------

function cors(origin) {
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization,content-type',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (status, obj, origin) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...(origin ? cors(origin) : {}) } });

function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const hasToken = (env, t) => !!env.APP_TOKEN && same(String(t || ''), env.APP_TOKEN);
const bearer = (request) => (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');

async function loadState(env) {
  const s = await env.VESPER.get('state', 'json');
  return s && Array.isArray(s.projects) && Array.isArray(s.decks) ? { ...emptyState(), ...s } : emptyState();
}
const saveState = (env, s) => env.VESPER.put('state', JSON.stringify(s));

const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);

// The same small interface as the app's store, over the online copy of the data.
function makeDb(state) {
  return {
    projects: () => state.projects,
    project: (id) => state.projects.find((p) => p.id === id),
    decksOf: (pid) => state.decks.filter((d) => d.projectId === pid),
    allDecks: () => state.decks,
    deck: (id) => state.decks.find((d) => d.id === id),
    addProject(name) {
      const p = { id: uid(), name, created: Date.now(), updated: Date.now() };
      state.projects.push(p);
      return p;
    },
    addDeck(projectId, title) {
      const d = {
        id: uid(), projectId, title, created: Date.now(), updated: Date.now(),
        slide: 0, reached: 0, ticks: {}, notes: {}, selah: {},
        passes: 1, loops: 0, finished: null, timer: null,
      };
      state.decks.push(d);
      return d;
    },
    save(deck) { deck.updated = Date.now(); },
  };
}


// ---- Google Calendar --------------------------------------------------------------------
// One-time sign-in, then the hub creates and updates events for you. Only the "calendar.events" permission is asked for.
const G_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const G_TOKEN = 'https://oauth2.googleapis.com/token';
const G_REVOKE = 'https://oauth2.googleapis.com/revoke';
// The calendar that gets events: the one picked in the app, else GOOGLE_CALENDAR_ID, else your main calendar.
async function gCal(env) {
  const saved = await env.VESPER.get('gcal', 'json');
  return { id: (saved && saved.id) || env.GOOGLE_CALENDAR_ID || 'primary', name: (saved && saved.name) || '' };
}
const gApi = (id) => `${G_CAL}/calendars/${encodeURIComponent(id)}/events`;
const G_SCOPE = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.app.created https://www.googleapis.com/auth/calendar.calendarlist.readonly';
const G_CAL = 'https://www.googleapis.com/calendar/v3';

const gConfigured = (env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.PUBLIC_URL && env.VESPER);
const gBase = (env) => String(env.PUBLIC_URL || '').replace(/\/+$/, '');
const gTz = (env) => env.GOOGLE_TZ || 'Asia/Kolkata';
const gRand = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
const gForm = (o) => new URLSearchParams(o).toString();
const gPage = (title, text, env) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
  `<body style="font-family:system-ui;background:#0e0b24;color:#eee;padding:32px;max-width:520px;margin:auto"><h2>${title}</h2><p>${text}</p>` +
  `<p><a style="color:#9d8cff" href="${gBase(env) || '/'}/#/">Back to Vesper</a></p></body>`,
  { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

// ---- Who is asking: the owner (APP_TOKEN) or a person signed in with Google -------------
// Every person gets their own space: the same code runs on a view of storage that adds a prefix to every key.
const ownerEnv = (env) => ({ ...env, RAW: env.VESPER, UID: 'owner', OWNER: true });
function scopedKV(kv, prefix) {
  return { get: (k, t) => kv.get(prefix + k, t), put: (k, v) => kv.put(prefix + k, v), delete: (k) => kv.delete(prefix + k) };
}
const userEnv = (env, sub) => ({ ...env, RAW: env.VESPER, VESPER: scopedKV(env.VESPER, `u:${sub}:`), UID: sub, OWNER: false });

async function sha(text) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function who(env, token) {
  if (hasToken(env, token)) return { env: ownerEnv(env), owner: true, email: '', sessKey: '' };
  if (!token || !env.VESPER) return null;
  const key = 'sess:' + (await sha(token));
  const sess = await env.VESPER.get(key, 'json');
  if (!sess || sess.exp < Date.now()) return null;
  return { env: sess.owner ? ownerEnv(env) : userEnv(env, sess.sub), owner: !!sess.owner, email: sess.email || '', sessKey: key };
}

const gAccessCache = new Map();   // short-lived Google access tokens, per person

// A one-time sign-in address. kind: "calendar" (connect a calendar) or "login" (sign in to Vesper).
async function gStart(env, kind = 'calendar') {
  const state = gRand();
  await env.RAW.put('gauth:' + state, JSON.stringify({ kind, uid: env.UID, exp: Date.now() + 10 * 60000 }));
  const q = gForm({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: gBase(env) + '/google/callback', response_type: 'code',
    scope: kind === 'login' ? G_LOGIN_SCOPE : G_SCOPE, access_type: 'offline', prompt: kind === 'login' ? 'select_account consent' : 'consent', state,
  });
  return `${G_AUTH}?${q}`;
}

async function gExchange(env, code) {
  const res = await fetch(G_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: gForm({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: gBase(env) + '/google/callback', grant_type: 'authorization_code' }) });
  const tok = await res.json().catch(() => ({}));
  return { ok: res.ok, tok };
}

// Google sends the person back here. The one-time state in the address says what they were doing and who they are.
async function gCallback(request, env) {
  if (!gConfigured(env)) return gPage('Google is not set up', 'The hub has no Google settings yet.', env);
  const u = new URL(request.url);
  const state = u.searchParams.get('state') || '';
  const rec = state ? await env.VESPER.get('gauth:' + state, 'json') : null;
  if (!rec || rec.exp < Date.now()) return gPage('That sign-in link expired', 'Start again from Vesper.', env);
  await env.VESPER.delete('gauth:' + state);   // a sign-in link works once
  if (u.searchParams.get('error')) return gPage('Google sign-in was cancelled', 'Nothing was changed.', env);
  const code = u.searchParams.get('code');
  if (!code) return gPage('Google sign-in failed', 'No code came back.', env);
  const { ok, tok } = await gExchange(env, code);
  if (rec.kind === 'login') return loginDone(env, ok, tok);
  if (!ok || !tok.refresh_token) return gPage('Google sign-in failed', 'Google did not give a long-lasting permission. Remove Vesper from myaccount.google.com/permissions and try again.', env);
  const uenv = rec.uid === 'owner' || !rec.uid ? ownerEnv(env) : userEnv(env, rec.uid);
  await uenv.VESPER.put('google', JSON.stringify({ refresh: tok.refresh_token, scope: tok.scope || '', at: Date.now() }));
  await uenv.VESPER.delete('gcal');   // a new sign-in starts with the default calendar
  gAccessCache.set('cal:' + uenv.UID, { token: tok.access_token || '', exp: Date.now() + Math.max(0, (tok.expires_in || 0) - 60) * 1000 });
  return gPage('Google Calendar is connected', 'You can close this tab and go back to Vesper.', env);
}

// ---- Sign in with Google ----------------------------------------------------------------
const G_LOGIN_SCOPE = 'openid email profile https://www.googleapis.com/auth/drive.appdata';
const SESSION_DAYS = 90;
const emails = (v) => String(v || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

function idClaims(idToken) {
  try {
    const part = String(idToken).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part + '='.repeat((4 - (part.length % 4)) % 4)));
  } catch (e) { return null; }
}

async function loginDone(env, ok, tok) {
  const claims = ok ? idClaims(tok.id_token) : null;
  // The token came straight from Google over a secure connection; still make sure it is for this app and a verified address.
  if (!claims || claims.aud !== env.GOOGLE_CLIENT_ID || !claims.sub || !claims.email || claims.email_verified === false) return gPage('Google sign-in failed', 'Google did not confirm who you are. Try again.', env);
  const email = String(claims.email).toLowerCase();
  const owner = !!env.OWNER_EMAIL && email === String(env.OWNER_EMAIL).trim().toLowerCase();
  const allowed = emails(env.ALLOWED_EMAILS);
  if (!owner && allowed.length && !allowed.includes(email)) return gPage('This Vesper is private', 'Your Google account is not on the list for this site.', env);
  const sub = String(claims.sub).replace(/[^0-9a-zA-Z_-]/g, '');
  if (!owner) {
    const known = await env.VESPER.get('user:' + sub, 'json');
    if (!known) {
      const count = Number(await env.VESPER.get('usercount')) || 0;
      if (count >= (parseInt(env.MAX_USERS, 10) || 100)) return gPage('Sign-up is full', 'This Vesper is not taking new people right now.', env);
      await env.VESPER.put('usercount', String(count + 1));
    }
    await env.VESPER.put('user:' + sub, JSON.stringify({ email, at: Date.now() }));
  }
  const space = owner ? ownerEnv(env) : userEnv(env, sub);
  if (tok.refresh_token) await space.VESPER.put('drive', JSON.stringify({ ...((await space.VESPER.get('drive', 'json')) || {}), refresh: tok.refresh_token }));
  const token = gRand() + gRand();
  await env.VESPER.put('sess:' + (await sha(token)), JSON.stringify({ sub, email, owner, exp: Date.now() + SESSION_DAYS * 86400000 }));
  const once = gRand();
  await env.VESPER.put('login:' + once, JSON.stringify({ token, email, owner, exp: Date.now() + 2 * 60000 }));
  return new Response(null, { status: 302, headers: { Location: `${gBase(env)}/#/signin?c=${once}`, 'Cache-Control': 'no-store' } });
}

// ---- Your copy in your own Google Drive (a hidden app folder only Vesper can see) -------------
const DRIVE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UP = 'https://www.googleapis.com/upload/drive/v3';
const DRIVE_FILE = 'vesper-data.json';
const BACKUP_EVERY = 5 * 60000;

async function driveToken(env) {
  const hit = gAccessCache.get('drive:' + env.UID);
  if (hit && hit.exp > Date.now()) return hit.token;
  const rec = await env.VESPER.get('drive', 'json');
  if (!rec || !rec.refresh) return '';
  const res = await fetch(G_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: gForm({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: rec.refresh, grant_type: 'refresh_token' }) });
  const tok = await res.json().catch(() => ({}));
  if (!res.ok || !tok.access_token) return '';
  gAccessCache.set('drive:' + env.UID, { token: tok.access_token, exp: Date.now() + Math.max(0, (tok.expires_in || 3600) - 60) * 1000 });
  return tok.access_token;
}

async function driveFileId(env, access, rec) {
  if (rec.fileId) return rec.fileId;
  const q = new URLSearchParams({ spaces: 'appDataFolder', q: `name='${DRIVE_FILE}'`, fields: 'files(id)' });
  const res = await fetch(`${DRIVE}/files?${q}`, { headers: { Authorization: 'Bearer ' + access } });
  const data = res.ok ? await res.json().catch(() => ({})) : {};
  return (data.files && data.files[0] && data.files[0].id) || '';
}

// Saves a copy at most every five minutes. Never stops a sync if Google is slow or says no.
async function driveBackup(env, state, { force = false } = {}) {
  try {
    const rec = await env.VESPER.get('drive', 'json');
    if (!rec || !rec.refresh) return false;
    if (!force && Date.now() - (rec.last || 0) < BACKUP_EVERY) return false;
    const access = await driveToken(env);
    if (!access) return false;
    const id = await driveFileId(env, access, rec);
    const boundary = 'vesper' + gRand();
    const meta = id ? { name: DRIVE_FILE } : { name: DRIVE_FILE, parents: ['appDataFolder'] };
    const body = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ ...state, settings: (await env.VESPER.get('settings', 'json')) || undefined })}\r\n--${boundary}--`;
    const res = await fetch(id ? `${DRIVE_UP}/files/${id}?uploadType=multipart` : `${DRIVE_UP}/files?uploadType=multipart`, { method: id ? 'PATCH' : 'POST', headers: { Authorization: 'Bearer ' + access, 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
    const file = await res.json().catch(() => ({}));
    if (!res.ok) return false;
    await env.VESPER.put('drive', JSON.stringify({ ...rec, fileId: file.id || id, last: Date.now() }));
    return true;
  } catch (e) { return false; }
}

async function driveRestore(env) {
  const rec = await env.VESPER.get('drive', 'json');
  const access = rec && rec.refresh ? await driveToken(env) : '';
  if (!access) throw new Error('Google Drive is not connected. Sign in with Google again.');
  const id = await driveFileId(env, access, rec);
  if (!id) throw new Error('No Vesper copy was found in your Google Drive yet.');
  const res = await fetch(`${DRIVE}/files/${id}?alt=media`, { headers: { Authorization: 'Bearer ' + access } });
  const data = res.ok ? await res.json().catch(() => null) : null;
  if (!data || !Array.isArray(data.projects) || !Array.isArray(data.decks)) throw new Error('The copy in Google Drive could not be read.');
  return data;
}

async function driveDelete(env) {
  try {
    const rec = await env.VESPER.get('drive', 'json');
    if (!rec || !rec.refresh) return;
    const access = await driveToken(env);
    if (access) {
      const id = await driveFileId(env, access, rec);
      if (id) await fetch(`${DRIVE}/files/${id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + access } });
    }
    await fetch(`${G_REVOKE}?${gForm({ token: rec.refresh })}`, { method: 'POST' });
  } catch (e) { /* best effort */ }
}

async function gAccessToken(env) {
  const hit = gAccessCache.get('cal:' + env.UID);
  if (hit && hit.token && hit.exp > Date.now()) return hit.token;
  const saved = await env.VESPER.get('google', 'json');
  if (!saved || !saved.refresh) throw new Error('Google Calendar is not connected. Connect it from Vesper (Add to calendar).');
  const res = await fetch(G_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: gForm({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: saved.refresh, grant_type: 'refresh_token' }) });
  const tok = await res.json().catch(() => ({}));
  if (!res.ok || !tok.access_token) {
    if (tok.error === 'invalid_grant') { await env.VESPER.delete('google'); throw new Error('The Google sign-in expired. Connect Google Calendar again.'); }
    throw new Error('Google would not give access right now. Try again in a minute.');
  }
  gAccessCache.set('cal:' + env.UID, { token: tok.access_token, exp: Date.now() + Math.max(0, (tok.expires_in || 3600) - 60) * 1000 });
  return tok.access_token;
}

async function gDisconnect(env) {
  const saved = await env.VESPER.get('google', 'json');
  if (saved && saved.refresh) { try { await fetch(`${G_REVOKE}?${gForm({ token: saved.refresh })}`, { method: 'POST' }); } catch (e) { /* best effort */ } }
  await env.VESPER.delete('google');
  gAccessCache.delete('cal:' + env.UID);
}

const G_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
function gAddMinutes(local, minutes) {
  const [d, t] = local.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, da, h, mi) + minutes * 60000).toISOString().slice(0, 19);
}

// Creates the event, or updates it when the same key (task + kind) was scheduled before, so nothing doubles up.
async function gEvent(env, { key, title, details, start, minutes }) {
  if (!G_LOCAL.test(String(start || ''))) throw new Error('start must look like 2026-10-28T18:00 (local time).');
  const mins = Math.max(5, Math.min(1440, parseInt(minutes, 10) || 30));
  const startAt = start.length === 16 ? start + ':00' : start;
  const tz = gTz(env);
  const body = JSON.stringify({ summary: String(title || 'Vesper').slice(0, 200), description: String(details || '').slice(0, 4000), start: { dateTime: startAt, timeZone: tz }, end: { dateTime: gAddMinutes(startAt, mins), timeZone: tz } });
  const access = await gAccessToken(env);
  const head = { Authorization: 'Bearer ' + access, 'Content-Type': 'application/json' };
  const cal = await gCal(env);
  key = `${cal.id}|${key}`;   // switching calendars never touches events in the old one
  const map = (await env.VESPER.get('gevents', 'json')) || {};
  let res = null;
  let moved = false;
  if (map[key]) {
    res = await fetch(`${gApi(cal.id)}/${encodeURIComponent(map[key])}`, { method: 'PATCH', headers: head, body });
    if (res.status === 404 || res.status === 410) res = null; else moved = true;
  }
  if (!res) res = await fetch(gApi(cal.id), { method: 'POST', headers: head, body });
  const ev = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'Google refused the calendar change. Connect Google Calendar again.' : 'Google Calendar could not save the event.');
  map[key] = ev.id;
  await env.VESPER.put('gevents', JSON.stringify(map));
  return { id: ev.id, link: ev.htmlLink || '', moved };
}

async function googleRoutes(request, env, origin, path) {
  const status = async () => { const on = gConfigured(env) && !!((await env.VESPER.get('google', 'json')) || {}).refresh; return { configured: gConfigured(env), connected: on, calendar: on ? (await gCal(env)).name : '' }; };
  if (path === '/google/status' && request.method === 'GET') return json(200, await status(), origin);
  if (!gConfigured(env)) return json(400, { error: 'Google is not set up on the hub yet (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and PUBLIC_URL).', configured: false }, origin);
  if (path === '/google/calendars' && request.method === 'GET') {
    try {
      const res = await fetch(`${G_CAL}/users/me/calendarList?minAccessRole=writer&showHidden=true`, { headers: { Authorization: 'Bearer ' + (await gAccessToken(env)) } });
      if (!res.ok) return json(400, { error: 'Google would not list your calendars. Press Connect Google again to allow it.' }, origin);
      const data = await res.json();
      const cur = await gCal(env);
      return json(200, { selected: cur.id, calendars: (data.items || []).map((c) => ({ id: c.id, name: c.summaryOverride || c.summary || c.id, primary: !!c.primary })) }, origin);
    } catch (e) { return json(400, { error: e.message }, origin); }
  }
  if (path === '/google/calendar' && request.method === 'POST') {
    let b;
    try { b = JSON.parse(await request.text()); } catch (e) { return json(400, { error: 'invalid JSON' }, origin); }
    try {
      const head = { Authorization: 'Bearer ' + (await gAccessToken(env)), 'Content-Type': 'application/json' };
      if (b.create) {
        const name = String(b.create).trim().slice(0, 80) || 'Vesper Tasks';
        const res = await fetch(`${G_CAL}/calendars`, { method: 'POST', headers: head, body: JSON.stringify({ summary: name, timeZone: gTz(env) }) });
        const cal = await res.json().catch(() => ({}));
        if (!res.ok || !cal.id) return json(400, { error: 'Google would not create the calendar. Press Connect Google again to allow it.' }, origin);
        await env.VESPER.put('gcal', JSON.stringify({ id: cal.id, name }));
        return json(200, { selected: cal.id, name }, origin);
      }
      const list = await fetch(`${G_CAL}/users/me/calendarList?minAccessRole=writer&showHidden=true`, { headers: head });
      const data = list.ok ? await list.json() : { items: [] };
      const hit = (data.items || []).find((c) => c.id === b.id);
      if (!hit) return json(400, { error: 'That calendar is not one you can add events to.' }, origin);
      await env.VESPER.put('gcal', JSON.stringify({ id: hit.id, name: hit.summaryOverride || hit.summary || hit.id }));
      return json(200, { selected: hit.id, name: hit.summary }, origin);
    } catch (e) { return json(400, { error: e.message }, origin); }
  }
  if (path === '/google/start' && request.method === 'POST') return json(200, { url: await gStart(env) }, origin);
  if (path === '/google/disconnect' && request.method === 'POST') { await gDisconnect(env); return json(200, { connected: false }, origin); }
  if (path === '/calendar/event' && request.method === 'POST') {
    let b;
    try { b = JSON.parse(await request.text()); } catch (e) { return json(400, { error: 'invalid JSON' }, origin); }
    try {
      const out = await gEvent(env, { key: `${String(b.deck || 'x').slice(0, 40)}:${String(b.kind || 'work').slice(0, 20)}`, title: b.title, details: b.details, start: b.start, minutes: b.minutes });
      return json(200, out, origin);
    } catch (e) { return json(400, { error: e.message }, origin); }
  }
  return json(404, { error: 'not found' }, origin);
}

// ---- Claude connector (MCP over HTTP, plain JSON replies) -------------------------------

const norm2 = (s) => String(s || '').trim().toLowerCase();

function findTask(state, ref) {
  const r = norm2(ref);
  if (!r) return null;
  return state.decks.find((d) => d.id === ref) || (() => {
    const hits = state.decks.filter((d) => norm2(d.title) === r);
    return hits.length === 1 ? hits[0] : null;
  })();
}

function whereIs(d) {
  const sl = SLIDES[d.slide];
  if (d.finished) return 'finished';
  if (sl.stage) return `${sl.stage.name}, slide ${d.slide + 1} of ${SLIDES.length}`;
  return d.reached === 0 ? 'not started' : 'recap';
}

function taskSummary(state, d) {
  const pr = progress(d);
  const p = state.projects.find((x) => x.id === d.projectId);
  return { id: d.id, title: d.title, project: p ? p.name : '', where: whereIs(d), stepsFilled: `${pr.filled}/${pr.total}`, selahPassed: STAGES.filter((s) => d.selah[s.id]).map((s) => s.name) };
}

const obj = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });

const TOOLS = [
  { name: 'vesper_framework', description: 'The Vesper framework: five stages (Vision, Research, Plan, Execute, Review), their slides, steps, the question for each step, and the Selah pause question per stage. Read this first.', inputSchema: obj({}), annotations: { readOnlyHint: true } },
  { name: 'vesper_overview', description: 'List all projects and tasks with where each task is, how many of its 34 steps are filled, and which Selah pauses the person has passed.', inputSchema: obj({}), annotations: { readOnlyHint: true } },
  { name: 'vesper_get_task', description: 'Everything written in one task: every step with its note and whether it is ticked.', inputSchema: obj({ task: str('Task id or exact title') }, ['task']), annotations: { readOnlyHint: true } },
  { name: 'vesper_next_questions', description: 'The next empty steps of a task, in order, each with the plain question to ask the person. Use this to interview them, then save each answer with vesper_set_note.', inputSchema: obj({ task: str('Task id or exact title'), limit: { type: 'integer', description: 'How many (default 5, max 20)' } }, ['task']), annotations: { readOnlyHint: true } },
  { name: 'vesper_create_project', description: 'Create a project (a group of tasks).', inputSchema: obj({ name: str('Project name') }, ['name']) },
  { name: 'vesper_create_task', description: 'Create a task inside a project.', inputSchema: obj({ project: str('Project id or exact name'), title: str('Task name') }, ['project', 'title']) },
  { name: 'vesper_set_note', description: 'Write a note into one step (or the slide notes when step is left out). Filling a step also ticks it. Existing text is kept: new text is appended unless mode is "replace". Never overwrite what the person wrote unless they asked.', inputSchema: obj({ task: str('Task id or exact title'), slide: str('Slide key such as vision.why'), step: { type: 'integer', description: 'Step number on that slide, from vesper_framework. Omit for the slide notes.' }, text: str('The note, in the person\'s words, short'), mode: { type: 'string', enum: ['append', 'replace'] }, tick: { type: 'boolean', description: 'Set false to leave the step unticked' } }, ['task', 'slide', 'text']) },
  { name: 'vesper_schedule', description: 'Put a task on the person\'s Google Calendar (once they have connected it in Vesper). Use kind "work" for a work block and "selah" for the pause at the end of a stage. Scheduling the same task and kind again moves the existing event. Scheduling a Selah does not pass it; the person still does that.', inputSchema: obj({ task: str('Task id or exact title'), when: str('Local start time like 2026-10-28T18:00'), minutes: { type: 'integer', description: 'Length, default 30' }, kind: { type: 'string', enum: ['work', 'selah'] }, title: str('Optional event title') }, ['task', 'when']) },
  { name: 'vesper_tick', description: 'Tick or untick one step.', inputSchema: obj({ task: str('Task id or exact title'), slide: str('Slide key such as vision.why'), step: { type: 'integer' }, done: { type: 'boolean' } }, ['task', 'slide', 'step']) },
];

async function callTool(env, name, a) {
  const state = await loadState(env);
  const db = makeDb(state);
  const text = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
  const fail = (m) => ({ isError: true, content: [{ type: 'text', text: m }] });
  const run = async (actions) => {
    const out = applyActions(actions, { db });
    if (out.changes.length) await saveState(env, state);
    return text({ changed: out.changes.map((c) => c.text), notApplied: out.skipped });
  };

  if (name === 'vesper_framework') {
    return text(STAGES.map((st) => ({
      stage: st.name, selahQuestion: st.selah,
      slides: st.subs.map((sub) => ({ slide: `${st.id}.${sub.id}`, name: sub.name, about: sub.what, steps: sub.steps.map((t, i) => ({ step: i, text: t, question: QUESTIONS[`${st.id}.${sub.id}#${i}`] })) })),
    })));
  }
  if (name === 'vesper_overview') {
    return text(state.projects.map((p) => ({ project: p.name, id: p.id, tasks: state.decks.filter((d) => d.projectId === p.id).map((d) => taskSummary(state, d)) })));
  }
  if (name === 'vesper_get_task' || name === 'vesper_next_questions') {
    const d = findTask(state, a.task);
    if (!d) return fail(`No task found for "${a.task}". Use vesper_overview to see the ids.`);
    if (name === 'vesper_next_questions') {
      const n = Math.max(1, Math.min(20, parseInt(a.limit, 10) || 5));
      return text({ ...taskSummary(state, d), next: emptySteps(d).slice(0, n).map((s) => ({ slide: s.slide.key, step: s.step, stepText: s.text, question: s.question })), reminder: 'Only the person passes a Selah. Remind them of the stage question when a stage is filled.' });
    }
    return text({
      ...taskSummary(state, d),
      steps: allSteps().map((s) => ({ slide: s.slide.key, step: s.step, stepText: s.text, note: d.notes[s.key] || '', ticked: !!d.ticks[tickKey(s.slide.stage, s.slide.sub, s.step)] })),
      slideNotes: Object.fromEntries(Object.entries(d.notes).filter(([k, v]) => !k.includes('#') && String(v).trim())),
    });
  }
  if (name === 'vesper_create_project') return run([{ type: 'create_project', name: a.name }]);
  if (name === 'vesper_create_task') return run([{ type: 'create_task', project: a.project, title: a.title }]);
  if (name === 'vesper_set_note') {
    const d = findTask(state, a.task);
    if (!d) return fail(`No task found for "${a.task}".`);
    return run([{ type: 'set_note', task: d.id, slide: a.slide, step: a.step, text: a.text, mode: a.mode, tick: a.tick }]);
  }
  if (name === 'vesper_tick') {
    const d = findTask(state, a.task);
    if (!d) return fail(`No task found for "${a.task}".`);
    return run([{ type: 'tick', task: d.id, slide: a.slide, step: a.step, done: a.done }]);
  }
  if (name === 'vesper_schedule') {
    const d = findTask(state, a.task);
    if (!d) return fail(`No task found for "${a.task}".`);
    if (!gConfigured(env)) return fail('Google Calendar is not set up on the hub yet.');
    const kind = a.kind === 'selah' ? 'selah' : 'work';
    const stage = (SLIDES[d.slide] && SLIDES[d.slide].stage) || STAGES[0];
    const base = gBase(env);
    const title = a.title || (kind === 'selah' ? `Selah: ${d.title} (${stage.name})` : `${d.title}: ${whereIs(d)}`);
    const details = `Vesper task "${d.title}".${kind === 'selah' ? ` Pause and ask: ${stage.selah}` : ''}\n${base}/#/d/${d.id}`;
    try {
      const out = await gEvent(env, { key: `${d.id}:${kind}`, title, details, start: a.when, minutes: a.minutes });
      return text({ scheduled: title, when: a.when, link: out.link });
    } catch (e) { return fail(e.message); }
  }
  return fail(`Unknown tool "${name}".`);
}

async function handleRpc(env, msg) {
  const id = msg.id;
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (msg.method === 'initialize') {
    return ok({
      protocolVersion: (msg.params && msg.params.protocolVersion) || '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'vesper', version: '1.0.0' },
      instructions: 'Vesper is a work framework: Vision, Research, Plan, Execute, Review, with a Selah pause after each stage. Read vesper_framework first. To interview the person, call vesper_next_questions, ask one question at a time, and save each answer with vesper_set_note. You cannot pass a Selah or delete anything; remind the person to take each Selah themselves.',
    });
  }
  if (msg.method === 'ping') return ok({});
  if (msg.method === 'tools/list') return ok({ tools: TOOLS });
  if (msg.method === 'tools/call') {
    const p = msg.params || {};
    if (!TOOLS.some((t) => t.name === p.name)) return err(-32602, `Unknown tool ${p.name}`);
    try { return ok(await callTool(env, p.name, p.arguments || {})); } catch (e) { return ok({ isError: true, content: [{ type: 'text', text: 'Something went wrong in Vesper.' }] }); }
  }
  if (typeof msg.method === 'string' && msg.method.startsWith('notifications/')) return null;
  return err(-32601, 'Method not found');
}

async function mcp(request, env) {
  if (request.method !== 'POST') return new Response('Use POST', { status: 405, headers: { Allow: 'POST' } });
  const text = await request.text();
  if (text.length > MAX_BODY) return json(413, { error: 'too large' });
  let body;
  try { body = JSON.parse(text); } catch (e) { return json(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  const list = Array.isArray(body) ? body : [body];
  const out = [];
  for (const m of list) { const r = await handleRpc(env, m || {}); if (r) out.push(r); }
  if (!out.length) return new Response(null, { status: 202 });
  return json(200, Array.isArray(body) ? out : out[0]);
}

// ---- Sync -------------------------------------------------------------------------------

async function sync(request, env, origin) {
  if (request.method === 'GET') return json(200, { state: await loadState(env) }, origin);
  if (request.method !== 'PUT') return json(405, { error: 'use GET or PUT' }, origin);
  const text = await request.text();
  if (text.length > MAX_BODY) return json(413, { error: 'too large' }, origin);
  let body;
  try { body = JSON.parse(text); } catch (e) { return json(400, { error: 'invalid JSON' }, origin); }
  const inc = body && body.state;
  if (!inc || !Array.isArray(inc.projects) || !Array.isArray(inc.decks)) return json(400, { error: 'state with projects and decks is required' }, origin);
  const stored = await loadState(env);
  const merged = mergeStates(stored, inc);
  if (!sameState(stored, merged)) await saveState(env, merged);
  await driveBackup(env, merged);
  return json(200, { state: merged }, origin);
}

// ---- AI proxy ---------------------------------------------------------------------------

async function aiProxy(request, env, origin) {
  if (!env.OWNER) return json(403, { error: 'The shared AI proxy is for the owner only. Use your own AI key in AI settings.' }, origin);
  if (!env.NVIDIA_API_KEY) return json(500, { error: 'NVIDIA_API_KEY is not set on the Worker' }, origin);
  const text = await request.text();
  if (text.length > MAX_AI_BODY) return json(413, { error: 'request too large' }, origin);
  let body;
  try { body = JSON.parse(text); } catch (e) { return json(400, { error: 'invalid JSON' }, origin); }
  if (!body || typeof body.model !== 'string' || !Array.isArray(body.messages)) return json(400, { error: 'model and messages are required' }, origin);
  const allowed = (env.MODELS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(body.model)) return json(403, { error: 'model not allowed' }, origin);
  body.stream = false;
  body.max_tokens = Math.min(Number(body.max_tokens) || 2048, MAX_TOKENS);
  const upstream = await fetch(UPSTREAM, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.NVIDIA_API_KEY}` },
    body: JSON.stringify(body),
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('Content-Type') || 'application/json', ...cors(origin) },
  });
}

// ---- Account -----------------------------------------------------------------------------

// Personal settings (AI address, key and models) follow the person to every device.
const SETTINGS_KEYS = ['url', 'key', 'draft', 'review', 'backup'];
function cleanSettings(x) {
  const ai = {};
  for (const k of SETTINGS_KEYS) if (x && x.ai && typeof x.ai[k] === 'string') ai[k] = x.ai[k].slice(0, 500);
  return { ai };
}

async function accountRoutes(request, ctx, origin, path) {
  const env = ctx.env;
  if (path === '/me' && request.method === 'GET') {
    const drive = await env.VESPER.get('drive', 'json');
    return json(200, { email: ctx.email, owner: ctx.owner, drive: { connected: !!(drive && drive.refresh), last: (drive && drive.last) || 0 } }, origin);
  }
  if (path === '/me/settings') {
    if (request.method === 'GET') return json(200, { settings: (await env.VESPER.get('settings', 'json')) || { ai: {} } }, origin);
    if (request.method === 'PUT') {
      const text = await request.text();
      if (text.length > 8000) return json(413, { error: 'too large' }, origin);
      let body; try { body = JSON.parse(text); } catch (e) { return json(400, { error: 'invalid JSON' }, origin); }
      const clean = cleanSettings(body && body.settings);
      await env.VESPER.put('settings', JSON.stringify(clean));
      return json(200, { settings: clean }, origin);
    }
    return json(405, { error: 'use GET or PUT' }, origin);
  }
  if (path === '/me/restore' && request.method === 'POST') {
    try {
      const copy = await driveRestore(env);
      const merged = mergeStates(await loadState(env), copy);
      await saveState(env, merged);
      if (copy.settings && !(await env.VESPER.get('settings', 'json'))) await env.VESPER.put('settings', JSON.stringify(cleanSettings(copy.settings)));
      return json(200, { state: merged }, origin);
    } catch (e) { return json(400, { error: e.message }, origin); }
  }
  if (path === '/me/backup' && request.method === 'POST') {
    const ok = await driveBackup(env, await loadState(env), { force: true });
    return json(ok ? 200 : 400, ok ? { saved: true } : { error: 'Could not save to Google Drive. Sign in with Google again.' }, origin);
  }
  if (path === '/me/delete' && request.method === 'POST') {
    if (ctx.owner) return json(400, { error: 'The owner space is not deleted from the app.' }, origin);
    await driveDelete(env);
    await gDisconnect(env);
    for (const k of ['state', 'google', 'gcal', 'gevents', 'drive', 'settings']) await env.VESPER.delete(k);
    await env.RAW.delete('user:' + env.UID);
    await env.RAW.put('usercount', String(Math.max(0, (Number(await env.RAW.get('usercount')) || 1) - 1)));
    if (ctx.sessKey) await env.RAW.delete(ctx.sessKey);
    return json(200, { deleted: true }, origin);
  }
  if (path === '/auth/logout' && request.method === 'POST') {
    if (ctx.sessKey) await env.RAW.delete(ctx.sessKey);
    return json(200, { signedOut: true }, origin);
  }
  return json(404, { error: 'not found' }, origin);
}

// ---- Entry ------------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');

    // The Claude connector: token in the address (or a Bearer header). Owner only. No browser origin needed.
    const m = path.match(/^\/mcp(?:\/(.+))?$/);
    if (m) {
      if (!hasToken(env, m[1] ? decodeURIComponent(m[1]) : bearer(request))) return json(401, { error: 'bad token' });
      if (!env.VESPER) return json(500, { error: 'KV binding VESPER is not set on the Worker' });
      return mcp(request, ownerEnv(env));
    }

    // Google sends the person back here after sign-in. It carries no token; a one-time state in the address protects it.
    if (path === '/google/callback' && request.method === 'GET') {
      if (!env.VESPER) return json(500, { error: 'KV binding VESPER is not set on the Worker' });
      return gCallback(request, ownerEnv(env));
    }

    // The app: only from allowed origins.
    const origin = request.headers.get('Origin') || '';
    const extra = String(env.ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean);
    const known = ALLOWED_ORIGINS.includes(origin) || extra.includes(origin);
    // Browsers leave the Origin header off for same-site GET requests; the token below still protects those.
    if (origin && !known) return json(403, { error: 'origin not allowed' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (!env.VESPER && path !== '/v1/chat/completions' && path !== '/chat/completions') return json(500, { error: 'KV binding VESPER is not set on the Worker' }, origin);

    // Lets the app know whether this hub offers Google sign-in (no secrets in the answer).
    if (path === '/auth/config' && request.method === 'GET') return json(200, { google: gConfigured(env) }, origin);

    // Signing in has no token yet, so these two need a known website address instead.
    if (path === '/auth/google/start' && request.method === 'POST') {
      if (!known) return json(403, { error: 'origin not allowed' }, origin);
      if (!gConfigured(env)) return json(400, { error: 'Google is not set up on this hub yet.' }, origin);
      return json(200, { url: await gStart(ownerEnv(env), 'login') }, origin);
    }
    if (path === '/auth/exchange' && request.method === 'POST') {
      if (!known) return json(403, { error: 'origin not allowed' }, origin);
      let b;
      try { b = JSON.parse(await request.text()); } catch (e) { return json(400, { error: 'invalid JSON' }, origin); }
      const key = 'login:' + String((b && b.code) || '').replace(/[^0-9a-f]/g, '');
      const rec = await env.VESPER.get(key, 'json');
      await env.VESPER.delete(key);   // a one-time code
      if (!rec || rec.exp < Date.now()) return json(400, { error: 'That sign-in expired. Try again.' }, origin);
      return json(200, { token: rec.token, email: rec.email, owner: rec.owner }, origin);
    }

    const ctx = await who(env, bearer(request));
    if (!ctx) return json(401, { error: 'bad token' }, origin);

    if (path === '/sync') return sync(request, ctx.env, origin);
    if (path.startsWith('/google/') || path === '/calendar/event') return googleRoutes(request, ctx.env, origin, path);
    if (path === '/me' || path.startsWith('/me/') || path === '/auth/logout') return accountRoutes(request, ctx, origin, path);
    if (request.method === 'POST' && (path === '/v1/chat/completions' || path === '/chat/completions')) return aiProxy(request, ctx.env, origin);
    return json(404, { error: 'not found' }, origin);
  },
};
