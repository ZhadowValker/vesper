// Sample data: a book-writing project. Loaded from the main dashboard with "Sample".
// Four tasks at different points, so every state is visible: finished, in progress,
// waiting at Selah, and just started. Notes are written for every step.
//
// A note for a step is stored under "<stage>.<sub>#<step number>", a note for a slide under "<stage>.<sub>".

import { SLIDES, slideIndex, tickKey } from './framework.js';

const DAY = 86400000;

// ---------------------------------------------------------------------------------------------
// Task 1: Define the book. Finished, with one loop back to Plan. Every field is filled in.
// ---------------------------------------------------------------------------------------------
const DEFINE = {
  'vision.why': {
    s: ['I keep explaining the same focus habits to colleagues, one at a time. A book lets me say it once, properly.',
        'Because a short, honest guide to protecting one focused hour a day does not exist for people with real jobs.'],
    n: 'If this stays vague, the draft will wander. Keep this page open when writing.',
  },
  'vision.goal': {
    s: ['A 55,000-word paperback with 12 chapters that someone reads on a train and uses the next morning.',
        'The Quiet Hour is a practical guide to protecting one hour of deep work a day, for people with full calendars. Each chapter ends with one small change to try this week.'],
    n: 'Reader: a manager or engineer, 28 to 45, tired of busy days that produce little.',
  },
  'vision.check': {
    s: ['Give the first three chapters to five readers outside my circle and ask what they changed.',
        'At least three of the five change something in their week and say so without being asked.'],
    n: 'Not sales numbers. Sales come later.',
  },
  'vision.limits': {
    s: ['No app reviews, no morning routine advice, no life story chapters, no fiction, no audiobook in this pass.'],
    n: 'The "no morning routine" rule is the hardest to hold. Hold it.',
  },
  'research.questions': {
    s: ['Who is it for? What problem do they name first? Why do existing books fail them? Where do they buy and read? When do they have time to read? How long should it be?',
        'Why do existing books fail them? What problem do they name first? How long should it be?',
        'Read 40 reviews of the five best-selling focus books. Interviewed four colleagues for 20 minutes each.'],
    n: 'The interview question that worked best: "When did you last finish a self-help book?"',
  },
  'research.timelimit': {
    s: ['Two weeks, 90 minutes a day. Stop on day 14 even if unsure.'],
    n: 'Stopped on day 13. I had enough to choose.',
  },
  'research.findings': {
    s: ['Readers finish short books. Chapters under 3,000 words get read. Existing books are long on theory and short on a first step.',
        'Whether readers want exercises inside the book or a free workbook to download. The price.'],
    n: 'All four colleagues said they would read a book with one task per chapter.',
  },
  'research.decide': {
    s: ['A short paperback of 12 chapters, about 55,000 words, one task per chapter, with the workbook as a free download.'],
    n: 'Rejected: a long academic style, and a video course first.',
  },
  'plan.map': {
    s: ['Outline the chapters, write each chapter, first read-through, revise, beta readers, copy edit, cover and layout, publish.',
        'Outline, chapters 1 to 12, read-through, revise, beta readers, revise again, copy edit, layout and cover, publish.',
        'The cover waits for the final title. Layout waits for the copy edit. Beta readers wait for a full draft.'],
    n: 'First order had beta readers before the read-through. That was wrong. Fixed in the loop back.',
  },
  'plan.time': {
    s: ['Outline 2 weeks. Chapters 12 weeks. Read-through 1 week. Revision 4 weeks. Beta readers 3 weeks. Copy edit 3 weeks. Layout and cover 3 weeks. Publish 1 week.',
        'About 29 weeks, around seven months. With slack, eight months.'],
    n: 'The chapters are the risk. One missed week moves everything after it.',
  },
  'plan.risks': {
    s: ['A second book proposal, a website redesign, a launch video.',
        'All three discarded for this pass. The website can be one page. Revisit after publishing.'],
    n: 'Cutting these saved about six weeks.',
  },
  'plan.firststep': {
    s: ['Write the list of twelve chapter titles in one sitting, 45 minutes, tonight.'],
    n: 'Titles only. No sentences yet.',
  },
  'execute.slice': {
    s: ['The outline becomes: reader promise, chapter titles, one line per chapter, the one task per chapter. Four slices.',
        'Each slice fits one evening of 45 minutes.'],
    n: 'A slice of one evening worked. A slice of one weekend did not.',
  },
  'execute.learn': {
    s: ['The one task per chapter was easier to write than the chapter summary. Starting from the task makes the chapter clear.'],
    n: 'Write the task first, in every chapter from now on.',
  },
  'execute.adjust': {
    s: ['Chapter 6 needs two chapters. Chapter 11 and 12 say the same thing.',
        'Now 12 chapters again: split 6, merged 11 and 12. Schedule is unchanged.'],
    n: 'The map changed twice. Both times the change made it simpler.',
  },
  'execute.check': {
    s: ['Showed the outline to one reader and asked her to explain the book back to me. She did, in two sentences.'],
    n: 'That is the same test as the Vision check. It passed.',
  },
  'review.successful': {
    s: ['Yes for this pass: the promise, titles, outline and schedule are written down.',
        'Partly. The outline works. The title is still a working title.'],
    n: 'Pass, with one open item.',
  },
  'review.change': {
    s: ['The chapter order is not settled. The title is weak. The reader promise needs a stronger first sentence.',
        'Fix the chapter order and the promise now. The title waits until the draft is half done.'],
    n: 'Title decisions made too early tend to stick. Wait.',
  },
  'review.loopback': {
    s: ['Revisit Plan.'],
    n: 'Went back to Plan once to fix the chapter order, then forward again. The second pass took two days.',
  },
  'review.done': {
    s: ['Closed. The next task is writing Part One.'],
    n: 'The book now has a shape. Part One starts Monday.',
  },
};

