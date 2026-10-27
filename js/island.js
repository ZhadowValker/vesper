// The floating navigation island: always at the bottom of every screen, slides included.
import { store } from './store.js';
import { SLIDES } from './framework.js';
import { go, rerender } from './nav.js';
import { openChatPanel } from './ai/panel.js';
import { syncDialog } from './connect-ui.js';
import { getSync } from './sync.js';
import { esc } from './util.js';

const I = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  up: '<path d="M9 14L4 9l5-5"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
  prev: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  ai: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
};
const svg = (name) => `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${I[name]}</svg>`;
const btn = (act, icon, label, extra = '') => `<button type="button" class="isl-b" data-isl="${act}" aria-label="${label}" title="${label}" ${extra}>${svg(icon)}<span>${label}</span></button>`;

// Where "Up" goes from here.
function parentOf(hash) {
  let m;
  if ((m = hash.match(/^#\/d\/(\w+)\/s\/\d+$/))) return `#/d/${m[1]}`;
  if ((m = hash.match(/^#\/d\/(\w+)$/))) { const d = store.deck(m[1]); return d ? `#/p/${d.projectId}` : '#/'; }
  if (/^#\/p\/\w+$/.test(hash)) return '#/';
  return null;
}

export function mountIsland() {
  let el = document.getElementById('island');
  if (!el) {
    el = document.createElement('nav');
    el.id = 'island';
    el.className = 'island no-print';
    el.setAttribute('aria-label', 'Navigation');
    document.body.appendChild(el);
    el.addEventListener('click', onClick);
  }
  paint(el);
}

function paint(el) {
  const hash = location.hash || '#/';
  if (/^#\/signin/.test(hash)) { el.hidden = true; return; }
  el.hidden = false;
  const up = parentOf(hash);
  const s = hash.match(/^#\/d\/(\w+)\/s\/(\d+)$/);
  const last = SLIDES.length - 1;
  const n = s ? Math.min(parseInt(s[2], 10) || 0, last) : 0;
  const cfg = getSync();
  const letter = cfg.email && cfg.email !== 'owner' ? cfg.email[0].toUpperCase() : '';
  const home = !up && !s;
  document.body.classList.toggle('has-island', true);
  document.body.classList.toggle('on-slide', !!s);
  el.innerHTML =
    (home ? btn('home', 'home', 'Home', 'aria-current="page"') : btn('home', 'home', 'Home') + btn('up', 'up', 'Back')) +
    (s ? btn('prev', 'prev', 'Previous', n === 0 ? 'disabled' : '') + `<span class="isl-count" aria-live="off">${n + 1}/${SLIDES.length}</span>` + btn('next', 'next', 'Next', n === last ? 'disabled' : '') : '') +
    btn('ai', 'ai', 'AI') +
    `<button type="button" class="isl-b" data-isl="account" aria-label="Account" title="Account">${letter ? `<b class="isl-av">${esc(letter)}</b>` : svg('user')}<span>Account</span></button>`;
}

function onClick(e) {
  const b = e.target.closest('[data-isl]');
  if (!b || b.disabled) return;
  const hash = location.hash || '#/';
  const act = b.dataset.isl;
  if (act === 'home') go('#/');
  else if (act === 'up') go(parentOf(hash) || '#/');
  else if (act === 'prev' || act === 'next') {
    const m = hash.match(/^#\/d\/(\w+)\/s\/(\d+)$/);
    if (!m) return;
    const to = Math.min(Math.max(parseInt(m[2], 10) + (act === 'next' ? 1 : -1), 0), SLIDES.length - 1);
    go(`#/d/${m[1]}/s/${to}`);
  } else if (act === 'ai') {
    const m = hash.match(/^#\/d\/(\w+)/);
    openChatPanel({ focusId: m ? m[1] : null });
  } else if (act === 'account') syncDialog({ onChange: rerender });
}
