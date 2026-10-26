// Builds worker/vesper-hub.js: one pasteable file made from the app's own modules plus
// worker/hub.src.js, so the Worker follows exactly the same rules as the app.
// Run: node worker/build.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const parts = ['js/framework.js', 'js/ai/questions.js', 'js/ai/steps.js', 'js/ai/apply.js', 'js/merge.js'];

const strip = (src) => src
  .split('\n')
  .filter((l) => !/^import .*;\s*$/.test(l))
  .map((l) => l.replace(/^export (const|let|function|class|async function) /, '$1 '))
  .join('\n');

const hub = fs.readFileSync(path.join(root, 'worker/hub.src.js'), 'utf8');
const [header, ...rest] = hub.split('\nconst ALLOWED_ORIGINS');
const out = [
  header.trimEnd(),
  '',
  ...parts.map((p) => `// ---- from ${p} ----\n${strip(fs.readFileSync(path.join(root, p), 'utf8')).trim()}\n`),
  '// ---- hub ----',
  `const ALLOWED_ORIGINS${rest.join('\nconst ALLOWED_ORIGINS')}`,
].join('\n');
fs.writeFileSync(path.join(root, 'worker/vesper-hub.js'), out);
console.log(`wrote worker/vesper-hub.js (${out.length} bytes)`);
