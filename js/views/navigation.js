import { store } from '../store.js';
import { esc } from '../util.js';
import { createItem } from './model-ui.js';

export function navigationHTML(hash = '#/', mobile = false) {
  const current = hash === '#/areas' || hash.startsWith('#/p/') ? 'areas' : hash === '#/inbox' ? 'inbox' : 'home';
  return `<nav class="${mobile ? 'dashboard-mobile-nav' : 'dashboard-desktop-nav'}" aria-label="${mobile ? 'Mobile navigation' : 'Main navigation'}">${[
    ['home', '#/', 'Home'], ['areas', '#/areas', 'Areas'], ['inbox', '#/inbox', `Inbox <span class="dashboard-inbox-count">${store.tasksAt('inbox').length}</span>`],
  ].map(([id, href, label]) => `<a href="${href}" ${current === id ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
}
export function dashboardHeaderHTML(hash) {
  return `<header class="dashboard-header"><a class="dashboard-wordmark" href="#/">Vesper</a>${navigationHTML(hash)}
    <div class="dashboard-header-actions"><button class="btn" type="button" data-dashboard-search>Search</button><button class="btn primary" type="button" data-header-new>New</button></div></header>`;
}
export function bindDashboardHeader(root) {
  const click = (event) => {
    if (event.target.closest('[data-header-new]')) createItem();
    if (event.target.closest('[data-dashboard-search]')) openSearch();
  };
  root.addEventListener('click', click);
  return () => root.removeEventListener('click', click);
}
function openSearch() {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal dashboard-search';
  dialog.innerHTML = `<form method="dialog"><div class="row"><h2 class="grow">Search</h2><button class="btn" value="close">Close</button></div>
    <label>Search Areas, Projects and Tasks<input name="query" type="search" autocomplete="off"></label></form><div data-search-results></div>`;
  const results = dialog.querySelector('[data-search-results]');
  const input = dialog.querySelector('input');
  function update() {
    const query = input.value.trim().toLocaleLowerCase();
    const records = [
      ...store.areas().map((a) => ({ title: a.name, kind: 'Area', href: `#/p/${a.id}` })),
      ...store.flowProjects().map((p) => ({ title: p.title, kind: 'Project', href: `#/d/${p.id}/s/${Math.max(0, Math.min(26, p.slide || 0))}` })),
      ...store.tasks().map((t) => ({ title: t.title, kind: 'Task', href: t.location.kind === 'project' ? `#/d/${t.location.id}` : t.location.kind === 'area' ? `#/p/${t.location.id}` : '#/inbox' })),
    ];
    const matches = query ? records.filter((r) => r.title.toLocaleLowerCase().includes(query)) : [];
    results.innerHTML = matches.map((r) => `<a class="dashboard-search-result" href="${esc(r.href)}"><span>${esc(r.title)}</span><small>${r.kind}</small></a>`).join('') || `<p role="status">${query ? 'No matches.' : 'Enter a name to search.'}</p>`;
  }
  input.addEventListener('input', update);
  dialog.addEventListener('click', (event) => { if (event.target.closest('[data-search-results] a')) dialog.close(); });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.appendChild(dialog); update(); dialog.showModal(); input.focus();
}
