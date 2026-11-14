// Runs from any working directory. GitHub checks out this app as the repo root.
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const generated = ['worker/vesper-hub.js', 'sw.js'];
const git = (root, args) => execFileSync('git', args, { cwd: root });

export function assertAppRepository(root) {
  const top = git(root, ['rev-parse', '--show-toplevel']).toString().trim();
  if (realpathSync(top) !== realpathSync(root)) throw new Error('Run checks in Vesper’s own Git clone, not its parent repository.');
}

export function sourceFiles(root) {
  return [...new Set(git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).toString().split('\0'))]
    .filter((file) => /\.(?:js|mjs)$/.test(file)).sort();
}

export function generatedDifferences(root) {
  // Compare to HEAD, not the index: staging a stale bundle cannot bypass CI.
  const head = git(root, ['rev-parse', 'HEAD']).toString().trim();
  return generated.filter((file) => !readFileSync(path.join(root, file)).equals(git(root, ['show', `${head}:${file}`])));
}

export function check(root = defaultRoot) {
  assertAppRepository(root);
  console.log(`Dependency-free checks on Node ${process.version}`);
  let failures = 0;
  const run = (label, args, quiet = false) => {
    if (!quiet) console.log(`\n== ${label} ==`);
    const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
    if (result.error || result.status !== 0) {
      failures++;
      console.error(`FAIL: ${label}${result.error ? ': ' + result.error.message : ''}`);
    }
  };
  // Rebuild first so tests exercise the bundle generated from today's source.
  run('Rebuild Worker', ['worker/build.js']);
  run('Stamp service worker', ['scripts/stamp-sw.mjs']);
  const files = sourceFiles(root);
  const beforeSyntax = failures;
  for (const file of files) run(`Syntax: ${file}`, ['--check', file], true);
  console.log(`Syntax: ${files.length} JavaScript/module files checked${failures === beforeSyntax ? ' — passed' : ' — FAILED'}.`);
  run('Logic tests', ['tests/logic.test.js']);
  run('Worker/server tests', ['tests/worker.test.js']);
  run('CI regression tests', ['--test', 'tests/ci.test.mjs']);
  const changed = generatedDifferences(root);
  if (changed.length) {
    failures++;
    console.error(`\nFAIL: regenerated files differ from HEAD: ${changed.join(', ')}`);
    console.error('Run node worker/build.js and node scripts/stamp-sw.mjs, review and commit the generated files, then rerun npm run check.');
  } else console.log('\nGenerated Worker and service-worker stamp match committed HEAD.');
  console.log(failures ? `CHECK FAILED (${failures} failing checks).` : 'CHECK PASSED.');
  return failures === 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { if (!check()) process.exitCode = 1; }
  catch (error) { console.error(`CHECK FAILED: ${error.message}`); process.exitCode = 1; }
}
