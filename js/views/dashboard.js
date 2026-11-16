import { store } from '../store.js';
import { esc } from '../util.js';
import { rerender } from '../nav.js';
import { dashboardSummary, dashboardColumns, projectTicks, effectivePriority, STAGE_COLORS, PRIORITY_COLORS } from '../dashboard.js';
import { bindModelHomePanel, modelHomePanelHTML } from './model-ui.js';

const LEGEND = [
  { key: 'vision', label: 'Vision', color: STAGE_COLORS.vision },
  { key: 'research', label: 'Research', color: STAGE_COLORS.research },
  { key: 'plan', label: 'Plan', color: STAGE_COLORS.plan },
  { key: 'execute', label: 'Execute', color: STAGE_COLORS.execute },
  { key: 'review', label: 'Review', color: STAGE_COLORS.review },
  { key: 'parked', label: 'Parked', color: STAGE_COLORS.parked },
  { key: 'finished', label: 'Finished', color: STAGE_COLORS.finished },
];

let activeLayer = 'open';
const activeTabs = { open: 'execute', parked: 'p4', finished: 'finished' };
const expandedColumns = new Set();

function countFor(summary, key) {
  return Number.isFinite(Number(summary?.counts?.[key])) ? Number(summary.counts[key]) : 0;
}

function normalized(value) {
  return String(value ?? '').trim().toLowerCase();
}

function columnKey(column) {
  return String(column?.id ?? column?.name ?? '');
}

function selectedColumn(columns, layer) {
  const preferred = normalized(activeTabs[layer]);
  return columns.find((column) => normalized(column.id) === preferred || normalized(column.name) === preferred)
    || columns[0];
}

function priorityColor(priority) {
  return PRIORITY_COLORS[priority] || PRIORITY_COLORS.none;
}

function stageColor(column) {
  const id = normalized(column.id || column.name);
  const key = id.replace(/[^a-z]/g, '');
  return STAGE_COLORS[column.id] || STAGE_COLORS[key] || column.color || STAGE_COLORS.parked;
}

function summaryRing(summary) {
  const total = Math.max(0, Number(summary?.total) || 0);
  const radius = 43;
  const circumference = 2 * Math.PI * radius;
  const gap = 2.4;
  let offset = 0;
  const segments = LEGEND.map(({ key, color }) => {
    const value = Math.max(0, countFor(summary, key));
    const length = total ? circumference * value / total : 0;
    const visible = length - Math.min(gap, length * .15);
    const markup = value
      ? `<circle class="dashboard-ring-segment" cx="56" cy="56" r="${radius}" fill="none" stroke="${color}" stroke-width="9" stroke-dasharray="${visible} ${circumference - visible}" stroke-dashoffset="${-offset}" transform="rotate(-90 56 56)"></circle>`
      : '';
    offset += length;
    return markup;
  }).join('');
  const accessible = LEGEND.map(({ label, key }) => `${label}: ${countFor(summary, key)}`).join(', ');
  return `<div class="dashboard-ring-wrap">
    <svg class="dashboard-ring" viewBox="0 0 112 112" role="img" aria-label="${total} projects. ${esc(accessible)}">
      <circle class="dashboard-ring-track" cx="56" cy="56" r="${radius}" fill="none" stroke-width="9"></circle>
      ${segments}
      <text class="dashboard-ring-total" x="56" y="54" text-anchor="middle">${total}</text>
      <text class="dashboard-ring-caption" x="56" y="70" text-anchor="middle">projects</text>
    </svg>
  </div>`;
}

function overviewHTML(summary) {
  const legend = LEGEND.map(({ key, label, color }) =>
    `<div class="dashboard-legend-item"><i aria-hidden="true" style="--legend-color:${color}"></i><span>${label}</span><b>${countFor(summary, key)}</b></div>`).join('');
  return `<section class="dashboard-overview" aria-label="Project overview">
    ${summaryRing(summary)}
    <div class="dashboard-legend">${legend}</div>
  </section>`;
}

function layerControls(summary) {
  const items = [
    { key: 'open', label: 'Open', count: (summary?.layers?.open || []).length },
    { key: 'parked', label: 'Parked', count: (summary?.layers?.parked || []).length },
    { key: 'finished', label: 'Finished', count: (summary?.layers?.finished || []).length },
  ];
  return `<div class="dashboard-layers" role="group" aria-label="Project status">
    ${items.map(({ key, label, count }) => `<button class="dashboard-layer-button" type="button" data-dashboard-layer="${key}" aria-pressed="${activeLayer === key}"><span>${label}</span><b>${count}</b></button>`).join('')}
  </div>`;
}

