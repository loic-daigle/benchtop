import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { categorize } from '../shared/fileKinds';
import { fuzzyScore } from './fuzzy';
import { parseStatus, remoteToWebUrl } from './git';
import { normalizeMeta, readMeta, writeMeta } from './meta';
import {
  decodeText,
  discoverProjects,
  extractDescription,
  isInside,
  listDir,
  readText,
  searchProjects,
  summarizeProject,
} from './scanner';
import { ProjectStore } from './store';

function tmp(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'benchtop-'));
}

test('isInside blocks paths outside the root', () => {
  const root = path.resolve('/projects');
  assert.equal(isInside(root, path.join(root, 'a', 'b.txt')), true);
  assert.equal(isInside(root, root), true);
  assert.equal(isInside(root, path.join(root, '..', 'secret')), false);
  assert.equal(isInside(root, path.resolve('/projects-other/x')), false);
});

test('extractDescription takes the first real paragraph', () => {
  const md = '# Title\n\n[![badge](x)](y)\n\nA small **smart** dial for [Home Assistant](https://x).\nSecond line.\n\n## More';
  assert.equal(extractDescription(md), 'A small smart dial for Home Assistant. Second line.');
  assert.equal(extractDescription('# Only a title\n'), null);
});

test('categorize recognises maker files', () => {
  assert.equal(categorize('Main_PCB.step'), 'cad');
  assert.equal(categorize('Gerber_OpenMacro_PCB.zip'), 'pcb');
  assert.equal(categorize('BOM_OpenMacro.csv'), 'pcb');
  assert.equal(categorize('working_step74.ino'), 'code');
  assert.equal(categorize('CMakeLists.txt'), 'code');
  assert.equal(categorize('Logo.svg'), 'image');
  assert.equal(categorize('notes.txt'), 'doc');
});

test('decodeText handles UTF-8, UTF-16 (EasyEDA BOMs) and Windows-1252', () => {
  assert.equal(decodeText(Buffer.from('Idées', 'utf8')).encoding, 'UTF-8');
  const latin = decodeText(Buffer.from([0x49, 0x64, 0xe9, 0x65, 0x73]));
  assert.equal(latin.encoding, 'Windows-1252');
  assert.equal(latin.text, 'Idées');
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('ID\tName\n1\tR1', 'utf16le')]);
  assert.deepEqual(decodeText(utf16), { text: 'ID\tName\n1\tR1', encoding: 'UTF-16 LE' });
});