// ---------------------------------------------------------------------------------------------
// Task 2: Write Part One. In progress, part way through Execute.
// ---------------------------------------------------------------------------------------------
const PART_ONE = {
  'vision.why': {
    s: ['Part One sets up the whole book. If readers do not trust chapters 1 to 4, they will not reach chapter 5.',
        'To give the reader the reason, the rule and a first win in four chapters.'],
    n: 'This is the part I most want to get right, so I am treating it as its own task.',
  },
  'vision.goal': {
    s: ['Four clean chapters, about 12,500 words, tested aloud, ready for beta readers.',
        'Part One explains why focus is hard, gives one rule (protect one hour), and ends with a first small win. Each chapter ends with a task of ten minutes.'],
    n: 'The first win is chapter 4: the reader protects one hour tomorrow.',
  },
  'vision.check': {
    s: ['Read each chapter aloud and time it. Give chapters 1 and 2 to two readers.',
        'Each chapter reads aloud in under 20 minutes without stumbling. Both readers finish chapter 2 without being asked.'],
    n: 'Reading aloud finds the sentences that are too long.',
  },
  'vision.limits': {
    s: ['No citations in Part One, no tool recommendations, no advice for teams yet.'],
    n: 'Team advice goes to Part Three.',
  },
  'research.questions': {
    s: ['What do readers already believe about focus? Which story opens chapter 1? Where do readers lose interest? What is the one rule? How much proof is enough?',
        'What do readers already believe? Which story opens chapter 1? How much proof is enough?',
        'Asked 10 colleagues what stops them focusing. Top answers: meetings, messages, and guilt about saying no.'],
    n: 'Guilt was the surprise. Nobody wrote that in the books I read.',
  },
  'research.timelimit': {
    s: ['One week, one hour a day.'],
    n: 'Done in six days.',
  },
  'research.findings': {
    s: ['Guilt about saying no is stronger than the interruptions themselves. Chapter 3 should be about that.',
        'Whether the rule should be "one hour" or "one block".'],
    n: 'Four people said "one hour" is easier to remember.',
  },
  'research.decide': {
    s: ['Use "one hour" as the rule. Concrete beats flexible.'],
    n: 'Can be softened later in the book, not in Part One.',
  },
  'plan.map': {
    s: ['Four chapters, each with a story, the problem, the idea, examples and a task.',
        'Chapter 1, 2, 3, 4, then read all four in one sitting.',
        'Chapter 3 needs the interview quotes typed up first.'],
    n: 'Typing up the quotes is the only blocker.',
  },
  'plan.time': {
    s: ['One week per chapter. One extra day for the read-aloud pass.',
        'Four weeks and a day.'],
    n: 'Buffer: the week of the 24th is already busy.',
  },
  'plan.risks': {
    s: ['Collecting more quotes than I need. Rewriting chapter 1 again and again.',
        'Cap quotes at six. No rewrite of chapter 1 until all four chapters exist.'],
    n: 'The rewrite habit is the real risk here.',
  },
  'plan.firststep': {
    s: ['Write the opening story of chapter 1, 600 words, tonight.'],
    n: 'Done on the day I planned it. That helped.',
  },
  'execute.slice': {
    s: ['Chapter 1 breaks into: opening story, the problem, the idea, three examples, the task.',
        'Five slices of about 600 words, one per sitting of 40 minutes.'],
    n: 'Chapter 1 draft finished in five sittings.',
  },
  'execute.learn': {
    s: ['The examples are harder than the story. I keep reaching for big companies. Small, personal examples land better.'],
    n: 'Use my own week and a colleague\'s week as the examples.',
  },
  'execute.adjust': {
    s: ['Chapter 3 is running long because of the guilt section. It is probably two chapters.'],
    n: 'Decide by Friday: split chapter 3 or cut the second example.',
  },
};