function projectCard(project, column) {
  const priority = effectivePriority(project);
  const title = !project.priority && priority
    ? project.title.slice(`${priority} · `.length) : project.title;
  const pColor = priorityColor(priority);
  const ticks = Math.max(0, Math.min(34, Number(projectTicks(project)) || 0));
  const slide = Number.isInteger(project.slide) && project.slide >= 0 ? Math.min(project.slide, 26) : 0;
  const displaySlide = Math.min(slide + 1, 27);
  const area = store.area(project.areaId);
  const lastEdited = project.id === (currentSummaryLastEditedId || null)
    ? '<span class="dashboard-last-edited">Last edited</span>' : '';
  const destination = `#/d/${encodeURIComponent(project.id)}/s/${slide}`;
  const resume = project.finished
    ? '<span class="dashboard-resume-label">Reopen</span>'
    : `<span class="dashboard-resume-label">Resume · slide ${displaySlide} of 27</span>`;
  const barColor = pColor || '#6f6a94';
  return `<a class="dashboard-project-card${project.finished ? ' is-finished' : ''}" href="${esc(destination)}" style="--priority-color:${esc(barColor)}" aria-label="${esc(project.finished ? 'Reopen' : 'Resume')}: ${esc(title)}">
    <span class="dashboard-card-meta">
      <span class="dashboard-priority" data-priority="${esc(priority || 'none')}">${esc(priority || 'No priority')}</span>
      <span class="dashboard-area">${esc(area?.name || area?.title || '')}</span>
      ${lastEdited}
    </span>
    <span class="dashboard-project-title">${esc(title)}</span>
    <span class="dashboard-progress-line"><span class="dashboard-progress" role="progressbar" aria-label="Project progress" aria-valuemin="0" aria-valuemax="34" aria-valuenow="${ticks}"><i style="width:${(ticks / 34) * 100}%"></i></span><span class="dashboard-ticks">${ticks} / 34</span></span>
    <span class="dashboard-card-bottom">${resume}<span class="dashboard-arrow" aria-hidden="true">→</span></span>
  </a>`;
}

let currentSummaryLastEditedId = null;

function columnsForLayer(projects, layer) {
  const columns = dashboardColumns(projects, layer) || [];
  return Array.isArray(columns) ? columns : [];
}

function mobileColumnTabs(columns, layer, selected) {
  if (!columns.length) return '';
  return `<div class="dashboard-column-tabs" role="group" aria-label="${layer === 'open' ? 'Project stages' : `${layer} columns`}">
    ${columns.map((column) => {
      const key = columnKey(column);
      const selectedNow = column === selected;
      return `<button class="dashboard-column-tab" type="button" data-dashboard-column="${esc(key)}" aria-pressed="${selectedNow}" style="--column-color:${esc(stageColor(column))}">
        <i aria-hidden="true"></i><span>${esc(column.name || '')}</span><b>${column.projects?.length || 0}</b>
      </button>`;
    }).join('')}
  </div>`;
}

function columnHTML(column, layer, selected) {
  const projects = Array.isArray(column.projects) ? column.projects : [];
  const key = columnKey(column);
  const expanded = expandedColumns.has(`${layer}:${key}`);
  const visible = expanded ? projects : projects.slice(0, 6);
  const remaining = Math.max(0, projects.length - visible.length);
  const cardList = visible.map((project) => projectCard(project, column)).join('');
  const more = remaining
    ? `<button class="dashboard-more" type="button" data-dashboard-more="${esc(key)}">+ ${remaining} more</button>`
    : '';
  return `<section class="dashboard-column${column === selected ? ' is-mobile-selected' : ''}" data-column-key="${esc(key)}" style="--column-color:${esc(stageColor(column))}" aria-label="${esc(column.name || '')}">
    <header class="dashboard-column-head"><span class="dashboard-column-mark" aria-hidden="true"></span><h2>${esc(column.name || '')}</h2><span class="dashboard-column-count">${projects.length}</span></header>
    <div class="dashboard-column-cards">${cardList || '<div class="dashboard-column-empty">Nothing here yet</div>'}</div>
    ${more}
  </section>`;
}

function boardHTML(projects, layer) {
  const columns = columnsForLayer(projects, layer);
  const selected = selectedColumn(columns, layer);
  const tabs = mobileColumnTabs(columns, layer, selected);
  return `<div class="dashboard-board" data-dashboard-board="${layer}">
    ${tabs}
    <div class="dashboard-columns">${columns.map((column) => columnHTML(column, layer, selected)).join('')}</div>
  </div>`;
}

export function dashboardView() {
  const projects = store.flowProjects();
  const summary = dashboardSummary(projects);
  currentSummaryLastEditedId = summary?.lastEditedId ?? null;
  const html = `<main class="page dashboard-page">
    <div class="dashboard-destinations" aria-label="Areas and Inbox">
      <a class="btn" href="#/areas">Areas</a>
      <a class="btn" href="#/inbox">Inbox <span class="chip dashboard-inbox-count">${store.tasksAt('inbox').length}</span></a>
    </div>
    ${overviewHTML(summary)}
    ${layerControls(summary)}
    ${boardHTML(projects, activeLayer)}
    ${modelHomePanelHTML()}
  </main>`;

  return {
    html,
    mount(root) {
      const stopModelPanel = bindModelHomePanel(root);
      if (globalThis.matchMedia?.('(max-width:700px)').matches) {
        root.querySelector?.('[data-dashboard-column][aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      const onClick = (event) => {
        const layerButton = event.target.closest('[data-dashboard-layer]');
        if (layerButton) {
          activeLayer = layerButton.dataset.dashboardLayer;
          rerender();
          root.querySelector?.(`[data-dashboard-layer="${activeLayer}"]`)?.focus({ preventScroll: true });
          return;
        }
        const columnButton = event.target.closest('[data-dashboard-column]');
        if (columnButton) {
          activeTabs[activeLayer] = columnButton.dataset.dashboardColumn;
          rerender();
          root.querySelector?.(`[data-dashboard-column="${activeTabs[activeLayer]}"]`)?.focus({ preventScroll: true });
          return;
        }
        const moreButton = event.target.closest('[data-dashboard-more]');
        if (moreButton) {
          expandedColumns.add(`${activeLayer}:${moreButton.dataset.dashboardMore}`);
          rerender();
        }
      };
      root.addEventListener('click', onClick);
      return () => {
        root.removeEventListener('click', onClick);
        stopModelPanel?.();
      };
    },
  };
}
