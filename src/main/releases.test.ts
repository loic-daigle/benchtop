import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createRelease, findFirmwareRepo, getReleases, initRelease, normalizeInfo, saveRelease } from './releases';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'benchtop-rel-'));
const g = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-C', cwd, ...args], { encoding: 'utf8' }).trim();

function project() {
  const p = tmp();
  const fw = path.join(p, 'firmware');
  mkdirSync(fw, { recursive: true });
  g(fw, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(fw, 'main.c'), 'v1');
  g(fw, 'add', '.');
  g(fw, 'commit', '-q', '-m', 'first');
  mkdirSync(path.join(p, 'pcb'));
  writeFileSync(path.join(p, 'pcb', 'Gerber_Board_2026-01-01.zip'), 'g1');
  writeFileSync(path.join(p, 'pcb', 'BOM_Board_2026-01-01.csv'), 'b1');
  return { p, fw };
}

test('info is read leniently', () => {
  const i = normalizeInfo({ date: new Date(2026, 0, 5), status: 'Ordered', order: 12345, firmware: { commit: 'abc' } }, '2026-02-02');
  assert.equal(i.date, '2026-01-05');
  assert.equal(i.status, 'ordered');
  assert.equal(i.order, '12345');
  assert.equal(i.firmware?.commit, 'abc');
  assert.equal(normalizeInfo({ status: 'lost' }, '2026-02-02').status, '');
  assert.equal(normalizeInfo(null, '2026-02-02').date, '2026-02-02');
});

test('finds the firmware repository', async () => {
  const { p } = project();
  assert.equal(await findFirmwareRepo(p), 'firmware');
  assert.equal(await findFirmwareRepo(tmp()), null);
});

test('create, list, edit releases and match the firmware', async () => {
  const { p, fw } = project();
  const r1 = await createRelease(p, {
    name: '2026-01-10',
    info: { date: '2026-01-10', board: 'rev A', status: 'ordered', order: 'JLC-1', link: '', note: 'first run\nUSB footprint wrong' },
    copyKinds: ['gerber', 'bom', 'pnp'],
    recordFirmware: true,
  });
  assert.equal(r1.relDir, 'releases/2026-01-10');
  assert.deepEqual(r1.files.map((f) => f.name).sort(), ['BOM_Board_2026-01-01.csv', 'Gerber_Board_2026-01-01.zip']);
  assert.equal(r1.info.firmware?.repo, 'firmware');
  const yaml = readFileSync(path.join(r1.path, 'release.yaml'), 'utf8');
  assert.match(yaml, /^# Benchtop release info/);
  assert.match(yaml, /link:\nnote: \|-\n {2}first run\n {2}USB footprint wrong/);

  let res = await getReleases(p);
  assert.equal(res.firmware.match?.release, '2026-01-10');
  assert.equal(res.firmware.match?.commitsSince, 0);

  // Two commits later, a second release, then one more commit.
  for (const v of ['v2', 'v3']) {
    writeFileSync(path.join(fw, 'main.c'), v);
    g(fw, 'commit', '-q', '-am', v);
  }
  const r2 = await createRelease(p, {
    name: '2026-01-10',
    info: { date: '2026-02-01', board: 'rev B', status: 'planned', order: '', link: '', note: '' },
    copyKinds: [],
    recordFirmware: true,
  });
  assert.equal(r2.name, '2026-01-10-2');
  writeFileSync(path.join(fw, 'main.c'), 'v4');
  g(fw, 'commit', '-q', '-am', 'v4');

  res = await getReleases(p);
  assert.deepEqual(res.releases.map((r) => r.name), ['2026-01-10-2', '2026-01-10']);
  assert.deepEqual(res.firmware.match, { release: '2026-01-10-2', commitsSince: 1 });
  assert.equal(res.firmware.since['2026-01-10'], 3);
  assert.equal(res.latestFab.gerber?.relPath.replace(/\\/g, '/'), 'pcb/Gerber_Board_2026-01-01.zip');

  // Editing keeps unknown keys and comments.
  const file = path.join(r1.path, 'release.yaml');
  writeFileSync(file, readFileSync(file, 'utf8') + '# mine\ncustom: 42\n');
  await saveRelease(p, r1.relDir, { ...r1.info, status: 'received', note: '' });
  const after = readFileSync(file, 'utf8');
  assert.match(after, /status: received/);
  assert.match(after, /custom: 42/);
  await assert.rejects(saveRelease(p, '../outside', r1.info));
});

test('an EasyEDA export folder gets a release.yaml once', async () => {
  const { p } = project();
  const dir = path.join(p, 'releases', '2026-03-03');
  mkdirSync(dir, { recursive: true });
  await initRelease(p, dir, { note: 'from EasyEDA' });
  await initRelease(p, dir, { note: 'again' });
  const res = await getReleases(p);
  assert.equal(res.releases[0].info.date, '2026-03-03');
  assert.equal(res.releases[0].info.note, 'from EasyEDA');
  assert.ok(res.releases[0].info.firmware?.commit);
});
