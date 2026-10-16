export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

export const ICON = {
  back: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  plus: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  star: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z"/></svg>',
};

// In-app dialogs (glass) instead of the browser's prompt, confirm and alert.
function modal({ html, value, cancelValue }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = html;
    document.body.appendChild(dlg);
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(cancelValue); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) done(cancelValue); });
    dlg.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); done(value(dlg)); });
    dlg.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => done(cancelValue)));
    dlg.showModal();
    const first = dlg.querySelector('input') || dlg.querySelector('button[type=submit]');
    if (first) first.focus();
  });
}

// Resolves to the trimmed text, or null if cancelled or empty.
export function ask(title, { value = '', ok = 'Create', placeholder = '' } = {}) {
  return modal({
    html: `<form method="dialog"><h2>${esc(title)}</h2>
      <input name="v" type="text" maxlength="80" autocomplete="off" aria-label="${esc(title)}" placeholder="${esc(placeholder)}" value="${esc(value)}">
      <div class="modal-actions"><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn primary">${esc(ok)}</button></div></form>`,
    value: (d) => (d.querySelector('input').value.trim() || null),
    cancelValue: null,
  });
}

export function confirmBox(title, message, { ok = 'Delete', danger = true } = {}) {
  return modal({
    html: `<form method="dialog"><h2>${esc(title)}</h2><p class="muted">${esc(message)}</p>
      <div class="modal-actions"><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn ${danger ? 'danger-fill' : 'primary'}">${esc(ok)}</button></div></form>`,
    value: () => true,
    cancelValue: false,
  });
}

export function notice(title, message) {
  return modal({
    html: `<form method="dialog"><h2>${esc(title)}</h2><p class="muted">${esc(message)}</p>
      <div class="modal-actions"><button type="submit" class="btn primary">OK</button></div></form>`,
    value: () => true,
    cancelValue: true,
  });
}

// Split a name into at most two short lines for the mind map root node.
export function twoLines(name, max = 11) {
  const words = name.split(/\s+/);
  const lines = [''];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if (!cur) lines[lines.length - 1] = w;
    else if ((cur + ' ' + w).length <= max || lines.length === 2) lines[lines.length - 1] = cur + ' ' + w;
    else lines.push(w);
  }
  return lines.slice(0, 2).map((l) => trunc(l, max + 1));
}

export function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