test('project.yaml: normalize, write keeps comments and unknown keys', async () => {
  assert.deepEqual(normalizeMeta({ status: 'Active', tags: 'ESP32, usb-c', links: { github: 'https://github.com/x/y' } }), {
    status: 'active',
    tags: ['esp32', 'usb-c'],
    links: [{ label: 'github', url: 'https://github.com/x/y' }],
  });
  assert.deepEqual(normalizeMeta({ status: 'nope' }), {});

  const dir = tmp();
  writeFileSync(path.join(dir, 'project.yaml'), '# my comment\nstatus: idea\ncustom: keep me\n');
  await writeMeta(dir, { status: 'active', tags: ['ESP32'], description: 'Hot plate', links: [{ label: 'youtube', url: 'https://youtu.be/x' }] });
  const text = readFileSync(path.join(dir, 'project.yaml'), 'utf8');
  assert.match(text, /# my comment/);
  assert.match(text, /custom: keep me/);
  const { meta } = await readMeta(dir);
  assert.deepEqual(meta, {
    status: 'active',
    description: 'Hot plate',
    tags: ['esp32'],
    links: [{ label: 'youtube', url: 'https://youtu.be/x' }],
  });
  await writeMeta(dir, { status: 'done' });
  assert.deepEqual((await readMeta(dir)).meta, { status: 'done' });
});

test('git helpers', () => {
  assert.equal(remoteToWebUrl('git@github.com:loic/benchtop.git'), 'https://github.com/loic/benchtop');
  assert.equal(remoteToWebUrl('https://user:tok@github.com/loic/x.git'), 'https://github.com/loic/x');
  assert.deepEqual(parseStatus('## main...origin/main [ahead 2, behind 1]\n M a.ts\n?? b.ts\n'), {
    branch: 'main',
    ahead: 2,
    behind: 1,
    changes: 2,
  });
  assert.equal(parseStatus('## No commits yet on master\n').branch, 'master');
});

test('fuzzyScore prefers file-name matches', () => {
  assert.ok(fuzzyScore('hotplate', 'Code/Hotplate/main.ino') > 0);
  assert.equal(fuzzyScore('zzz', 'main.ino'), -1);
  assert.ok(fuzzyScore('main', 'src/main.ino') > fuzzyScore('main', 'main_board/x.c'));
  assert.ok(fuzzyScore('smw', 'Smart_Scroll_Wheel') > 0);
});

function makeSample(root: string) {
  const proj = path.join(root, 'Smart Dial');
  mkdirSync(path.join(proj, 'firmware', 'node_modules', 'junk'), { recursive: true });
  mkdirSync(path.join(proj, 'docs', 'images'), { recursive: true });
  mkdirSync(path.join(proj, 'vendor', 'lib', '.git'), { recursive: true });
  writeFileSync(path.join(proj, 'README.md'), '# Smart Dial\n\nA rotary dial.\n');
  writeFileSync(path.join(proj, 'firmware', 'main.ino'), 'void setup() {}\n// TPS25751 config\n');
  writeFileSync(path.join(proj, 'firmware', 'node_modules', 'junk', 'a.js'), 'TPS25751');
  writeFileSync(path.join(proj, 'docs', 'images', 'cover.png'), 'png');
  writeFileSync(path.join(proj, 'case.stl'), 'solid');
  writeFileSync(path.join(proj, 'blob.bin'), Buffer.from([1, 0, 2, 3]));

  // A group folder with two projects
  const sw = path.join(root, 'Software');
  mkdirSync(path.join(sw, 'AppA'), { recursive: true });
  mkdirSync(path.join(sw, 'AppB', '.git'), { recursive: true });
  mkdirSync(path.join(sw, 'AppC'), { recursive: true });
  mkdirSync(path.join(sw, 'Scratch'), { recursive: true });
  writeFileSync(path.join(sw, 'AppA', 'package.json'), '{}');
  writeFileSync(path.join(sw, 'AppC', 'README.md'), '# C');
  writeFileSync(path.join(sw, 'loose.zip'), 'x');

  // A project with many loose files and sketch sub-folders stays ONE project
  const remote = path.join(root, 'Remote');
  for (const sub of ['sketch_a', 'sketch_b', 'sketch_c']) {
    mkdirSync(path.join(remote, sub), { recursive: true });
    writeFileSync(path.join(remote, sub, `${sub}.ino`), '');
  }
  for (const f of ['case.stl', 'case.step', 'lid.stl', 'pcb.svg', 'notes.txt']) writeFileSync(path.join(remote, f), '');
  return proj;
}

test('summarize, groups, listDir, readText, search on a sample tree', async () => {
  const root = tmp();
  const proj = makeSample(root);

  const { summary: s, files } = await summarizeProject(proj);
  assert.equal(s.name, 'Smart Dial');
  assert.equal(s.description, 'A rotary dial.');
  assert.equal(s.isGitRepo, false);
  assert.equal(s.containsGitRepo, true);
  assert.equal(s.counts.code, 1, 'node_modules must be skipped');
  assert.equal(s.counts.cad, 1);
  assert.equal(path.basename(s.thumbnailPath ?? ''), 'cover.png');
  assert.ok(files.includes(path.join('firmware', 'main.ino')));

  // cover from project.yaml wins, description too
  writeFileSync(path.join(proj, 'project.yaml'), 'description: From yaml\ncover: case.stl\n');
  const again = (await summarizeProject(proj)).summary;
  assert.equal(again.description, 'From yaml');
  assert.equal(path.basename(again.thumbnailPath ?? ''), 'case.stl');

  const locations = await discoverProjects(root);
  assert.deepEqual(
    locations.map((l) => [path.basename(l.path), l.group]).sort(),
    [
      ['AppA', 'Software'],
      ['AppB', 'Software'],
      ['AppC', 'Software'],
      ['Remote', null],
      ['Scratch', 'Software'],
      ['Smart Dial', null],
    ],
  );

  const entries = await listDir(path.join(proj, 'firmware'));
  assert.deepEqual(
    entries.map((e) => [e.name, e.isDir, e.heavy]),
    [
      ['node_modules', true, true],
      ['main.ino', false, false],
    ],
  );
  assert.equal((await readText(path.join(proj, 'firmware', 'main.ino'))).kind, 'text');
  assert.equal((await readText(path.join(proj, 'blob.bin'))).kind, 'binary');

  const res = await searchProjects([{ path: proj, name: 'Smart Dial' }], 'tps25751');
  assert.equal(res.results.length, 1, 'node_modules must not be searched');
  assert.equal(res.results[0].matches[0].line, 2);
});

test('project.yaml group: true turns a folder into a group, false back', async () => {
  const root = tmp();
  const ps = path.join(root, 'PartSense');
  for (const sub of ['Cabinet/Code/main', 'Part Counter/Code', 'Magazine/3D', '_old/x']) mkdirSync(path.join(ps, sub), { recursive: true });
  writeFileSync(path.join(ps, 'project.yaml'), 'status: paused\n');
  assert.deepEqual((await discoverProjects(root)).map((l) => path.basename(l.path)), ['PartSense']);

  const store = new ProjectStore(path.join(tmp(), 'c.json'), { projects: () => undefined, fsChanged: () => undefined });
  await store.list(root);
  await store.setGroup(ps, true);
  assert.match(readFileSync(path.join(ps, 'project.yaml'), 'utf8'), /status: paused[\s\S]*group: true/);
  const grouped = await discoverProjects(root);
  assert.deepEqual(grouped.map((l) => [path.basename(l.path), l.group]).sort(), [
    ['Cabinet', 'PartSense'],
    ['Magazine', 'PartSense'],
    ['Part Counter', 'PartSense'],
  ]);
  await store.setGroup(ps, false);
  assert.deepEqual((await discoverProjects(root)).map((l) => path.basename(l.path)), ['PartSense']);
  store.dispose();
});

test('ProjectStore: list, quickFind, notes', async () => {
  const root = tmp();
  const proj = makeSample(root);
  const updates: number[] = [];
  const store = new ProjectStore(path.join(tmp(), 'cache.json'), {
    projects: (l) => updates.push(l.length),
    fsChanged: () => undefined,
  });
  const list = await store.list(root);
  assert.equal(list.length, 6);
  const hits = store.quickFind('main.ino');
  assert.equal(hits[0].kind, 'file');
  assert.equal(path.basename(hits[0].path), 'main.ino');
  assert.equal(store.quickFind('dial')[0].kind, 'project');

  await store.saveNotes(proj, '');
  assert.equal(await store.readNotes(proj), '', 'empty notes must not create a file');
  await store.saveNotes(proj, '- [ ] order PCB\n');
  assert.equal(await store.readNotes(proj), '- [ ] order PCB\n');
  await assert.rejects(store.saveNotes(path.join(root, 'nope'), 'x'));
  store.dispose();
});
