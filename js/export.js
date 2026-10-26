// Take a task or project out of Vesper: as Markdown (for Notion, Drive, GitHub, email) and as calendar entries.
import { STAGES, SLIDES, tickKey } from './framework.js';
import { allSteps } from './ai/steps.js';

export function taskMarkdown(deck, projectName = '') {
  const out = [`# ${deck.title}`];
  if (projectName) out.push(`Project: ${projectName}`);
  for (const st of STAGES) {
    out.push('', `## ${st.name}`);
    for (const sub of st.subs) {
      const lines = [];
      sub.steps.forEach((text, i) => {
        const note = (deck.notes[`${st.id}.${sub.id}#${i}`] || '').trim();
        const done = !!deck.ticks[tickKey(st, sub, i)];
        if (note || done) lines.push(`- [${done ? 'x' : ' '}] ${text}${note ? `\n  ${note.replace(/\n/g, '\n  ')}` : ''}`);
      });
      const sn = (deck.notes[`${st.id}.${sub.id}`] || '').trim();
      if (sn) lines.push('', sn);
      if (lines.length) out.push('', `### ${sub.name}`, ...lines);
    }
    out.push('', `*Selah: ${st.selah}* ${deck.selah[st.id] ? '(passed)' : '(not yet)'}`);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

export function projectMarkdown(project, decks) {
  const down = (md) => md.replace(/^(#{1,5}) /gm, '#$1 ');
  return `# ${project.name}\n\n` + decks.map((d) => down(taskMarkdown(d))).join('\n---\n\n');
}

const pad = (n) => String(n).padStart(2, '0');
// Floating local time (no zone), so the entry lands at that clock time wherever you are.
export const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const utc = (d) => d.toISOString().replace(/[-:]|\.\d{3}/g, '');

export function googleCalendarLink({ title, details = '', start, minutes = 30 }) {
  const end = new Date(start.getTime() + minutes * 60000);
  const q = new URLSearchParams({ action: 'TEMPLATE', text: title, details, dates: `${stamp(start)}/${stamp(end)}` });
  return 'https://calendar.google.com/calendar/render?' + q.toString();
}

const ics = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

export function icsFile({ title, details = '', start, minutes = 30 }) {
  const end = new Date(start.getTime() + minutes * 60000);
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vesper//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${Math.random().toString(36).slice(2)}@vesper`, `DTSTAMP:${utc(new Date())}`,
    `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:${ics(title)}`, `DESCRIPTION:${ics(details)}`, 'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

// What to suggest putting on the calendar for a task: its current slide.
export function calendarSuggestion(deck) {
  const sl = SLIDES[deck.slide];
  const where = sl && sl.stage ? (sl.type === 'selah' ? `Selah: ${sl.stage.name}` : `${sl.stage.name}${sl.sub ? ' - ' + sl.sub.name : ''}`) : 'Work on it';
  return { title: `${deck.title}: ${where}`, details: `Vesper task "${deck.title}". ${sl && sl.type === 'selah' ? sl.stage.selah : ''}`.trim() };
}

export const stepCount = () => allSteps().length;