// ---------------------------------------------------------------------------------------------
// Task 3: Edit the full manuscript. Waiting at the Plan Selah, with one step still unticked.
// ---------------------------------------------------------------------------------------------
const EDIT = {
  'vision.why': {
    s: ['A full draft is not yet a book. Editing is where it becomes readable.',
        'To turn 55,000 rough words into a manuscript I would be happy to hand to a stranger.'],
    n: 'I have not started editing yet, so this is the plan only.',
  },
  'vision.goal': {
    s: ['One clean manuscript where every chapter has the same voice and no repeated points.',
        'The manuscript reads the same way from chapter 1 to 12. No chapter needs an apology when I hand it over.'],
    n: 'The test is a stranger reading it without me in the room.',
  },
  'vision.check': {
    s: ['Hand it to three beta readers and a copy editor.',
        'Beta readers finish it, and the copy editor needs fewer than three rounds.'],
    n: 'Three rounds is the budget.',
  },
  'vision.limits': {
    s: ['No new chapters, no new research, no restructuring after the read-through.'],
    n: 'New ideas go in a list for the second edition.',
  },
  'research.questions': {
    s: ['How do editors work? What does a copy edit cost? How long does it take? Where do I find a good one? What do beta readers need from me?',
        'What does a copy edit cost? How long does it take? What do beta readers need from me?',
        'Asked three authors who published recently and read two guides on beta reading.'],
    n: 'Two of the three authors paid for a copy edit and did not regret it.',
  },
  'research.timelimit': {
    s: ['Five days, one hour a day.'],
    n: 'Used four.',
  },
  'research.findings': {
    s: ['A copy edit of this length costs about 40,000 rupees and takes three weeks. Beta readers need a short feedback form, not an open question.',
        'Whether to hire the editor before or after the beta readers.'],
    n: 'Authors suggested after, so the editor does not waste time on things readers will catch.',
  },
  'research.decide': {
    s: ['Beta readers first, then the copy edit.'],
    n: 'Book the editor now for a slot in eleven weeks.',
  },
  'plan.map': {
    s: ['Read-through, revise, send to beta readers, collect feedback, revise again, send to the editor.',
        'In that order, one step at a time.',
        'The editor slot is fixed. Everything before it must fit in eleven weeks.'],
    n: 'The fixed slot is helpful. It makes the schedule real.',
  },
  'plan.time': {
    s: ['Read-through 1 week. Revision 4 weeks. Beta readers 3 weeks. Second revision 2 weeks.',
        'Ten weeks. One week of slack before the editor.'],
    n: 'Slack is thin. Watch the revision weeks.',
  },
  'plan.risks': {
    s: ['Reformatting the manuscript, adding a glossary, rewriting the introduction a fourth time.'],
    n: 'Second step not done yet: deciding what to discard. This is why the Selah is waiting.',
  },
  'plan.firststep': {
    s: ['Print chapter 1 and read it with a pen, tomorrow morning.'],
    n: 'Print, do not read on screen.',
  },
};

