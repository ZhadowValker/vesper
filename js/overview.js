import { STAGES, SLIDES } from './framework.js';
import { PRIORITIES, validDue } from './task-meta.js';
import { orderedItems } from './organize.js';

// A compact, read-only view; never change data to satisfy a filter.
export function filterOverview(state, options = {}) {
  const { query = '', project, stage, status, priority, dueBefore, limit = 25 } = options;
  if (typeof query !== 'string') throw new Error('query must be text.');
  if (project !== undefined && typeof project !== 'string') throw new Error('project must be an id or name.');
  const stageMatch = stage === undefined ? null : STAGES.find((s) => s.id === String(stage).toLowerCase() || s.name.toLowerCase() === String(stage).toLowerCase());
  if (stage !== undefined && !stageMatch) throw new Error('Unknown stage.');
  if (status !== undefined && !['active', 'finished', 'not started'].includes(status)) throw new Error('Status must be active, finished, or not started.');
  if (priority !== undefined && !['none', ...PRIORITIES].includes(priority)) throw new Error('Unknown priority.');
  if (dueBefore !== undefined && !validDue(dueBefore)) throw new Error('dueBefore must be a calendar date YYYY-MM-DD.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('limit must be an integer from 1 to 1000.');
  const q = query.trim().toLowerCase();
  let left = limit;
  const groups = [];
  for (const p of orderedItems(state.projects)) {
    if (project !== undefined && p.id !== project && p.name.toLowerCase() !== project.toLowerCase()) continue;
    const matchesProject = p.name.toLowerCase().includes(q);
    const decks = orderedItems(state.decks.filter((d) => d.projectId === p.id)).filter((d) => {
      if (q && !matchesProject && !d.title.toLowerCase().includes(q)) return false;
      if (stageMatch && SLIDES[d.slide]?.stage?.id !== stageMatch.id) return false;
      const taskStatus = d.finished ? 'finished' : (d.reached || 0) === 0 ? 'not started' : 'active';
      if (status && status !== taskStatus) return false;
      if (priority && (priority === 'none' ? !!d.priority : d.priority !== priority)) return false;
      if (dueBefore && (!validDue(d.due) || d.due >= dueBefore)) return false;
      return true;
    }).slice(0, left);
    left -= decks.length;
    // Keep empty project groups for old clients when no task filters were given.
    if (decks.length || (!q && !stage && !status && !priority && !dueBefore && left > 0)) groups.push({ project: p, decks });
    if (left === 0) break;
  }
  return groups;
}

export function compactOverview(groups, summarize) {
  // Valid JSON for existing clients, with exactly one JSON line per task.
  return '[\n' + groups.map(({ project, decks }) =>
    `{"project":${JSON.stringify(project.name)},"id":${JSON.stringify(project.id)},"tasks":[\n${decks.map((d) => JSON.stringify(summarize(d))).join(',\n')}\n]}`
  ).join(',\n') + '\n]';
}
