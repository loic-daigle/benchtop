/**
 * Standard project layout: create new projects from a template, and propose /
 * apply moves that bring an existing project into the same layout.
 * Moves only — nothing is ever deleted (undo removes only folders it created, if empty).
 */
import { promises as fs, type Dirent } from 'node:fs';
import path from 'node:path';
import { HEAVY_DIRS, categorize, extOf } from '../shared/fileKinds';
import type { ApplyResult, MoveItem, NewProjectInput, ProjectKind, StructurePlan } from '../shared/types';
import { writeMeta } from './meta';

export const STANDARD_DIRS: Record<ProjectKind, string[]> = {
  hardware: ['firmware', 'pcb', 'mechanical', 'docs/images', 'releases'],
  firmware: ['firmware', 'docs/images', 'releases'],
  software: ['src', 'docs'],
};

const GITIGNORE = `# Build output
.pio/
build/
out/
dist/
.vite/
node_modules/
managed_components/
__pycache__/
*.log

# Secrets — keep WiFi passwords / API keys in this file, never commit it
secrets.h
.env

# Benchtop project and release info (local only)
project.yaml
**/[Rr]eleases/*/release.yaml

# Backups and OS files
*.bak
*~
Thumbs.db
desktop.ini
.DS_Store
`;

const GITATTRIBUTES = `# Large CAD files are stored with Git LFS (https://git-lfs.com)
*.step filter=lfs diff=lfs merge=lfs -text
*.stp filter=lfs diff=lfs merge=lfs -text
*.stl filter=lfs diff=lfs merge=lfs -text
*.3mf filter=lfs diff=lfs merge=lfs -text
*.f3d filter=lfs diff=lfs merge=lfs -text
*.f3z filter=lfs diff=lfs merge=lfs -text
`;

export { GITIGNORE, GITATTRIBUTES };

const FOLDER_HELP: Record<string, string> = {
  firmware: 'Microcontroller code (Arduino / PlatformIO / ESP-IDF)',
  pcb: 'EasyEDA / KiCad export, schematic PDF, BOM, Gerbers',
  mechanical: 'Fusion 360, STEP, STL / 3MF for printing',
  'docs/images': 'Photos and renders (the first one becomes the cover)',
  docs: 'Notes, datasheets, documentation',
  releases: 'Compiled firmware and files sent to the fab',
  src: 'Source code',
};

function readme(input: NewProjectInput): string {
  const dirs = STANDARD_DIRS[input.kind];
  const rows = dirs.map((d) => `| \`${d}/\` | ${FOLDER_HELP[d] ?? ''} |`).join('\n');
  return `# ${input.name}

${input.description?.trim() || 'Short description of the project.'}

## Folder layout

| Folder | What goes there |
|---|---|
${rows}

## Notes

Progress notes and to-dos live in \`NOTES.md\` (Benchtop → Notes tab).
`;
}

/** "Smart Dial (v2)!" -> "smart-dial-v2" */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