// ---------------------------------------------------------------------------------------------
// Task 4: Publish and launch. Just started.
// ---------------------------------------------------------------------------------------------
const LAUNCH = {
  'vision.why': {
    s: ['A finished book that nobody can find is a private file. Launch is how readers meet it.',
        'So the people who need it can find it, and know in one minute whether it is for them.'],
    n: 'Starting early so the Plan stage has time to be honest.',
  },
  'vision.goal': {
    s: ['The book is on sale, one page explains it, and the first hundred readers know it exists.',
        'Launch means the book is on sale and a one-page site explains it. A hundred readers have heard of it from someone they trust.'],
    n: 'The promise must be clear in one minute of reading.',
  },
};

// ---------------------------------------------------------------------------------------------

export const BOOK_SAMPLE = {
  key: 'book',
  project: 'Book: The Quiet Hour',
  tasks: [
    { title: 'Define the book', at: 'recap', created: 40, updated: 14, finished: 14, passes: 2, loops: 1, timer: 90, notes: DEFINE },
    { title: 'Write Part One', at: 'execute.adjust', partial: { 'execute.adjust': [0] }, created: 12, updated: 0, timer: 60, notes: PART_ONE },
    { title: 'Edit the full manuscript', at: 'plan.selah', unticked: ['plan.risks:1'], created: 9, updated: 2, timer: 45, notes: EDIT },
    { title: 'Publish and launch', at: 'vision.check', partial: { 'vision.check': [0] }, created: 1, updated: 1, notes: LAUNCH },
  ],
};

// Build the project and its tasks as plain data, ready for store.insert().
export function buildSample(def = BOOK_SAMPLE, now = Date.now()) {
  const decks = def.tasks.map((t) => {
    const at = slideIndex(t.at);
    const deck = {
      title: t.title,
      created: now - t.created * DAY,
      updated: now - t.updated * DAY,
      slide: at,
      reached: at,
      ticks: {},
      notes: {},
      selah: {},
      passes: t.passes || 1,
      loops: t.loops || 0,
      finished: t.finished != null ? now - t.finished * DAY : null,
      timer: t.timer ? { minutes: t.timer, endAt: now - t.created * DAY + 3 * DAY } : null,
    };
    // Everything before the current slide is complete.
    SLIDES.forEach((s, i) => {
      if (i >= at) return;
      if (s.type === 'sub') s.sub.steps.forEach((_, k) => { deck.ticks[tickKey(s.stage, s.sub, k)] = true; });
      else if (s.type === 'selah') deck.selah[s.stage.id] = true;
    });
    // On the current slide, only some steps are ticked.
    const here = SLIDES[at];
    if (here.type === 'sub') ((t.partial || {})[here.key] || []).forEach((k) => { deck.ticks[tickKey(here.stage, here.sub, k)] = true; });
    (t.unticked || []).forEach((k) => { delete deck.ticks[k]; });
    // Notes.
    Object.entries(t.notes).forEach(([key, v]) => {
      (v.s || []).forEach((text, i) => { deck.notes[`${key}#${i}`] = text; });
      if (v.n) deck.notes[key] = v.n;
    });
    return deck;
  });
  return { sample: def.key, project: { name: def.project, created: now - 40 * DAY }, decks };
}
