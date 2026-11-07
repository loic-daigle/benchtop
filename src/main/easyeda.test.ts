import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import JSZip from 'jszip';
import { copyBackup, fabKind, findFabFiles, nameScore, parseBackupFile, parseBackupFolder, readStatus, suggestMatches } from './easyeda';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'benchtop-ee-'));

test('backup folder and file names', () => {
  assert.deepEqual(parseBackupFolder('915c57d9a152460395cfc726ccbfca8e_Smart-SMD-Magazine'), {
    uuid: '915c57d9a152460395cfc726ccbfca8e',
    name: 'Smart-SMD-Magazine',
  });
  assert.deepEqual(parseBackupFolder('Desk-USB-Hub'), { uuid: null, name: 'Desk-USB-Hub' });
  const a = parseBackupFile('Smart-SMD-Magazine_v536_2025-12-27-20-33-36.zip');
  assert.equal(a.version, 536);
  assert.equal(new Date(a.date!).getFullYear(), 2025);
  assert.equal(new Date(a.date!).getHours(), 20);
  assert.equal(parseBackupFile('Desk-USB-Hub_2026-10-16-22-09-33.zip').version, null);
});

test('name matching with the real project names', () => {
  const projects = [
    'Desk USB-C PD Hub',
    'Smart_Scroll_Wheel',
    'DIY Modified Reflow Hot Plate',
    'OpenHotplate',
    'Wifi_Button',
    'Smart_SMD_Magazine',
    'PartSense Part Counter',
    'Boat Power Controller',
  ].map((name) => ({ name, path: `/p/${name}` }));
  const ee = [
    'Desk-USB-Hub',
    'Smart-Scroll-Wheel',
    'DIY-Modified-Hot-Plate',
    'OpenHotplate-V2',
    'Smart-SMD-Magazine',
    'ESP01-Wifi-Button',
    'Smart-Recessed-Downlight',
    'Test-flex-pcb-smd',
  ].map((name) => ({ name }));
  const s = suggestMatches(ee, projects);
  assert.equal(s['Desk-USB-Hub'], '/p/Desk USB-C PD Hub');
  assert.equal(s['Smart-Scroll-Wheel'], '/p/Smart_Scroll_Wheel');
  assert.equal(s['DIY-Modified-Hot-Plate'], '/p/DIY Modified Reflow Hot Plate');
  assert.equal(s['OpenHotplate-V2'], '/p/OpenHotplate');
  assert.equal(s['Smart-SMD-Magazine'], '/p/Smart_SMD_Magazine');
  assert.equal(s['ESP01-Wifi-Button'], '/p/Wifi_Button');
  assert.equal(s['Smart-Recessed-Downlight'], null);
  assert.equal(s['Test-flex-pcb-smd'], null);
  assert.ok(nameScore('Smart-Light-Switch', 'Boat Power Controller') < 0.2);
});

test('readStatus indexes backups, merges duplicate folders, fixes old user paths', async () => {
  const docs = tmp();
  const data = path.join(docs, 'EasyEDA-Pro');
  const backups = path.join(data, 'online-projects-backup');
  mkdirSync(path.join(backups, '915c57d9a152460395cfc726ccbfca8e_Smart-SMD-Magazine'), { recursive: true });
  mkdirSync(path.join(backups, 'Smart-SMD-Magazine'), { recursive: true });
  mkdirSync(path.join(backups, 'Desk-USB-Hub'), { recursive: true });
  writeFileSync(path.join(backups, '915c57d9a152460395cfc726ccbfca8e_Smart-SMD-Magazine', 'Smart-SMD-Magazine_v388_2025-07-29-20-16-08.zip'), 'a');
  writeFileSync(path.join(backups, 'Smart-SMD-Magazine', 'Smart-SMD-Magazine_v536_2025-12-27-20-33-36.zip'), 'b');
  writeFileSync(path.join(backups, 'Desk-USB-Hub', 'Desk-USB-Hub_2026-10-16-22-09-33.zip'), 'c');
  writeFileSync(path.join(backups, 'Desk-USB-Hub', 'notes.txt'), 'ignored');
  writeFileSync(
    path.join(data, 'config.json'),
    JSON.stringify({ type: 'ONLINE', ONLINE_BACKUP_DIR: 'C:\\Users\\someoneelse\\Documents\\EasyEDA-Pro\\online-projects-backup' }),
  );
  const s = await readStatus(docs);
  assert.equal(s.found, true);
  assert.equal(s.mode, 'ONLINE');
  assert.equal(s.projects.length, 2);
  const mag = s.projects.find((p) => p.name === 'Smart-SMD-Magazine')!;
  assert.equal(mag.folders.length, 2);
  assert.equal(mag.backups, 2);
  assert.equal(mag.latest?.version, 536);
  assert.equal(mag.uuid, '915c57d9a152460395cfc726ccbfca8e');
  assert.equal(s.projects[0].name, 'Desk-USB-Hub', 'newest first');
  assert.deepEqual(await readStatus(tmp()), { found: false, dataDir: null, mode: null, backupDir: null, projects: [] });
});