const INVALID_NAME = /[<>:"/\\|?*\u0000-\u001f]|^\.+$|[. ]$/;

export async function createProject(input: NewProjectInput): Promise<string> {
  const folder = input.folderName.trim();
  if (!folder || INVALID_NAME.test(folder)) throw new Error('That folder name can’t be used.');
  const dir = path.join(input.parentDir, folder);
  try {
    await fs.access(dir);
    throw new Error(`A folder named “${folder}” already exists.`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  await fs.mkdir(dir);
  for (const sub of STANDARD_DIRS[input.kind]) {
    await fs.mkdir(path.join(dir, sub), { recursive: true });
    // Empty folders are not kept by git; a .gitkeep keeps the layout.
    await fs.writeFile(path.join(dir, sub, '.gitkeep'), '');
  }
  await fs.writeFile(path.join(dir, 'README.md'), readme(input), 'utf8');
  await fs.writeFile(path.join(dir, '.gitignore'), GITIGNORE, 'utf8');
  if (input.kind !== 'software') await fs.writeFile(path.join(dir, '.gitattributes'), GITATTRIBUTES, 'utf8');
  await writeMeta(dir, {
    status: input.status ?? 'idea',
    description: input.description,
    tags: input.tags,
  });
  return dir;
}

// ---------------------------------------------------------------------------
// Making an existing project consistent

/** Folder names that clearly mean one standard folder. */
const DIR_ALIASES: Array<[RegExp, string]> = [
  [/^(code|codes|firmware|arduino|sketch(es)?|programme?s?|esp32|esp8266|attiny|stm32)$/i, 'firmware'],
  [/^(pcbs?|electronics?|schematics?|gerbers?|easyeda|kicad|circuit)$/i, 'pcb'],
  [/^(3d|3d[ _-]?files|3d[ _-]?models?|pi[eè]ces?[ _-]?3d|cad|stl|stls|step|enclosure|case|boitier|bo[iî]tier|mechanical|meca|print(s|ed)?)$/i, 'mechanical'],
  [/^(images?|imgs?|photos?|pictures?|renders?|images[_ -]\w+|media|screenshots?)$/i, 'docs/images'],
  [/^(docs?|documentation|datasheets?|notes)$/i, 'docs'],
  [/^(releases?|bin|binaries|exports?)$/i, 'releases'],
];

const KEEP_FILES = /^(readme(\..+)?|license(\..+)?|licence(\..+)?|changelog(\..+)?|project\.yaml|notes\.md|\.gitignore|\.gitattributes|\.gitmodules|desktop\.ini|thumbs\.db|\.ds_store)$/i;
const SOFTWARE_MARKERS = /^(package\.json|cargo\.toml|pyproject\.toml|setup\.py|go\.mod|.+\.sln|.+\.csproj|pubspec\.yaml|forge\.config\.(js|ts))$/i;
const FIRMWARE_ROOT_MARKERS = /^(platformio\.ini|cmakelists\.txt|sdkconfig(\..+)?|partitions\.csv|dependencies\.lock)$/i;
const BINARY_RELEASE = new Set(['bin', 'hex', 'uf2', 'elf']);

async function readDir(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Where a loose file should live, or null to leave it. */
export function targetForFile(name: string): string | null {
  const ext = extOf(name);
  if (BINARY_RELEASE.has(ext)) return 'releases';
  if (ext === 'ino') return `firmware/${name.slice(0, -4)}`; // Arduino wants Sketch/Sketch.ino
  switch (categorize(name)) {
    case 'code':
      return 'firmware';
    case 'pcb':
      return 'pcb';
    case 'cad':
      return 'mechanical';
    case 'image':
      return 'docs/images';
    case 'doc':
      return 'docs';
    case 'media':
      return 'docs/media';
    default:
      return null;
  }
}

/** Dominant category of a folder's files (≥ 70%), sampled. */
async function dominantCategory(dir: string): Promise<string | null> {
  const counts = new Map<string, number>();
  let total = 0;
  const queue: Array<{ d: string; depth: number }> = [{ d: dir, depth: 0 }];
  while (queue.length && total < 300) {
    const { d, depth } = queue.shift()!;
    for (const e of await readDir(d)) {
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && !HEAVY_DIRS.has(e.name.toLowerCase()) && depth < 3) {
          queue.push({ d: path.join(d, e.name), depth: depth + 1 });
        }
      } else if (e.isFile()) {
        const t = targetForFile(e.name);
        const key = t?.startsWith('firmware') ? 'firmware' : (t ?? 'other');
        counts.set(key, (counts.get(key) ?? 0) + 1);
        total++;
      }
    }
  }
  if (!total) return null;
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of counts) if (n > bestN) [best, bestN] = [k, n];
  return best && best !== 'other' && bestN / total >= 0.7 ? best : null;
}

export async function detectKind(projectPath: string): Promise<ProjectKind | 'unknown'> {
  const entries = await readDir(projectPath);
  if (entries.some((e) => e.isFile() && SOFTWARE_MARKERS.test(e.name))) return 'software';
  if (entries.some((e) => e.isFile() && FIRMWARE_ROOT_MARKERS.test(e.name))) return 'firmware';
  return 'unknown';
}

export async function planStructure(projectPath: string): Promise<StructurePlan> {
  const kind = await detectKind(projectPath);
  const plan: StructurePlan = { projectPath, kind, moves: [], kept: [], warnings: [] };
  const entries = await readDir(projectPath);

  if (kind === 'software') {
    plan.warnings.push('This looks like a software project (package.json, .sln…). Its layout is set by its tools, so nothing is moved.');
    return plan;
  }
  if (kind === 'firmware') {
    plan.warnings.push('PlatformIO / ESP-IDF / CMake files are at the root, so this is a firmware project. Its build files stay where they are.');
  }
  if (entries.some((e) => e.isDirectory() && e.name === '.git')) {
    plan.warnings.push('This project is a git repository. After moving, commit the changes so git records them as renames.');
  }

  // Paths that exist (on disk or because of an earlier planned move).
  const taken = new Set<string>();
  for (const e of entries) taken.add(e.name.toLowerCase());
  const isTaken = async (rel: string) => taken.has(rel.toLowerCase()) || (await exists(path.join(projectPath, rel)));
  const standard = new Set(['firmware', 'pcb', 'mechanical', 'docs', 'releases', 'src']);

  const dirMoves: MoveItem[] = [];
  const fileMoves: MoveItem[] = [];

  const add = async (list: MoveItem[], name: string, isDir: boolean, targetDir: string, reason: string, renameTo?: string) => {
    const rel = renameTo ? targetDir : `${targetDir}/${name}`;
    if (await isTaken(rel)) {
      plan.kept.push({ path: path.join(projectPath, name), reason: `${rel}/ already exists` });
      return;
    }
    taken.add(rel.toLowerCase());
    if (renameTo) taken.delete(name.toLowerCase());
    // Parents of the target become "taken" too (they will be created).
    const parts = rel.split('/');
    for (let i = 1; i < parts.length; i++) taken.add(parts.slice(0, i).join('/').toLowerCase());
    list.push({ from: path.join(projectPath, name), to: path.join(projectPath, ...rel.split('/')), isDir, reason });
  };

  // Folders first: renames like "3D Files" -> "mechanical".
  for (const e of entries.filter((x) => x.isDirectory())) {
    const lower = e.name.toLowerCase();
    if (e.name.startsWith('.')) continue;
    if (standard.has(lower)) {
      // "PCB" -> "pcb": same folder, just consistent lowercase naming.
      if (e.name !== lower) {
        plan.moves.push({
          from: path.join(projectPath, e.name),
          to: path.join(projectPath, lower),
          isDir: true,
          reason: `rename to lowercase “${lower}”`,
        });
      }
      continue;
    }
    if (HEAVY_DIRS.has(lower)) {
      plan.kept.push({ path: path.join(projectPath, e.name), reason: 'build / dependency folder' });
      continue;
    }
    const full = path.join(projectPath, e.name);
    if (await exists(path.join(full, '.git'))) {
      plan.kept.push({ path: full, reason: 'separate git repository (maybe someone else’s code) — move it yourself if you want' });
      continue;
    }
    const alias = DIR_ALIASES.find(([re]) => re.test(e.name))?.[1];
    if (alias) {
      if (!(await isTaken(alias))) {
        // "3D Files" -> "mechanical", "Images" -> "docs/images"
        await add(dirMoves, e.name, true, alias, `“${e.name}” becomes ${alias}/`, alias);
      } else {
        // Target already exists: keep the folder, nested inside it.
        await add(dirMoves, e.name, true, alias, `“${e.name}” goes inside ${alias}/`);
      }
      continue;
    }
    const dominant = await dominantCategory(full);
    if (dominant) {
      await add(dirMoves, e.name, true, dominant, `mostly ${dominant.replace('docs/images', 'image').replace('docs', 'document')} files`);
    } else {
      plan.kept.push({ path: full, reason: 'mixed content — left as is' });
    }
  }

  // Then loose files at the project root.
  for (const e of entries.filter((x) => x.isFile())) {
    if (KEEP_FILES.test(e.name) || e.name.startsWith('.')) continue;
    if (kind === 'firmware' && (FIRMWARE_ROOT_MARKERS.test(e.name) || categorize(e.name) === 'code')) {
      plan.kept.push({ path: path.join(projectPath, e.name), reason: 'firmware build file' });
      continue;
    }
    const target = targetForFile(e.name);
    if (!target) {
      plan.kept.push({ path: path.join(projectPath, e.name), reason: 'unknown file type' });
      continue;
    }
    const reason =
      extOf(e.name) === 'ino'
        ? 'Arduino sketch (needs a folder with the same name)'
        : `${categorize(e.name) === 'other' ? 'binary' : categorize(e.name)} file`;
    await add(fileMoves, e.name, false, target, reason);
  }

  plan.moves = [...plan.moves, ...dirMoves, ...fileMoves];
  return plan;
}

// ---------------------------------------------------------------------------
// Apply + undo

interface UndoLog {
  projectPath: string;
  at: number;
  moves: MoveItem[];
  createdDirs: string[];
}

function undoFile(logDir: string, projectPath: string): string {
  const key = Buffer.from(projectPath.toLowerCase()).toString('base64url').slice(0, 120);
  return path.join(logDir, `undo-${key}.json`);
}

async function mkdirTracked(dir: string, created: string[]) {
  const missing: string[] = [];
  let d = dir;
  while (!(await exists(d))) {
    missing.unshift(d);
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  for (const m of missing) {
    await fs.mkdir(m);
    created.push(m);
  }
}

/** Moves must stay inside the project. */
function inside(projectPath: string, p: string): boolean {
  const rel = path.relative(projectPath, p);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

const caseOnly = (a: string, b: string) => a !== b && a.toLowerCase() === b.toLowerCase();

/** Rename without ever overwriting. Case-only renames go through a temporary name (Windows). */
async function moveSafely(from: string, to: string, created: string[]) {
  if (caseOnly(from, to)) {
    const temp = `${from}.benchtop-tmp`;
    if (await exists(temp)) throw new Error('temporary name already exists');
    await fs.rename(from, temp);
    await fs.rename(temp, to);
    return;
  }
  if (await exists(to)) throw new Error('destination already exists');
  await mkdirTracked(path.dirname(to), created);
  await fs.rename(from, to);
}

export async function applyPlan(projectPath: string, moves: MoveItem[], logDir: string): Promise<ApplyResult> {
  const result: ApplyResult = { done: [], failed: [] };
  const created: string[] = [];
  for (const item of moves) {
    try {
      if (!inside(projectPath, item.from) || !inside(projectPath, item.to)) throw new Error('outside the project');
      await moveSafely(item.from, item.to, created);
      result.done.push(item);
    } catch (err) {
      result.failed.push({ item, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (result.done.length) {
    const log: UndoLog = { projectPath, at: Date.now(), moves: result.done, createdDirs: created };
    await fs.mkdir(logDir, { recursive: true });
    await fs.writeFile(undoFile(logDir, projectPath), JSON.stringify(log, null, 2), 'utf8');
  }
  return result;
}

export async function canUndo(projectPath: string, logDir: string): Promise<boolean> {
  return exists(undoFile(logDir, projectPath));
}

export async function undoPlan(projectPath: string, logDir: string): Promise<ApplyResult> {
  const file = undoFile(logDir, projectPath);
  const log = JSON.parse(await fs.readFile(file, 'utf8')) as UndoLog;
  const result: ApplyResult = { done: [], failed: [] };
  const recreated: string[] = [];
  for (const item of [...log.moves].reverse()) {
    try {
      await moveSafely(item.to, item.from, recreated);
      result.done.push({ ...item, from: item.to, to: item.from });
    } catch (err) {
      result.failed.push({ item, error: err instanceof Error ? err.message : String(err) });
    }
  }
  // Remove folders the move created, only if they are now empty.
  for (const dir of [...log.createdDirs].reverse()) {
    try {
      await fs.rmdir(dir);
    } catch {
      /* not empty or already gone: keep it */
    }
  }
  if (!result.failed.length) await fs.rm(file, { force: true });
  return result;
}
