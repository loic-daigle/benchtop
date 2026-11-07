/**
 * File system access for Benchtop. Read-only, except for project.yaml / NOTES.md
 * which are written by meta.ts / store.ts on explicit user edits.
 * Kept free of Electron imports so it can be unit-tested with plain Node.
 */
import { promises as fs, type Dirent } from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { HEAVY_DIRS, HIDDEN_NAMES, categorize, isLikelyText, isPreviewableImage } from '../shared/fileKinds';
import type { CategoryCounts, DirEntry, ProjectSummary, SearchFileResult, SearchResponse, TextResult } from '../shared/types';
import { getGitInfo } from './git';
import { META_FILE, NOTES_FILE, readMeta } from './meta';

const SCAN_MAX_DEPTH = 4;
const SCAN_MAX_ENTRIES = 5000;
const TEXT_MAX_BYTES = 2 * 1024 * 1024;
const THUMB_NAME = /(cover|thumb|thumbnail|hero|preview|logo|banner|render)/i;
const THUMB_DIRS = /^(images?|img|docs?|media|photos?|renders?|assets)$/i;
/** Files that mark a folder as "a project" (used to detect group folders). */
const PROJECT_MARKER = /^(readme(\..+)?|package\.json|platformio\.ini|cmakelists\.txt|cargo\.toml|pyproject\.toml|setup\.py|project\.yaml|manifest\.json|.+\.ino|.+\.kicad_pro|.+\.sln|.+\.csproj)$/i;

