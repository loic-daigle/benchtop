import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import JSZip from 'jszip';
import { zipInfo } from './gerber';

async function makeZip(names: string[]): Promise<string> {
  const zip = new JSZip();
  for (const n of names) zip.file(n, 'G04 test*\nM02*\n');
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'benchtop-zip-')), 'x.zip');
  writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
  return file;
}

test('recognises KiCad Gerber zips whatever their name', async () => {
  const kicad = await makeZip([
    'mother-F_Cu.gtl',
    'mother-B_Cu.gbl',
    'mother-Edge_Cuts.gm1',
    'mother-F_Mask.gts',
    'mother-PTH.drl',
    'mother-PTH-drl_map.gbr',
  ]);
  const info = await zipInfo(kicad);
  assert.equal(info.gerber, true);
  assert.equal(info.entries.length, 6);
});

test('other zips are just listed', async () => {
  const code = await makeZip(['src/main.cpp', 'README.md', 'platformio.ini']);
  const info = await zipInfo(code);
  assert.equal(info.gerber, false);
  assert.deepEqual(info.entries.map((e) => e.name).sort(), ['README.md', 'platformio.ini', 'src/main.cpp']);
});
