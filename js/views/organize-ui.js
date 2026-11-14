import { store } from '../store.js';
import { orderedItems } from '../organize.js';
import { applyActions } from '../ai/agent.js';
import { ask, notice, esc } from '../util.js';
import { rerender } from '../nav.js';
import { getTaskPrefs, saveTaskPrefs } from '../task-meta.js';

export function orderButtons(item, items, kind, project = '') {
  const at = orderedItems(items).findIndex((x) => x.id === item.id);
  return `<div class="row order-controls" aria-label="Reorder ${esc(kind)}">
    <button type="button" class="btn small" data-organize="up" data-kind="${kind}" data-item="${esc(item.id)}" data-project="${esc(project)}" aria-label="Move ${esc(item.title || item.name)} up" ${at === 0 ? 'disabled' : ''}>Up</button>
    <button type="button" class="btn small" data-organize="down" data-kind="${kind}" data-item="${esc(item.id)}" data-project="${esc(project)}" aria-label="Move ${esc(item.title || item.name)} down" ${at === items.length - 1 ? 'disabled' : ''}>Down</button>
  </div>`;
}

export function bindOrganize(root) {
  const click = async (e) => {
    const btn = e.target.closest('[data-organize]');
    if (!btn || btn.disabled) return;
    e.preventDefault();
    const action = btn.dataset.organize;
    let request;
    if (action === 'rename') {
      const name = await ask('New name', { ok: 'Rename', value: btn.dataset.name || '' });
      if (!name) return;
      request = { type: 'rename', [btn.dataset.kind === 'projects' ? 'project' : 'task']: btn.dataset.item, name };
    } else {
      const kind = btn.dataset.kind;
      const items = orderedItems(kind === 'projects' ? store.projects() : store.decksOf(btn.dataset.project));
      const at = items.findIndex((x) => x.id === btn.dataset.item);
      request = { type: 'reorder', kind, project: btn.dataset.project, item: btn.dataset.item, position: at + (action === 'up' ? 0 : 2) };
    }
    const result = applyActions([request]);
    if (result.skipped.length) { notice('Could not update order or name', result.skipped.join(' ')); return; }
    if (action === 'up' || action === 'down') saveTaskPrefs({ ...getTaskPrefs(), sort: 'order' });
    rerender();
  };
  root.addEventListener('click', click);
  return () => root.removeEventListener('click', click);
}