/** True when `target` is `root` itself or inside it. Guards every IPC call. */
export function isInside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function emptyCounts(): CategoryCounts {
  return { code: 0, pcb: 0, cad: 0, image: 0, doc: 0, media: 0, archive: 0, other: 0 };
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readDirSafe(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Run `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** First real paragraph of a README, stripped of markdown, max ~200 chars. */
export function extractDescription(markdown: string): string | null {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let inFence = false;
  const para: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const isNoise =
      line === '' ||
      line.startsWith('#') ||
      line.startsWith('<') ||
      line.startsWith('![') ||
      line.startsWith('[![') ||
      line.startsWith('|') ||
      line.startsWith('---') ||
      /^\[.*\]:/.test(line);
    if (isNoise) {
      if (para.length) break;
      continue;
    }
    para.push(line);
  }
  if (!para.length) return null;
  const text = para
    .join(' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > 200 ? `${text.slice(0, 197).trimEnd()}…` : text;
}

interface ThumbCandidate {
  path: string;
  score: number;
}

function thumbScore(name: string, depth: number, parentName: string): number {
  const lower = name.toLowerCase();
  if (lower.endsWith('.ico')) return -1;
  let score = 10 - depth * 2;
  if (THUMB_NAME.test(name)) score += 10;
  if (THUMB_DIRS.test(parentName)) score += 3;
  if (/^(tests?|fixtures?|icons?)$/i.test(parentName)) score -= 6;
  if (lower.endsWith('.bmp')) score -= 4;
  return score;
}

export interface ScanResult {
  summary: ProjectSummary;
  /** Relative paths of the files seen (for quick-find). */
  files: string[];
}

export async function summarizeProject(projectPath: string, group: string | null = null): Promise<ScanResult> {
  const name = path.basename(projectPath);
  const counts = emptyCounts();
  const files: string[] = [];
  let modified = 0;
  let seen = 0;
  let partial = false;
  let readmePath: string | null = null;
  let notesPath: string | null = null;
  let containsGitRepo = false;
  let best: ThumbCandidate | null = null;

  const isGitRepo = await exists(path.join(projectPath, '.git'));

  // Breadth-first so shallow files (README, cover images) are always seen first.
  const queue: Array<{ dir: string; depth: number }> = [{ dir: projectPath, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift()!;
    const entries = await readDirSafe(dir);
    for (const entry of entries) {
      if (++seen > SCAN_MAX_ENTRIES) {
        partial = true;
        queue.length = 0;
        break;
      }
      const lower = entry.name.toLowerCase();
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (lower === '.git') {
          if (depth > 0) containsGitRepo = true;
          continue;
        }
        if (HEAVY_DIRS.has(lower) || lower.startsWith('.')) continue;
        if (depth + 1 <= SCAN_MAX_DEPTH) queue.push({ dir: full, depth: depth + 1 });
        else partial = true;
        continue;
      }
      if (!entry.isFile() || HIDDEN_NAMES.has(lower)) continue;

      files.push(path.relative(projectPath, full));
      counts[categorize(entry.name)]++;
      if (depth === 0) {
        if (!readmePath && /^readme(\.(md|markdown|txt))?$/i.test(entry.name)) readmePath = full;
        if (entry.name === NOTES_FILE) notesPath = full;
      }
      try {
        const st = await fs.stat(full);
        if (st.mtimeMs > modified) modified = st.mtimeMs;
        if (depth <= 2 && isPreviewableImage(entry.name) && st.size < 15 * 1024 * 1024) {
          const score = thumbScore(entry.name, depth, path.basename(dir));
          if (score >= 0 && (!best || score > best.score)) best = { path: full, score };
        }
      } catch {
        /* unreadable file: skip */
      }
    }
  }

  if (!modified) {
    try {
      modified = (await fs.stat(projectPath)).mtimeMs;
    } catch {
      /* ignore */
    }
  }

  const { meta, error: metaError } = await readMeta(projectPath);

  let description: string | null = meta.description ?? null;
  if (!description && readmePath) {
    try {
      const handle = await fs.open(readmePath, 'r');
      try {
        const buf = Buffer.alloc(16 * 1024);
        const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
        description = extractDescription(buf.subarray(0, bytesRead).toString('utf8'));
      } finally {
        await handle.close();
      }
    } catch {
      /* ignore */
    }
  }

  let thumbnailPath = (best as ThumbCandidate | null)?.path ?? null;
  if (meta.cover) {
    const cover = path.resolve(projectPath, meta.cover);
    if (isInside(projectPath, cover) && (await exists(cover))) thumbnailPath = cover;
  }

  const git = isGitRepo ? await getGitInfo(projectPath) : null;

  return {
    summary: {
      name,
      path: projectPath,
      group,
      modified,
      description,
      readmePath,
      notesPath,
      thumbnailPath,
      meta,
      metaError,
      isGitRepo,
      containsGitRepo,
      git,
      counts,
      fileCount: files.length,
      partial,
    },
    files,
  };
}

/** A folder looks like a project if it has a marker file or is a git repo. */
async function looksLikeProject(dir: string): Promise<boolean> {
  const entries = await readDirSafe(dir);
  return entries.some((e) => (e.isDirectory() && e.name === '.git') || (e.isFile() && PROJECT_MARKER.test(e.name)));
}

/**
 * A "group" is a plain container of several projects (like Software/).
 * It is never a git repo, has no README/project.yaml of its own, and most of
 * its sub-folders look like projects.
 */
export async function groupChildren(dir: string): Promise<string[] | null> {
  const entries = await readDirSafe(dir);
  const subFolders = () =>
    entries
      .filter((e) => e.isDirectory() && !/^[._]/.test(e.name) && !HEAVY_DIRS.has(e.name.toLowerCase()))
      .map((e) => path.join(dir, e.name));
  // Explicit choice in project.yaml wins over guessing.
  if (entries.some((e) => e.isFile() && e.name === META_FILE)) {
    const { meta } = await readMeta(dir);
    return meta.group ? subFolders() : null;
  }
  const ownMarker = entries.some(
    (e) => (e.isDirectory() && e.name === '.git') || (e.isFile() && (/^readme/i.test(e.name) || e.name === META_FILE)),
  );
  if (ownMarker) return null;
  // A container has (almost) no loose files of its own — a project folder with
  // STLs, sketches and sub-folders is still one project.
  const ownFiles = entries.filter((e) => e.isFile() && !e.name.startsWith('.') && !HIDDEN_NAMES.has(e.name.toLowerCase()));
  if (ownFiles.length > 4) return null;
  const children = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !HEAVY_DIRS.has(e.name.toLowerCase()))
    .map((e) => path.join(dir, e.name));
  if (children.length < 3) return null;
  const marks = await Promise.all(children.map(looksLikeProject));
  const projectLike = marks.filter(Boolean).length;
  return projectLike >= 3 && projectLike >= Math.ceil(children.length / 2) ? children : null;
}

export interface ProjectLocation {
  path: string;
  group: string | null;
}

/** Top-level folders of the root; group folders are expanded into their children. */
export async function discoverProjects(root: string): Promise<ProjectLocation[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !HIDDEN_NAMES.has(e.name.toLowerCase()))
    .map((e) => path.join(root, e.name));
  const out: ProjectLocation[] = [];
  for (const dir of dirs) {
    const children = await groupChildren(dir);
    if (children) children.forEach((c) => out.push({ path: c, group: path.basename(dir) }));
    else out.push({ path: dir, group: null });
  }
  return out;
}

export async function scanAll(root: string): Promise<ScanResult[]> {
  const locations = await discoverProjects(root);
  return mapLimit(locations, 6, (loc) => summarizeProject(loc.path, loc.group));
}

/** Convenience used by tests / scripts. */
export async function listProjects(root: string): Promise<ProjectSummary[]> {
  return (await scanAll(root)).map((r) => r.summary);
}

export async function listDir(dirPath: string): Promise<DirEntry[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    // A folder that was open in the tree and has since been deleted or renamed: just show nothing.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const visible = entries.filter((e) => !HIDDEN_NAMES.has(e.name.toLowerCase()));
  const result = await mapLimit(visible, 16, async (entry): Promise<DirEntry> => {
    const full = path.join(dirPath, entry.name);
    let size = 0;
    let modified = 0;
    let isDir = entry.isDirectory();
    try {
      const st = await fs.stat(full); // follows symlinks
      size = st.isFile() ? st.size : 0;
      modified = st.mtimeMs;
      isDir = st.isDirectory();
    } catch {
      /* broken link or no permission */
    }
    return {
      name: entry.name,
      path: full,
      isDir,
      size,
      modified,
      heavy: isDir && HEAVY_DIRS.has(entry.name.toLowerCase()),
    };
  });
  return result.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}

/**
 * Decode text: UTF-16 (with BOM — EasyEDA BOM exports use it), UTF-8,
 * else Windows-1252 for older French text files.
 */
export function decodeText(buf: Buffer): { text: string; encoding: string } {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(buf.subarray(2)), encoding: 'UTF-16 LE' };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(buf.subarray(2)), encoding: 'UTF-16 BE' };
  }
  const body = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(body), encoding: 'UTF-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(body), encoding: 'Windows-1252' };
  }
}

function isUtf16Bom(buf: Buffer): boolean {
  return buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff));
}

export async function readText(filePath: string, maxBytes = TEXT_MAX_BYTES): Promise<TextResult> {
  try {
    const handle = await fs.open(filePath, 'r');
    try {
      const { size } = await handle.stat();
      const length = Math.min(size, maxBytes);
      const buf = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buf, 0, length, 0);
      let data = buf.subarray(0, bytesRead);
      const utf16 = isUtf16Bom(data);
      if (!utf16 && data.subarray(0, 8000).includes(0)) return { kind: 'binary' };
      if (size > maxBytes) {
        if (utf16) {
          data = data.subarray(0, data.length - (data.length % 2));
        } else {
          // Don't cut a UTF-8 character in half.
          let end = data.length;
          while (end > 0 && (data[end - 1] & 0xc0) === 0x80) end--;
          if (end > 0 && data[end - 1] >= 0xc0) end--;
          data = data.subarray(0, end);
        }
      }
      const { text, encoding } = decodeText(data);
      return { kind: 'text', content: text, truncated: size > maxBytes, encoding };
    } finally {
      await handle.close();
    }
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export interface SearchOptions {
  caseSensitive?: boolean;
  maxResults?: number;
  maxFileBytes?: number;
  isCancelled?: () => boolean;
}

/** Full-text search across projects. Skips binaries, dependencies and big files. */
export async function searchProjects(
  projects: Array<{ path: string; name: string }>,
  query: string,
  opts: SearchOptions = {},
): Promise<SearchResponse> {
  const maxResults = opts.maxResults ?? 500;
  const maxFileBytes = opts.maxFileBytes ?? 1024 * 1024;
  const needle = opts.caseSensitive ? query : query.toLowerCase();
  const results: SearchFileResult[] = [];
  let total = 0;
  let filesSearched = 0;
  let truncated = false;

  for (const project of projects) {
    const queue: string[] = [project.path];
    while (queue.length) {
      if (opts.isCancelled?.()) return { results, filesSearched, truncated, cancelled: true };
      const dir = queue.shift()!;
      for (const entry of await readDirSafe(dir)) {
        const lower = entry.name.toLowerCase();
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!lower.startsWith('.') && !HEAVY_DIRS.has(lower)) queue.push(full);
          continue;
        }
        if (!entry.isFile() || HIDDEN_NAMES.has(lower)) continue;
        const cat = categorize(entry.name);
        if (!isLikelyText(entry.name) && cat !== 'other') continue;
        let size = 0;
        try {
          size = (await fs.stat(full)).size;
        } catch {
          continue;
        }
        if (size > maxFileBytes || size === 0) continue;
        const read = await readText(full, maxFileBytes);
        if (read.kind !== 'text') continue;
        filesSearched++;
        const matches = [];
        const lines = read.content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const hay = opts.caseSensitive ? lines[i] : lines[i].toLowerCase();
          const col = hay.indexOf(needle);
          if (col === -1) continue;
          const raw = lines[i];
          // Trim very long lines around the match.
          const start = Math.max(0, col - 60);
          const text = (start > 0 ? '…' : '') + raw.slice(start, col + needle.length + 120);
          matches.push({ line: i + 1, text, col: col - start + (start > 0 ? 1 : 0) });
          if (++total >= maxResults) break;
        }
        if (matches.length) {
          results.push({
            projectPath: project.path,
            projectName: project.name,
            path: full,
            relPath: path.relative(project.path, full),
            matches,
          });
        }
        if (total >= maxResults) {
          truncated = true;
          return { results, filesSearched, truncated, cancelled: false };
        }
      }
    }
  }
  return { results, filesSearched, truncated, cancelled: false };
}
