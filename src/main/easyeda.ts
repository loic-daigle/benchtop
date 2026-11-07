/**
 * EasyEDA Pro integration (read side).
 * - Reads the client's config (Documents/EasyEDA-Pro/config.json) to find its folders.
 * - Indexes the automatic backups of cloud projects (online-projects-backup/<uuid_>Name/Name_vNNN_YYYY-MM-DD-HH-MM-SS.zip)
 *   and local .eprj projects.
 * - Finds fabrication exports inside a project folder (Gerber, BOM, pick & place, schematic PDF, sources, 3D).
 * Nothing here writes, except copyBackup() on an explicit user action.
 */
import { zipInfo } from './gerber';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { HEAVY_DIRS, HIDDEN_NAMES } from '../shared/fileKinds';
import type { EasyEdaBackup, EasyEdaProject, EasyEdaStatus, FabFile, FabKind } from '../shared/types';

const DATA_DIR_NAMES = ['EasyEDA-Pro', 'LCEDA-Pro'];

interface EasyEdaConfig {
  type?: string;
  APP_PROJECT_DIR?: string[];
  ONLINE_BACKUP_DIR?: string;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** "a1b2…(32 hex)_Smart-SMD-Magazine" -> { uuid, name } */
export function parseBackupFolder(folder: string): { uuid: string | null; name: string } {
  const m = /^([0-9a-f]{32})_(.+)$/i.exec(folder);
  return m ? { uuid: m[1].toLowerCase(), name: m[2] } : { uuid: null, name: folder };
}

/** "Desk-USB-Hub_v12_2026-10-16-22-09-33.zip" -> version 12, date (local time) */
export function parseBackupFile(file: string): { version: number | null; date: number | null } {
  const v = /_v(\d+)_/i.exec(file);
  const d = /_(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})\.(zip|epro)$/i.exec(file);
  const date = d ? new Date(+d[1], +d[2] - 1, +d[3], +d[4], +d[5], +d[6]).getTime() : null;
  return { version: v ? Number(v[1]) : null, date };
}

/** Where the backup folder lives: from config.json if possible, else the default next to it. */
async function resolveDir(configured: string | undefined, dataDir: string, fallback: string): Promise<string | null> {
  if (configured) {
    if (await exists(configured)) return configured;
    // The config may hold another Windows user name (e.g. after a PC change): keep the tail.
    const tail = configured.split(/[\\/]/).slice(-1)[0];
    const local = path.join(dataDir, tail);
    if (await exists(local)) return local;
  }
  const def = path.join(dataDir, fallback);
  return (await exists(def)) ? def : null;
}

export async function findDataDir(documentsDir: string): Promise<string | null> {
  for (const name of DATA_DIR_NAMES) {
    const dir = path.join(documentsDir, name);
    if (await exists(path.join(dir, 'config.json'))) return dir;
  }
  return null;
}

export async function readStatus(documentsDir: string): Promise<EasyEdaStatus> {
  const dataDir = await findDataDir(documentsDir);
  if (!dataDir) return { found: false, dataDir: null, mode: null, backupDir: null, projects: [] };

  let config: EasyEdaConfig = {};
  try {
    config = JSON.parse(await fs.readFile(path.join(dataDir, 'config.json'), 'utf8')) as EasyEdaConfig;
  } catch {
    /* defaults */
  }
  const backupDir = await resolveDir(config.ONLINE_BACKUP_DIR, dataDir, 'online-projects-backup');

  const byName = new Map<string, EasyEdaProject>();
  if (backupDir) {
    for (const entry of await fs.readdir(backupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const { uuid, name } = parseBackupFolder(entry.name);
      const folder = path.join(backupDir, entry.name);
      const backups: EasyEdaBackup[] = [];
      for (const f of await fs.readdir(folder, { withFileTypes: true }).catch(() => [])) {
        if (!f.isFile() || !/\.(zip|epro)$/i.test(f.name)) continue;
        const full = path.join(folder, f.name);
        const st = await fs.stat(full).catch(() => null);
        if (!st) continue;
        const parsed = parseBackupFile(f.name);
        backups.push({ file: f.name, path: full, date: parsed.date ?? st.mtimeMs, version: parsed.version, size: st.size });
      }
      backups.sort((a, b) => b.date - a.date);
      const key = name.toLowerCase();
      const current = byName.get(key);
      if (current) {
        // The same project can have two backup folders (with and without its id).
        current.folders.push(folder);
        current.backups += backups.length;
        if (backups[0] && (!current.latest || backups[0].date > current.latest.date)) current.latest = backups[0];
        current.uuid = current.uuid ?? uuid;
      } else {
        byName.set(key, { name, uuid, folders: [folder], backups: backups.length, latest: backups[0] ?? null, eprj: null });
      }
    }
  }

  // Local (offline-mode) projects: *.eprj files in the project folders.
  for (const dir of config.APP_PROJECT_DIR ?? []) {
    const resolved = await resolveDir(dir, dataDir, 'projects');
    if (!resolved || /example-projects$/i.test(resolved)) continue;
    for (const f of await fs.readdir(resolved, { withFileTypes: true }).catch(() => [])) {
      if (!f.isFile() || !/\.eprj$/i.test(f.name)) continue;
      const full = path.join(resolved, f.name);
      const st = await fs.stat(full).catch(() => null);
      const name = f.name.replace(/\.eprj$/i, '');
      const key = name.toLowerCase();
      const latest = st ? { file: f.name, path: full, date: st.mtimeMs, version: null, size: st.size } : null;
      const current = byName.get(key);
      if (current) current.eprj = full;
      else byName.set(key, { name, uuid: null, folders: [], backups: 0, latest, eprj: full });
    }
  }

  const projects = [...byName.values()].sort((a, b) => (b.latest?.date ?? 0) - (a.latest?.date ?? 0));
  return { found: true, dataDir, mode: config.type ?? null, backupDir, projects };
}

// ---------------------------------------------------------------- matching

const STOP = new Set(['diy', 'pcb', 'the', 'a', 'pro', 'project', 'board', 'v1', 'v2', 'v3', 'with', 'built', 'in', 'and', 'de', 'la', 'le']);

function tokens(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP.has(t))
    .map((t) => t.replace(/s$/, ''));
}

