// No build system or dependencies: hash the precache bytes and normalized SW code.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const versionLine = /^const VERSION = ['"][^'"\r\n]*['"];$/gm;

export function stampServiceWorker(root = defaultRoot) {
  root = realpathSync(root);
  const swPath = path.join(root, 'sw.js');
  const source = readFileSync(swPath, 'utf8');
  if ([...source.matchAll(versionLine)].length !== 1) throw new Error('sw.js must have exactly one const VERSION declaration.');
  const match = source.match(/^const ASSETS = (\[[\s\S]*?\]);/m);
  if (!match) throw new Error('sw.js must declare ASSETS as an array literal.');
  // Evaluate only the array, never the service worker or its event handlers.
  const assets = new Script(`(${match[1]})`).runInNewContext(Object.create(null), { timeout: 1000 });
  if (!Array.isArray(assets) || !assets.length) throw new Error('ASSETS must be a nonempty array.');
  const files = new Set();
  for (const asset of assets) {
    if (typeof asset !== 'string' || !asset || /[\\?#\0]/.test(asset) || asset.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(asset) || asset.split('/').includes('..')) {
      throw new Error(`ASSETS must contain local relative paths: ${String(asset)}`);
    }
    let file = path.posix.normalize(asset);
    if (file === '.') file = 'index.html';
    else if (file.endsWith('/')) file += 'index.html';
    file = path.posix.normalize(file);
    const absolute = realpathSync(path.join(root, file));
    const relative = path.relative(root, absolute);
    if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || !statSync(absolute).isFile()) {
      throw new Error(`Cached asset is not a file inside the app: ${asset}`);
    }
    files.add(file);
  }
  const hash = createHash('sha256');
  // Mask VERSION so the output never hashes itself. SW logic/list changes also
  // invalidate the cache; './' and index.html share the same physical file.
  hash.update('vesper-precache-v1\0');
  hash.update(source.replace(versionLine, "const VERSION = '__STAMP__';"));
  for (const file of [...files].sort()) {
    const bytes = readFileSync(path.join(root, file));
    hash.update(`\0${file}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  const version = `vesper-${hash.digest('hex')}`;
  const output = source.replace(versionLine, `const VERSION = '${version}';`);
  const changed = output !== source;
  if (changed) writeFileSync(swPath, output);
  return { version, files: files.size, changed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = stampServiceWorker();
    console.log(`Service-worker stamp: ${result.version} (${result.files} cached files; ${result.changed ? 'updated' : 'unchanged'})`);
  } catch (error) {
    console.error(`Service-worker stamp failed: ${error.message}`);
    process.exitCode = 1;
  }
}
