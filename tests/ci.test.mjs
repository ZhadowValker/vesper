import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { stampServiceWorker } from '../scripts/stamp-sw.mjs';
import { assertAppRepository, sourceFiles, generatedDifferences } from '../scripts/check.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'vesper-ci-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'sw.js'), "const VERSION = 'manual';\nconst ASSETS = ['./', 'index.html', 'image.bin'];\nself.addEventListener('install', () => {});\n");
  writeFileSync(path.join(root, 'index.html'), '<h1>Fixture</h1>\n');
  writeFileSync(path.join(root, 'image.bin'), Buffer.from([0, 255, 1, 2]));
  return root;
}

test('stamp is deterministic, includes binary assets, aliases ./, and ignores uncached files', (t) => {
  const root = fixture(t);
  const first = stampServiceWorker(root);
  assert.match(first.version, /^vesper-[0-9a-f]{64}$/);
  assert.equal(first.files, 2);
  const bytes = readFileSync(path.join(root, 'sw.js'));
  assert.equal(stampServiceWorker(root).changed, false);
  assert.deepEqual(readFileSync(path.join(root, 'sw.js')), bytes);
  writeFileSync(path.join(root, 'notes.txt'), 'not cached');
  assert.equal(stampServiceWorker(root).version, first.version);
  writeFileSync(path.join(root, 'image.bin'), Buffer.from([0, 255, 1, 3]));
  assert.notEqual(stampServiceWorker(root).version, first.version);
});

test('stamp covers cached text and normalized SW code without a self-hash loop', (t) => {
  const root = fixture(t);
  const original = stampServiceWorker(root).version;
  writeFileSync(path.join(root, 'index.html'), '<h1>Changed</h1>');
  const changed = stampServiceWorker(root).version;
  assert.notEqual(changed, original);
  const file = path.join(root, 'sw.js');
  writeFileSync(file, readFileSync(file, 'utf8').replace('install', 'activate'));
  const logic = stampServiceWorker(root).version;
  assert.notEqual(logic, changed);
  assert.equal(stampServiceWorker(root).version, logic);
  writeFileSync(file, readFileSync(file, 'utf8').replace(logic, 'hand-edited-value'));
  assert.equal(stampServiceWorker(root).version, logic);
});

test('stamp rejects missing assets and unsafe paths without changing sw.js', (t) => {
  const root = fixture(t), file = path.join(root, 'sw.js');
  for (const asset of ['missing.js', '../outside.js', 'https://example.invalid/code.js', '/root.js']) {
    const source = `const VERSION = 'unchanged';\nconst ASSETS = [${JSON.stringify(asset)}];\n`;
    writeFileSync(file, source);
    assert.throws(() => stampServiceWorker(root));
    assert.equal(readFileSync(file, 'utf8'), source);
  }
});

test('stamp rejects malformed declarations rather than silently skipping them', (t) => {
  const root = fixture(t), file = path.join(root, 'sw.js');
  for (const source of [
    "const ASSETS = ['index.html'];",
    "const VERSION = 'a';\nconst VERSION = 'b';\nconst ASSETS = ['index.html'];",
    "const VERSION = 'a';\nconst ASSETS = [];",
  ]) {
    writeFileSync(file, source);
    assert.throws(() => stampServiceWorker(root));
  }
});

test('syntax discovery includes tracked/untracked JS and MJS, not ignored runtime data', (t) => {
  const root = fixture(t);
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q');
  writeFileSync(path.join(root, '.gitignore'), 'node_modules/\ndata/\n');
  writeFileSync(path.join(root, 'tracked.js'), 'export const valid = true;\n');
  git('add', '.');
  writeFileSync(path.join(root, 'new.mjs'), 'const broken = ;');
  for (const dir of ['node_modules', 'data']) {
    mkdirSync(path.join(root, dir));
    writeFileSync(path.join(root, dir, 'ignored.js'), 'invalid!');
  }
  assert.deepEqual(sourceFiles(root), ['new.mjs', 'sw.js', 'tracked.js']);
  assert.notEqual(spawnSync(process.execPath, ['--check', 'new.mjs'], { cwd: root }).status, 0);
  assertAppRepository(root);
  mkdirSync(path.join(root, 'not-a-clone'));
  assert.throws(() => assertAppRepository(path.join(root, 'not-a-clone')), /own Git clone/);
});

test('generated-file check compares committed bytes, including staged modifications', (t) => {
  const root = fixture(t);
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q');
  mkdirSync(path.join(root, 'worker'));
  writeFileSync(path.join(root, 'worker/vesper-hub.js'), '// original\n');
  git('add', '.');
  git('-c', 'user.name=CI Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  assert.deepEqual(generatedDifferences(root), []);
  writeFileSync(path.join(root, 'worker/vesper-hub.js'), '// rebuilt\n');
  git('add', 'worker/vesper-hub.js');
  assert.deepEqual(generatedDifferences(root), ['worker/vesper-hub.js']);
  stampServiceWorker(root);
  assert.deepEqual(generatedDifferences(root), ['worker/vesper-hub.js', 'sw.js']);
});

test('full check command fails on stale generated files or bad syntax and passes after committing fresh outputs', (t) => {
  const root = fixture(t);
  for (const dir of ['scripts', 'worker', 'tests']) mkdirSync(path.join(root, dir));
  for (const name of ['check.mjs', 'stamp-sw.mjs']) copyFileSync(new URL(`../scripts/${name}`, import.meta.url), path.join(root, 'scripts', name));
  writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(path.join(root, 'worker/build.js'), String.raw`import { writeFileSync } from 'node:fs'; writeFileSync('worker/vesper-hub.js', '// rebuilt\n');`);
  writeFileSync(path.join(root, 'worker/vesper-hub.js'), '// stale\n');
  for (const file of ['logic.test.js', 'worker.test.js', 'ci.test.mjs']) writeFileSync(path.join(root, 'tests', file), '// Isolated pipeline fixture, no real app or recursive tests.\n');
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  const commit = () => {
    git('add', '.');
    git('-c', 'user.name=CI Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  };
  git('init', '-q'); commit();
  const run = () => spawnSync(process.execPath, ['scripts/check.mjs'], { cwd: root, encoding: 'utf8' });
  const stale = run();
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /regenerated files differ from HEAD: worker\/vesper-hub.js, sw.js/);
  commit();
  const clean = run();
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /CHECK PASSED/);
  writeFileSync(path.join(root, 'bad.mjs'), 'const invalid = ;');
  const invalid = run();
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /FAIL: Syntax: bad.mjs/);
});
