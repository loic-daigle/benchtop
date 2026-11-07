/**
 * Releases: one folder per board order under releases/, each with a small release.yaml
 * (date, board revision, order number, link, note, and the firmware commit that goes with it).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { HEAVY_DIRS } from '../shared/fileKinds';
import {
  RELEASE_STATUSES,
  type FabFile,
  type FabKind,
  type FirmwareState,
  type NewReleaseInput,
  type Release,
  type ReleaseFile,
  type ReleaseFirmware,
  type ReleaseInfo,
  type ReleasesResult,
} from '../shared/types';
import { fabKind, findFabFiles } from './easyeda';
import { git } from './git';
import { isInside } from './scanner';

export const RELEASE_FILE = 'release.yaml';
const HEADER = ' Benchtop release info. Edit here or in Benchtop (Releases tab).\n status: planned | ordered | received | assembled | retired';

const DATE_RE = /^(\d{4}-\d{2}-\d{2})/;

const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

export function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The project's releases folder name if it exists (releases, Releases, release…). */
export async function releasesDirName(projectPath: string): Promise<string | null> {
  const entries = await fs.readdir(projectPath, { withFileTypes: true }).catch(() => []);
  const hit = entries.find((e) => e.isDirectory() && /^releases?$/i.test(e.name));
  return hit?.name ?? null;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

export function normalizeInfo(raw: unknown, fallbackDate: string): ReleaseInfo {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  let date = o.date instanceof Date ? today(o.date) : str(o.date);
  if (!DATE_RE.test(date)) date = fallbackDate;
  const status = str(o.status).toLowerCase();
  const fw = o.firmware && typeof o.firmware === 'object' ? (o.firmware as Record<string, unknown>) : null;
  return {
    date: date.slice(0, 10),
    board: str(o.board),
    status: (RELEASE_STATUSES as readonly string[]).includes(status) ? (status as ReleaseInfo['status']) : '',
    order: str(o.order),
    link: str(o.link),
    note: typeof o.note === 'string' ? o.note.replace(/\s+$/, '') : '',
    firmware:
      fw && str(fw.commit)
        ? {
            commit: str(fw.commit),
            branch: str(fw.branch) || null,
            repo: str(fw.repo),
            dirty: fw.dirty === true,
            subject: str(fw.subject) || null,
          }
        : null,
  };
}

async function readInfo(dir: string, fallbackDate: string): Promise<{ info: ReleaseInfo; hasInfo: boolean; error: string | null }> {
  let text: string;
  try {
    text = await fs.readFile(path.join(dir, RELEASE_FILE), 'utf8');
  } catch {
    return { info: normalizeInfo({}, fallbackDate), hasInfo: false, error: null };
  }
  try {
    return { info: normalizeInfo(YAML.parse(text), fallbackDate), hasInfo: true, error: null };
  } catch (err) {
    return { info: normalizeInfo({}, fallbackDate), hasInfo: true, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Writes release.yaml, keeping comments and any keys Benchtop doesn't know about. */
export async function writeInfo(dir: string, info: ReleaseInfo): Promise<void> {
  const file = path.join(dir, RELEASE_FILE);
  let doc: YAML.Document;
  try {
    doc = YAML.parseDocument(await fs.readFile(file, 'utf8'));
    if (doc.errors.length || !YAML.isMap(doc.contents)) throw new Error('rewrite');
  } catch {
    doc = new YAML.Document({});
    doc.commentBefore = HEADER;
  }
  const set = (key: string, value: unknown, keep = false) => {
    if (value === '' || value === null || value === undefined) {
      if (!keep) doc.delete(key);
      else doc.set(key, null);
    } else doc.set(key, value);
  };
  set('date', info.date);
  set('board', info.board, true);
  set('status', info.status, true);
  set('order', info.order, true);
  set('link', info.link, true);
  if (info.note) {
    const node = doc.createNode(info.note);
    if (info.note.includes('\n')) (node as YAML.Scalar).type = 'BLOCK_LITERAL';
    doc.set('note', node);
  } else set('note', '', true);
  if (info.firmware) {
    const fw: Record<string, unknown> = { commit: info.firmware.commit };
    if (info.firmware.branch) fw.branch = info.firmware.branch;
    if (info.firmware.repo) fw.repo = info.firmware.repo;
    if (info.firmware.subject) fw.subject = info.firmware.subject;
    if (info.firmware.dirty) fw.dirty = true;
    doc.set('firmware', fw);
  } else doc.delete('firmware');
  await fs.writeFile(file, doc.toString({ lineWidth: 0, nullStr: '' }), 'utf8');
}

async function listFiles(projectPath: string, dir: string, depth = 0, out: ReleaseFile[] = []): Promise<ReleaseFile[]> {
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth < 2 && !e.name.startsWith('.') && !HEAVY_DIRS.has(e.name.toLowerCase())) await listFiles(projectPath, full, depth + 1, out);
      continue;
    }
    if (!e.isFile() || e.name === RELEASE_FILE || e.name.startsWith('.') || /^(desktop\.ini|thumbs\.db)$/i.test(e.name)) continue;
    const st = await fs.stat(full).catch(() => null);
    out.push({
      name: e.name,
      path: full,
      relPath: path.relative(projectPath, full).split(path.sep).join('/'),
      kind: fabKind(e.name),
      size: st?.size ?? 0,
    });
  }
  return out;
}

export async function listReleases(projectPath: string): Promise<Release[]> {
  const dirName = await releasesDirName(projectPath);
  if (!dirName) return [];
  const root = path.join(projectPath, dirName);
  const out: Release[] = [];
  for (const e of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const dir = path.join(root, e.name);
    const st = await fs.stat(dir);
    const fallback = DATE_RE.exec(e.name)?.[1] ?? today(st.birthtimeMs ? new Date(Math.min(st.birthtimeMs, st.mtimeMs)) : st.mtime);
    const { info, hasInfo, error } = await readInfo(dir, fallback);
    out.push({
      name: e.name,
      path: dir,
      relDir: `${dirName}/${e.name}`,
      info,
      hasInfo,
      infoError: error,
      files: (await listFiles(projectPath, dir)).sort((a, b) => a.relPath.localeCompare(b.relPath)),
    });
  }
  // Newest first; same date: by folder name (2026-11-06-2 after 2026-11-06).
  return out.sort((a, b) => b.info.date.localeCompare(a.info.date) || b.name.localeCompare(a.name, undefined, { numeric: true }));
}

// ---------------------------------------------------------------- firmware

/** Where the firmware's git history is: the project itself, or a repository inside it (prefers firmware/). */
export async function findFirmwareRepo(projectPath: string): Promise<string | null> {
  if (await exists(path.join(projectPath, '.git'))) return '';
  const found: string[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: projectPath, depth: 0 }];
  while (queue.length && found.length < 10) {
    const { dir, depth } = queue.shift()!;
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory() || e.name.startsWith('.') || HEAVY_DIRS.has(e.name.toLowerCase())) continue;
      const full = path.join(dir, e.name);
      if (await exists(path.join(full, '.git'))) found.push(path.relative(projectPath, full).split(path.sep).join('/'));
      else if (depth < 2) queue.push({ dir: full, depth: depth + 1 });
    }
  }
  if (!found.length) return null;
  return found.find((f) => /firmware|fw|code|src/i.test(f)) ?? found[0];
}

