// A small render-blocking head module applies the local preference before paint.
import { initTheme } from './theme.js';
const stopTheme = initTheme();
window.addEventListener('pagehide', (event) => { if (!event.persisted) stopTheme(); });
