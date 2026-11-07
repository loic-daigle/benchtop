import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readMeta } from './meta';
import { changes, commitAndPush, findSecrets, precheck } from './publish';
import { applyPlan, canUndo, createProject, planStructure, slugify, targetForFile, undoPlan } from './structure';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'benchtop-st-'));
const rel = (root: string, p: string) => path.relative(root, p).split(path.sep).join('/');

test('slugify and file targets', () => {
  assert.equal(slugify('Smart Dial (v2)!'), 'smart-dial-v2');
  assert.equal(slugify('Idées projet'), 'idees-projet');
  assert.equal(targetForFile('Boitier.stl'), 'mechanical');
  assert.equal(targetForFile('Menu_Esp32.ino'), 'firmware/Menu_Esp32');
  assert.equal(targetForFile('Gerber_PCB_x.zip'), 'pcb');
  assert.equal(targetForFile('firmware.bin'), 'releases');
  assert.equal(targetForFile('photo.jpg'), 'docs/images');
  assert.equal(targetForFile('random.xyz'), null);
});

test('createProject builds the standard layout', async () => {
  const root = tmp();
  const dir = await createProject({
    name: 'Smart Dial',
    folderName: 'smart-dial',
    parentDir: root,
    kind: 'hardware',
    status: 'active',
    tags: ['esp32'],
    description: 'A dial',
    gitInit: false,
  });
  for (const d of ['firmware', 'pcb', 'mechanical', 'docs/images', 'releases']) assert.ok(existsSync(path.join(dir, d, '.gitkeep')), d);
  assert.match(readFileSync(path.join(dir, 'README.md'), 'utf8'), /# Smart Dial\n\nA dial/);
  assert.match(readFileSync(path.join(dir, '.gitignore'), 'utf8'), /secrets\.h/);
  assert.match(readFileSync(path.join(dir, '.gitattributes'), 'utf8'), /\*\.step filter=lfs/);
  assert.deepEqual((await readMeta(dir)).meta, { status: 'active', description: 'A dial', tags: ['esp32'] });
  await assert.rejects(createProject({ name: 'x', folderName: 'smart-dial', parentDir: root, kind: 'software', gitInit: false }), /already exists/);
  await assert.rejects(createProject({ name: 'x', folderName: 'bad:name', parentDir: root, kind: 'software', gitInit: false }));
});

test('planStructure → apply → undo on a messy project', async () => {
  const p = tmp();
  // Like Wifi_Button / OpenHotplate
  mkdirSync(path.join(p, '3D Files'));
  writeFileSync(path.join(p, '3D Files', 'Base.step'), 'x');
  mkdirSync(path.join(p, 'Codes', 'V3'), { recursive: true });
  writeFileSync(path.join(p, 'Codes', 'V3', 'V3.ino'), 'x');
  mkdirSync(path.join(p, 'Images_Instructables'));
  writeFileSync(path.join(p, 'Images_Instructables', '1.jpg'), 'x');
  mkdirSync(path.join(p, 'PCB'));
  writeFileSync(path.join(p, 'PCB', 'Gerber_x.zip'), 'x');
  mkdirSync(path.join(p, 'sketch_apr1a'));
  writeFileSync(path.join(p, 'sketch_apr1a', 'sketch_apr1a.ino'), 'x');
  mkdirSync(path.join(p, 'vendor-lib', '.git'), { recursive: true });
  mkdirSync(path.join(p, 'Misc'));
  writeFileSync(path.join(p, 'Misc', 'a.stl'), 'x');
  writeFileSync(path.join(p, 'Misc', 'b.ino'), 'x');
  writeFileSync(path.join(p, 'Boitier v3.stl'), 'x');
  writeFileSync(path.join(p, 'Menu.ino'), 'x');
  writeFileSync(path.join(p, 'BOM_main.csv'), 'x');
  writeFileSync(path.join(p, 'Notes.txt'), 'x');
  writeFileSync(path.join(p, 'README.md'), '# x');
  writeFileSync(path.join(p, 'weird.xyz'), 'x');

  const plan = await planStructure(p);
  const moves = Object.fromEntries(plan.moves.map((m) => [rel(p, m.from), rel(p, m.to)]));
  assert.deepEqual(moves, {
    '3D Files': 'mechanical',
    Codes: 'firmware',
    Images_Instructables: 'docs/images',
    PCB: 'pcb',
    sketch_apr1a: 'firmware/sketch_apr1a',
    'Boitier v3.stl': 'mechanical/Boitier v3.stl',
    'Menu.ino': 'firmware/Menu/Menu.ino',
    'BOM_main.csv': 'pcb/BOM_main.csv',
    'Notes.txt': 'docs/Notes.txt',
  });
  const kept = plan.kept.map((k) => rel(p, k.path)).sort();
  assert.deepEqual(kept, ['Misc', 'vendor-lib', 'weird.xyz']);

  const result = await applyPlan(p, plan.moves, path.join(p, '..', path.basename(p) + '-undo'));
  assert.equal(result.failed.length, 0, JSON.stringify(result.failed));
  assert.ok(existsSync(path.join(p, 'mechanical', 'Base.step')));
  assert.ok(existsSync(path.join(p, 'mechanical', 'Boitier v3.stl')));
  assert.ok(existsSync(path.join(p, 'firmware', 'V3', 'V3.ino')));
  assert.ok(existsSync(path.join(p, 'firmware', 'sketch_apr1a', 'sketch_apr1a.ino')));
  assert.ok(existsSync(path.join(p, 'firmware', 'Menu', 'Menu.ino')));
  assert.ok(existsSync(path.join(p, 'docs', 'images', '1.jpg')));

  const logDir = path.join(p, '..', path.basename(p) + '-undo');
  assert.equal(await canUndo(p, logDir), true);
  const undo = await undoPlan(p, logDir);
  assert.equal(undo.failed.length, 0);
  assert.ok(existsSync(path.join(p, '3D Files', 'Base.step')));
  assert.ok(existsSync(path.join(p, 'Menu.ino')));
  assert.ok(!existsSync(path.join(p, 'mechanical')), 'created folders are removed on undo');
  assert.ok(!existsSync(path.join(p, 'docs')));
  assert.equal(await canUndo(p, logDir), false);
});

test('software projects are left alone', async () => {
  const p = tmp();
  writeFileSync(path.join(p, 'package.json'), '{}');
  writeFileSync(path.join(p, 'icon.png'), 'x');
  const plan = await planStructure(p);
  assert.equal(plan.kind, 'software');
  assert.equal(plan.moves.length, 0);
});

// Fake secrets are assembled at run time so this file itself never looks like it contains one
// (Benchtop's own publish check and GitHub's secret scanning both read the source).
const PW = 'pass' + 'word';
const FAKE_TOKEN = 'gh' + 'p_' + 'abcdefghijklmnopqrstuvwxyz0123456789';

test('findSecrets catches WiFi passwords but not placeholders', () => {
  const code = [
    `const char* ${'ss' + 'id'} = "MaisonLoic";`,
    `const char* ${PW} = "hunter2pass";`,
    `const char* ${PW} = "YOUR_PASSWORD";`,
    `#define WIFI_${'PA' + 'SS'} "abc12345"`,
    `String ${'tok' + 'en'} = "${FAKE_TOKEN}";`,
    'int pass = 3;',
  ].join('\n');
  const hits = findSecrets(code, 'main.ino').map((h) => h.line);
  assert.deepEqual(hits, [1, 2, 4, 5]);
});

function hasGit(): boolean {
  try {
    execFileSync('git', ['--version']);
    return true;
  } catch {
    return false;
  }
}

test('precheck + commitAndPush against a local remote', { skip: !hasGit() }, async () => {
  const root = tmp();
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', '-b', 'main', remote]);
  const p = path.join(root, 'proj');
  mkdirSync(path.join(p, 'firmware'), { recursive: true });
  mkdirSync(path.join(p, 'node_modules', 'x'), { recursive: true });
  mkdirSync(path.join(p, 'lib', '.git'), { recursive: true });
  writeFileSync(path.join(p, 'firmware', 'main.ino'), `const char* ${PW} = "secret123";\n`);
  writeFileSync(path.join(p, 'node_modules', 'x', 'big.js'), `${PW} = "zzzzzzzz"`);
  writeFileSync(path.join(p, 'case.stl'), 'solid');

  const pre = await precheck(p);
  assert.equal(pre.isRepo, false);
  assert.equal(pre.fileCount, 2, 'node_modules and nested repos are skipped');
  assert.deepEqual(pre.nestedRepos, ['lib']);
  assert.equal(pre.cadFileCount, 1);
  assert.equal(pre.secrets.length, 1);
  assert.equal(pre.secrets[0].line, 1);
  assert.equal(pre.suggestedName, 'proj');

  const g = (...args: string[]) => execFileSync('git', args, { cwd: p }).toString();
  g('init', '-b', 'main');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  g('remote', 'add', 'origin', remote);
  writeFileSync(path.join(p, '.gitignore'), 'node_modules/\nlib/\n');
  assert.ok((await changes(p)).some((c) => c.path === 'case.stl'));
  const msg = await commitAndPush(p, 'First', null);
  assert.match(msg, /Committed\. Pushed to main/);
  assert.equal((await changes(p)).length, 0);
  assert.match(execFileSync('git', ['--git-dir', remote, 'log', '--oneline']).toString(), /First/);
  assert.match(await commitAndPush(p, '', null), /Nothing new to commit/);
});

test('project.yaml is kept out of git via .git/info/exclude', { skip: !hasGit() }, async () => {
  const { ensureExcluded } = await import('./gitExclude');
  const p = tmp();
  execFileSync('git', ['init', '-b', 'main', p]);
  writeFileSync(path.join(p, 'project.yaml'), 'status: idea\n');
  writeFileSync(path.join(p, 'main.ino'), 'x');
  mkdirSync(path.join(p, 'releases', '2026-11-06'), { recursive: true });
  writeFileSync(path.join(p, 'releases', '2026-11-06', 'release.yaml'), 'order: secret\n');
  writeFileSync(path.join(p, 'releases', '2026-11-06', 'Gerber_X.zip'), 'g');
  writeFileSync(path.join(p, '.git', 'info', 'exclude'), '# git ls-files --others --exclude-from=.git/info/exclude\n*.tmp');
  const st = () => execFileSync('git', ['status', '--porcelain'], { cwd: p }).toString();
  assert.match(st(), /project\.yaml/);
  assert.equal(await ensureExcluded(p), true);
  assert.doesNotMatch(st(), /project\.yaml/);
  const files = execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: p }).toString();
  assert.doesNotMatch(files, /release\.yaml/);
  assert.match(files, /releases\/2026-11-06\/Gerber_X\.zip/, 'release files are still committed');
  assert.match(st(), /main\.ino/, 'other files still show up');
  assert.equal(await ensureExcluded(p), false, 'idempotent');
  const text = readFileSync(path.join(p, '.git', 'info', 'exclude'), 'utf8');
  assert.match(text, /\*\.tmp\n\n# Benchtop \(local only, not committed\)\n\/project\.yaml\n\*\*\/\[Rr\]eleases\/\*\/release\.yaml\n$/);
  assert.equal(await ensureExcluded(tmp()), false, 'not a repo');
});

test('new-project .gitignore ignores project.yaml', async () => {
  const root = tmp();
  const dir = await createProject({ name: 'X', folderName: 'x', parentDir: root, kind: 'hardware', gitInit: false });
  const gi = readFileSync(path.join(dir, '.gitignore'), 'utf8');
  assert.match(gi, /^project\.yaml$/m);
  assert.match(gi, /^\*\*\/\[Rr\]eleases\/\*\/release\.yaml$/m);
});