async function head(repoDir: string): Promise<{ commit: string; branch: string | null; subject: string | null; dirty: boolean } | null> {
  const commit = (await git(repoDir, ['rev-parse', 'HEAD']))?.trim();
  if (!commit) return null;
  const branch = (await git(repoDir, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim() || null;
  const subject = (await git(repoDir, ['log', '-1', '--format=%s']))?.trim() || null;
  const status = await git(repoDir, ['status', '--porcelain', '--untracked-files=no']);
  return { commit, branch: branch === 'HEAD' ? null : branch, subject, dirty: !!status?.trim() };
}

export async function firmwareSnapshot(projectPath: string): Promise<ReleaseFirmware | null> {
  const repo = await findFirmwareRepo(projectPath);
  if (repo === null) return null;
  const h = await head(path.join(projectPath, repo));
  if (!h) return null;
  return { commit: h.commit.slice(0, 12), branch: h.branch, repo, dirty: h.dirty, subject: h.subject };
}

/** Commits from `from` to HEAD, or null if `from` isn't in HEAD's history. */
async function commitsSince(repoDir: string, from: string): Promise<number | null> {
  const isAncestor = await git(repoDir, ['merge-base', '--is-ancestor', from, 'HEAD']);
  if (isAncestor === null) return null; // not an ancestor, or unknown commit
  const n = await git(repoDir, ['rev-list', '--count', `${from}..HEAD`]);
  return n === null ? null : Number(n.trim());
}

export async function firmwareState(projectPath: string, releases: Release[]): Promise<FirmwareState> {
  const repo = await findFirmwareRepo(projectPath);
  const empty: FirmwareState = { repo, head: null, branch: null, subject: null, dirty: false, match: null, since: {} };
  if (repo === null) return empty;
  const h = await head(path.join(projectPath, repo));
  if (!h) return empty;
  const since: Record<string, number | null> = {};
  let match: FirmwareState['match'] = null;
  for (const r of releases) {
    const fw = r.info.firmware;
    if (!fw) continue;
    const repoDir = path.join(projectPath, fw.repo || repo);
    const n = h.commit.startsWith(fw.commit) && (fw.repo || repo) === repo ? 0 : await commitsSince(repoDir, fw.commit);
    since[r.name] = n;
    if (n !== null && (!match || n < match.commitsSince)) match = { release: r.name, commitsSince: n };
  }
  return { repo, head: h.commit.slice(0, 12), branch: h.branch, subject: h.subject, dirty: h.dirty, match, since };
}

// ---------------------------------------------------------------- create / edit

export function latestFab(files: FabFile[]): Partial<Record<FabKind, FabFile>> {
  const out: Partial<Record<FabKind, FabFile>> = {};
  for (const f of files) {
    if (/(^|[\\/])releases?[\\/]/i.test(f.relPath)) continue; // only working files
    if (!out[f.kind] || f.date > out[f.kind]!.date) out[f.kind] = f;
  }
  return out;
}

export async function getReleases(projectPath: string): Promise<ReleasesResult> {
  const releases = await listReleases(projectPath);
  const [firmware, fab] = await Promise.all([firmwareState(projectPath, releases), findFabFiles(projectPath)]);
  return { releases, firmware, latestFab: latestFab(fab) };
}

export function safeFolderName(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/^[. ]+|[. ]+$/g, '')
      .slice(0, 80) || today()
  );
}