/** 0..1 similarity between an EasyEDA project name and a Benchtop project name. */
export function nameScore(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  for (const t of ta) {
    if (tb.has(t)) common++;
    else if ([...tb].some((u) => (u.length > 3 && t.startsWith(u)) || (t.length > 3 && u.startsWith(t)))) common += 0.7;
  }
  return common / Math.max(ta.size, tb.size);
}

export function suggestMatches(
  easyeda: Array<{ name: string }>,
  projects: Array<{ path: string; name: string }>,
  threshold = 0.5,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const e of easyeda) {
    let best: { path: string; score: number } | null = null;
    for (const p of projects) {
      const s = nameScore(e.name, p.name);
      if (s >= threshold && (!best || s > best.score)) best = { path: p.path, score: s };
    }
    out[e.name] = best?.path ?? null;
  }
  return out;
}

// ---------------------------------------------------------------- fabrication files in a project

const FAB_RULES: Array<[FabKind, RegExp]> = [
  ['gerber', /^gerber[_ -].*\.zip$/i],
  ['bom', /^bom[_ -].*\.(csv|xlsx|xls|tsv)$/i],
  ['pnp', /^(pickandplace|pick[_ -]?place|pnp|cpl)[_ -].*\.(csv|xlsx|xls|txt)$/i],
  ['schematic', /^(schematic|sch)[_ -].*\.pdf$/i],
  ['source', /(^(pcb|sch)[_ -].*\.json$)|\.(epro|epro2|eprj)$/i],
  ['step', /^3d[_ -].*\.(step|stp)$/i],
];

/** Words in a file name: "benchport-mainboard-bom-revA.csv" -> benchport, mainboard, bom, reva. */
function words(name: string): Set<string> {
  return new Set(
    name
      .replace(/\.[^.]+$/, '')
      .split(/[^a-zA-Z0-9]+|(?<=[a-z])(?=[A-Z])/)
      .map((w) => w.toLowerCase())
      .filter(Boolean),
  );
}

/**
 * EasyEDA names (Gerber_x.zip, BOM_x.csv…) first, then any naming that has the word in it:
 * KiCad / JLC plugins (bom.csv, positions.csv, project-cpl-revA.csv, project-gerbers.zip).
 */
export function fabKind(name: string): FabKind | null {
  for (const [kind, re] of FAB_RULES) if (re.test(name)) return kind;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const w = words(name);
  const has = (...xs: string[]) => xs.some((x) => w.has(x));
  if (ext === 'zip' && has('gerber', 'gerbers', 'gbr')) return 'gerber';
  if (['csv', 'xlsx', 'xls', 'tsv'].includes(ext) && has('bom')) return 'bom';
  if (['csv', 'xlsx', 'xls', 'txt', 'pos'].includes(ext) && has('cpl', 'pnp', 'positions', 'position', 'pos', 'centroid', 'pickandplace', 'placement'))
    return 'pnp';
  if (ext === 'pdf' && has('schematic', 'schematics', 'sch')) return 'schematic';
  return null;
}

const BACKUP_DIR = /^(backups?|.+[-_ ]backups?)$/i;

export async function findFabFiles(projectPath: string, maxEntries = 4000): Promise<FabFile[]> {
  const out: FabFile[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: projectPath, depth: 0 }];
  let seen = 0;
  while (queue.length && seen < maxEntries) {
    const { dir, depth } = queue.shift()!;
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (++seen > maxEntries) break;
      const lower = e.name.toLowerCase();
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        // KiCad keeps old fab outputs in production/backups/: not the current files.
        if (depth < 5 && !lower.startsWith('.') && !HEAVY_DIRS.has(lower) && !BACKUP_DIR.test(e.name)) queue.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!e.isFile() || HIDDEN_NAMES.has(lower)) continue;
      let kind = fabKind(e.name);
      // A zip named anything (KiCad's mother.zip): look inside.
      if (!kind && lower.endsWith('.zip') && (await isGerberZip(full))) kind = 'gerber';
      if (!kind) continue;
      const st = await fs.stat(full).catch(() => null);
      if (!st) continue;
      out.push({ kind, name: e.name, path: full, relPath: path.relative(projectPath, full), date: st.mtimeMs, size: st.size });
    }
  }
  return out.sort((a, b) => b.date - a.date);
}

const zipCache = new Map<string, { mtime: number; gerber: boolean }>();

async function isGerberZip(file: string): Promise<boolean> {
  const st = await fs.stat(file).catch(() => null);
  if (!st || st.size > 30 * 1024 * 1024) return false;
  const hit = zipCache.get(file);
  if (hit && hit.mtime === st.mtimeMs) return hit.gerber;
  const gerber = await zipInfo(file).then(
    (i) => i.gerber,
    () => false,
  );
  zipCache.set(file, { mtime: st.mtimeMs, gerber });
  return gerber;
}

/** Copy a backup into <project>/pcb/easyeda/ (never overwrites). */
export async function copyBackup(backupPath: string, projectPath: string): Promise<string> {
  const destDir = path.join(projectPath, 'pcb', 'easyeda');
  await fs.mkdir(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(backupPath));
  if (await exists(dest)) throw new Error(`${path.relative(projectPath, dest)} is already there.`);
  await fs.copyFile(backupPath, dest);
  return dest;
}
