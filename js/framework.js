// The Vesper framework as data. Edit stages, sub-stages and steps here only;
// every screen in the app is generated from this file.

export const CONFIG = {
  // true: Selah warns about unticked steps but still lets you continue.
  // false: Continue stays blocked until every step in the stage is ticked.
  softSelah: true,
};

export const STAGES = [
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

export function stageById(id) {
  return STAGES.find((s) => s.id === id);
}

// Slide order for one deck: cover, then per stage its sub-stage slides and a Selah slide, then recap.
export const SLIDES = (() => {
  const out = [{ type: 'cover', key: 'cover' }];
  for (const stage of STAGES) {
    stage.subs.forEach((sub, i) => out.push({ type: 'sub', key: `${stage.id}.${sub.id}`, stage, sub, n: i + 1 }));
    out.push({ type: 'selah', key: `${stage.id}.selah`, stage });
  }
  out.push({ type: 'recap', key: 'recap' });
  return out;
})();

export const slideIndex = (key) => SLIDES.findIndex((s) => s.key === key);
export const firstSlideOf = (stageId) => slideIndex(`${stageId}.${stageById(stageId).subs[0].id}`);
export const selahIndex = (stageId) => slideIndex(`${stageId}.selah`);

export const tickKey = (stage, sub, i) => `${stage.id}.${sub.id}:${i}`;

export function subProgress(deck, stage, sub) {
  let done = 0;
  for (let i = 0; i < sub.steps.length; i++) if (deck.ticks[tickKey(stage, sub, i)]) done++;
  return { done, total: sub.steps.length };
}

export function subDone(deck, stage, sub) {
  const p = subProgress(deck, stage, sub);
  return p.done === p.total;
}

export function stagePending(deck, stage) {
  let pending = 0;
  for (const sub of stage.subs) {
    const p = subProgress(deck, stage, sub);
    pending += p.total - p.done;
  }
  return pending;
}

// 'done' | 'now' | 'todo' for one slide chip.
export function chipState(deck, slide, idx) {
  const finishedChip = slide.type === 'sub' ? subDone(deck, slide.stage, slide.sub) : !!deck.selah[slide.stage.id];
  if (finishedChip) return 'done';
  return deck.slide === idx ? 'now' : 'todo';
}

export function stageState(deck, stage) {
  const idxs = [...stage.subs.map((s) => slideIndex(`${stage.id}.${s.id}`)), selahIndex(stage.id)];
  const allDone = idxs.every((i) => chipState(deck, SLIDES[i], i) === 'done');
  if (allDone) return 'done';
  if (idxs.includes(deck.slide)) return 'now';
  return 'todo';
}

export function atSelah(deck) {
  const slide = SLIDES[deck.slide];
  return !deck.finished && slide.type === 'selah' && !deck.selah[slide.stage.id];
}

export function deckStatus(deck) {
  const pct = Math.round((deck.reached / (SLIDES.length - 1)) * 100);
  if (deck.finished) return { label: 'Finished', stageId: null, pct: 100, tone: 'do', state: 'done' };
  const slide = SLIDES[deck.slide];
  if (slide.stage) return { label: slide.stage.name, stageId: slide.stage.id, pct, tone: slide.stage.tone, state: 'now' };
  if (slide.type === 'cover' && deck.reached === 0) return { label: 'Not started', stageId: null, pct: 0, tone: 'think', state: 'todo' };
  return { label: 'Recap', stageId: null, pct, tone: 'do', state: 'now' };
}
