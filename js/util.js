export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

export function ask(label, def = '') {
  const v = window.prompt(label, def);
  return v && v.trim() ? v.trim() : null;
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
