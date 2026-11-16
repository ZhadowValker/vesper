// Read-only dashboard projections: never normalise or write a saved notebook.
import { STAGES, tickKey } from './framework.js';
import { orderedItems } from './organize.js';

export const STAGE_COLORS = {
  vision: 'var(--vision)', research: 'var(--research)', plan: 'var(--plan)', execute: 'var(--execute)',
  review: 'var(--review)', parked: '#8f89b8', finished: '#6fd08c',
};
export const PRIORITY_COLORS = {
  P1: '#ff6b81', P2: '#ffa24d', P3: '#f4d35e', P4: '#8f89b8', none: '#6f6a94',
};
export function projectLayer(project) {
  if (project.finished) return 'finished';
  if (project.parked === true || project.priority === 'P4') return 'parked';
  return 'open';
}
export function projectStage(project) {
  // An unfinished Project with all Selahs passed still belongs on the board.
  return (STAGES.find((stage) => !project.selah?.[stage.id]) || STAGES[STAGES.length - 1]).id;
}
export function projectTicks(project) {
  return STAGES.reduce((total, stage) => total + stage.subs.reduce((sum, sub) =>
    sum + sub.steps.filter((_, i) => !!project.ticks?.[tickKey(stage, sub, i)]).length, 0), 0);
}
export function dashboardSummary(projects) {
  const counts = Object.fromEntries(Object.keys(STAGE_COLORS).map((id) => [id, 0]));
  const layers = { open: [], parked: [], finished: [] };
  for (const project of projects) {
    const layer = projectLayer(project);
    layers[layer].push(project);
    counts[layer === 'open' ? projectStage(project) : layer]++;
  }
  const latest = [...layers.open].sort((a, b) => (b.updated || b.created || 0) -
    (a.updated || a.created || 0) || String(a.id).localeCompare(String(b.id)))[0];
  return { total: projects.length, counts, layers, lastEditedId: latest?.id || null };
}
export function dashboardColumns(projects, layer = 'open') {
  const { layers } = dashboardSummary(projects);
  if (layer === 'finished') return [{ id: 'finished', name: 'Finished', color: STAGE_COLORS.finished, projects: orderedItems(layers.finished) }];
  if (layer === 'parked') return [
    { id: 'p4', name: 'P4', color: STAGE_COLORS.parked, projects: orderedItems(layers.parked.filter((p) => p.priority === 'P4')) },
    { id: 'marked', name: 'Marked parked', color: STAGE_COLORS.parked, projects: orderedItems(layers.parked.filter((p) => p.priority !== 'P4')) },
  ];
  return STAGES.map((stage) => ({
    id: stage.id, name: stage.name, color: STAGE_COLORS[stage.id],
    projects: orderedItems(layers.open.filter((p) => projectStage(p) === stage.id)),
  }));
}
