// The account button in the top corner, and the first-visit sign-in offer.
import { getSync, syncReady } from './sync.js';
import { loginDialog } from './connect-ui.js';
import { esc } from './util.js';

let probe = null;
let asked = false;

// Does the site we are on have a hub with Google sign-in? (A plain GitHub Pages copy does not.)
export function hubOffersGoogle() {
  if (!probe) {
    probe = fetch(location.origin + '/auth/config', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { google: false }))
      .then((d) => !!d.google)
      .catch(() => false);
  }
  return probe;
}

const USER = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';

export function accountButton() {
  const cfg = getSync();
  const letter = cfg.email && cfg.email !== 'owner' ? cfg.email[0].toUpperCase() : '';
  const label = cfg.email ? `Account: ${cfg.email}` : 'Sign in';
  return `<button class="icon-btn avatar-btn${syncReady() ? ' on' : ''}" data-act="account" aria-label="${esc(label)}" title="${esc(label)}">${letter ? `<span class="avatar">${esc(letter)}</span>` : USER}</button>`;
}

// Asks once per visit, and never again after "Continue offline" or once signed in.
export async function maybeFirstLogin() {
  if (asked || syncReady()) return;
  try { if (localStorage.getItem('vesper.login.choice')) return; } catch (e) { /* storage blocked */ }
  if (!(await hubOffersGoogle())) return;
  asked = true;
  await loginDialog();
}
