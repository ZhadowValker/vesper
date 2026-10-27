import { setRenderer } from './nav.js';
import { home } from './views/home.js';
import { projectView } from './views/project.js';
import { deckView } from './views/deck.js';
import { slideView } from './views/slide.js';
import { startSync } from './sync.js';
import { signinView } from './signin.js';
import { mountIsland } from './island.js';

const routes = [
  [/^#\/(overview)?$/, home],
  [/^#\/signin\?c=(\w+)$/, signinView],
  [/^#\/p\/(\w+)$/, projectView],
  [/^#\/d\/(\w+)$/, deckView],
  [/^#\/d\/(\w+)\/s\/(\d+)$/, slideView],
];

const root = document.getElementById('app');
let cleanup = null;

function render() {
  if (cleanup) { cleanup(); cleanup = null; }
  const hash = location.hash || '#/';
  for (const [re, view] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    const result = view(...m.slice(1));
    root.innerHTML = result.html;
    window.scrollTo(0, 0);
    if (result.mount) cleanup = result.mount(root) || null;
    mountIsland();
    return;
  }
  location.hash = '#/';
}

setRenderer(render);
window.addEventListener('hashchange', render);
render();

// Optional sync: when newer data arrives from another device, redraw in place (never on a slide, never under a dialog).
document.addEventListener('vesper:synced', () => {
  if (/\/s\/\d+$/.test(location.hash) || /^#\/signin/.test(location.hash) || document.querySelector('dialog[open]')) return;
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
});
startSync();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => {
    // When a newer version takes over, reload once so the page matches it.
    const had = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (had && !reloaded) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker not registered', err));
  });
}