/** A free folder: releases/<name>, then <name>-2, <name>-3 … */
export async function freeReleaseDir(projectPath: string, name: string): Promise<{ abs: string; rel: string }> {
  const dirName = (await releasesDirName(projectPath)) ?? 'releases';
  const base = safeFolderName(name);
  let folder = base;
  for (let i = 2; await exists(path.join(projectPath, dirName, folder)); i++) folder = `${base}-${i}`;
  return { abs: path.join(projectPath, dirName, folder), rel: `${dirName}/${folder}` };
}

async function copyNoOverwrite(src: string, destDir: string): Promise<string> {
  const ext = path.extname(src);
  const stem = path.basename(src, ext);
  let name = path.basename(src);
  for (let i = 2; await exists(path.join(destDir, name)); i++) name = `${stem}_${i}${ext}`;
  await fs.copyFile(src, path.join(destDir, name), fs.constants?.COPYFILE_EXCL ?? 1);
  return name;
}

export async function createRelease(projectPath: string, input: NewReleaseInput): Promise<Release> {
  const { abs } = await freeReleaseDir(projectPath, input.name || today());
  await fs.mkdir(abs, { recursive: true });
  if (input.copyKinds.length) {
    const latest = latestFab(await findFabFiles(projectPath));
    for (const kind of input.copyKinds) {
      const f = latest[kind];
      if (f && isInside(projectPath, f.path)) await copyNoOverwrite(f.path, abs);
    }
  }
  const info: ReleaseInfo = {
    ...input.info,
    date: DATE_RE.test(input.info.date) ? input.info.date : today(),
    firmware: input.recordFirmware ? await firmwareSnapshot(projectPath) : null,
  };
  await writeInfo(abs, info);
  const all = await listReleases(projectPath);
  return all.find((r) => r.path === abs)!;
}

/** Called after EasyEDA exported into releases/<date>/: start its release.yaml. */
export async function initRelease(projectPath: string, dir: string, extra: Partial<ReleaseInfo> = {}): Promise<void> {
  if (await exists(path.join(dir, RELEASE_FILE))) return;
  const name = path.basename(dir);
  await writeInfo(dir, {
    date: DATE_RE.exec(name)?.[1] ?? today(),
    board: '',
    status: 'planned',
    order: '',
    link: '',
    note: '',
    firmware: await firmwareSnapshot(projectPath),
    ...extra,
  });
}

export async function saveRelease(projectPath: string, relDir: string, info: ReleaseInfo): Promise<void> {
  const dir = path.join(projectPath, relDir);
  if (!isInside(projectPath, dir) || !/^releases?\//i.test(relDir.replace(/\\/g, '/'))) throw new Error('Not a release folder');
  await writeInfo(dir, normalizeInfo(info, today()));
}

export async function snapshotInto(projectPath: string, relDir: string): Promise<ReleaseFirmware | null> {
  const dir = path.join(projectPath, relDir);
  if (!isInside(projectPath, dir) || !/^releases?\//i.test(relDir.replace(/\\/g, '/'))) throw new Error('Not a release folder');
  const fw = await firmwareSnapshot(projectPath);
  const { info } = await readInfo(dir, today());
  await writeInfo(dir, { ...info, firmware: fw });
  return fw;
}
