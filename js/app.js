import { setRenderer } from './nav.js';
import { home } from './views/home.js';
import { projectView } from './views/project.js';
import { deckView } from './views/deck.js';
import { slideView } from './views/slide.js';

const routes = [
  [/^#\/?$/, home],
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
    return;
  }
  location.hash = '#/';
}

setRenderer(render);
window.addEventListener('hashchange', render);
render();

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