test('fabrication files and copying a backup', async () => {
  assert.equal(fabKind('Gerber_Main_PCB_2024-09-21.zip'), 'gerber');
  assert.equal(fabKind('BOM_Main PCB_Main PCB_2024-09-21.xlsx'), 'bom');
  assert.equal(fabKind('PickAndPlace_Main PCB_2024-09-21.xlsx'), 'pnp');
  assert.equal(fabKind('Schematic_The-OpenMacro_2024-04-04.pdf'), 'schematic');
  assert.equal(fabKind('PCB_OpenMacro.json'), 'source');
  assert.equal(fabKind('3D_PCB1_2025-02-27.step'), 'step');
  assert.equal(fabKind('case.step'), null);
  assert.equal(fabKind('datasheet.pdf'), null);
  // KiCad / JLC plugin / hand-made names
  assert.equal(fabKind('benchport-mainboard-gerbers-revA.zip'), 'gerber');
  assert.equal(fabKind('benchport-mainboard-bom-revA.csv'), 'bom');
  assert.equal(fabKind('benchport-mainboard-cpl-revA.csv'), 'pnp');
  assert.equal(fabKind('bom.csv'), 'bom');
  assert.equal(fabKind('positions.csv'), 'pnp');
  assert.equal(fabKind('mother-top-pos.csv'), 'pnp');
  assert.equal(fabKind('benchport-mainboard-schematic.pdf'), 'schematic');
  assert.equal(fabKind('board.epro2'), 'source');
  assert.equal(fabKind('bombardier.csv'), null);
  assert.equal(fabKind('designators.csv'), null);

  const p = tmp();
  mkdirSync(path.join(p, 'PCB'));
  mkdirSync(path.join(p, 'node_modules'));
  writeFileSync(path.join(p, 'PCB', 'Gerber_A.zip'), 'g');
  writeFileSync(path.join(p, 'BOM_A.csv'), 'b');
  writeFileSync(path.join(p, 'node_modules', 'Gerber_x.zip'), 'skip');
  const files = await findFabFiles(p);
  assert.deepEqual(files.map((f) => f.kind).sort(), ['bom', 'gerber']);

  // KiCad: production/mother.zip holds Gerbers; production/backups/ is old output.
  const k = tmp();
  mkdirSync(path.join(k, 'production', 'backups'), { recursive: true });
  const zip = new JSZip();
  for (const n of ['mother-F_Cu.gtl', 'mother-B_Cu.gbl', 'mother-Edge_Cuts.gm1', 'mother-PTH.drl']) zip.file(n, 'G04*');
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  writeFileSync(path.join(k, 'production', 'mother.zip'), bytes);
  writeFileSync(path.join(k, 'production', 'backups', 'mother_2026-09-27.zip'), bytes);
  writeFileSync(path.join(k, 'production', 'bom.csv'), 'b');
  writeFileSync(path.join(k, 'production', 'positions.csv'), 'p');
  writeFileSync(path.join(k, 'production', 'firmware.zip'), 'not a zip');
  const kf = await findFabFiles(k);
  assert.deepEqual(kf.map((f) => `${f.kind}:${f.name}`).sort(), ['bom:bom.csv', 'gerber:mother.zip', 'pnp:positions.csv']);

  const backup = path.join(tmp(), 'Proj_v3_2026-01-01-10-00-00.zip');
  writeFileSync(backup, 'zip');
  const dest = await copyBackup(backup, p);
  assert.ok(existsSync(dest));
  assert.equal(path.relative(p, dest).split(path.sep).join('/'), 'pcb/easyeda/Proj_v3_2026-01-01-10-00-00.zip');
  await assert.rejects(copyBackup(backup, p), /already there/);
});
