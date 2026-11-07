/**
 * Keeps the project list in memory, cached on disk for instant startup, and up to
 * date through a recursive folder watcher. Electron-free: events go through callbacks.
 */
import { promises as fs, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { HEAVY_DIRS } from '../shared/fileKinds';
import type { FsChange, ProjectMeta, ProjectSummary, QuickFindItem, SearchResponse } from '../shared/types';
import { fuzzyScore } from './fuzzy';
import { ensureExcluded } from './gitExclude';
import { NOTES_FILE, readMeta, writeMeta } from './meta';
import { isInside, scanAll, searchProjects, summarizeProject } from './scanner';

interface Events {
  projects: (list: ProjectSummary[]) => void;
  fsChanged: (change: FsChange) => void;
}

interface CacheFile {
  version: 2;
  root: string;
  projects: ProjectSummary[];
}

export class ProjectStore {
  private _root: string | null = null;
  get root(): string | null {
    return this._root;
  }
  private projects = new Map<string, ProjectSummary>();
  private files = new Map<string, string[]>();
  private loaded = false;
  private fullScan: Promise<ProjectSummary[]> | null = null;
  private watcher: FSWatcher | null = null;
  private timers = new Map<string, NodeJS.Timeout>();
  private searchId = 0;

  constructor(
    private cacheFile: string,
    private events: Events,
  ) {}

  /** Cached list right away (if any); a fresh scan runs in the background. */
  async list(root: string): Promise<ProjectSummary[]> {
    if (root !== this.root) this.reset(root);
    if (!this.loaded) {
      this.loaded = true;
      const cached = await this.readCache(root);
      if (cached) {
        cached.forEach((p) => this.projects.set(p.path, p));
        void this.rescan();
        return this.sorted();
      }
      return this.rescan();
    }
    return this.sorted();
  }

  rescan(): Promise<ProjectSummary[]> {
    if (!this.root) return Promise.resolve([]);
    if (this.fullScan) return this.fullScan;
    const root = this.root;
    this.fullScan = (async () => {
      try {
        const results = await scanAll(root);
        if (root !== this.root) return this.sorted();
        this.projects.clear();
        this.files.clear();
        for (const r of results) {
          this.projects.set(r.summary.path, r.summary);
          this.files.set(r.summary.path, r.files);
        }
        const list = this.sorted();
        this.events.projects(list);
        void this.writeCache();
        void this.excludeBenchtopFiles(list);
        this.startWatcher();
        return list;
      } finally {
        this.fullScan = null;
      }
    })();
    return this.fullScan;
  }

  all(): ProjectSummary[] {
    return this.sorted();
  }

  get(projectPath: string): ProjectSummary | undefined {
    return this.projects.get(projectPath);
  }

  /** Rescan a single project and broadcast the new list. */
  async refreshProject(projectPath: string): Promise<ProjectSummary | undefined> {
    const current = this.projects.get(projectPath);
    if (!current) return undefined;
    try {
      await fs.access(projectPath);
    } catch {
      void this.rescan(); // folder deleted or renamed
      return undefined;
    }
    const r = await summarizeProject(projectPath, current.group);
    this.projects.set(projectPath, r.summary);
    this.files.set(projectPath, r.files);
    this.events.projects(this.sorted());
    this.debounce('cache', 2000, () => void this.writeCache());
    void this.excludeBenchtopFiles([r.summary]);
    return r.summary;
  }

  async saveMeta(projectPath: string, meta: ProjectMeta): Promise<ProjectSummary> {
    this.requireProject(projectPath);
    await writeMeta(projectPath, meta);
    const updated = await this.refreshProject(projectPath);
    if (!updated) throw new Error('Project not found');
    return updated;
  }

  /** Turn a folder into a group of projects, or back into one project. */
  async setGroup(folderPath: string, isGroup: boolean): Promise<void> {
    if (!this.root || !isInside(this.root, folderPath) || folderPath === this.root) throw new Error('Not a folder in your projects');
    const { meta } = await readMeta(folderPath);
    await writeMeta(folderPath, { ...meta, group: isGroup });
    if (this.fullScan) await this.fullScan;
    await this.rescan();
  }

  async readNotes(projectPath: string): Promise<string> {
    this.requireProject(projectPath);
    try {
      return await fs.readFile(path.join(projectPath, NOTES_FILE), 'utf8');
    } catch {
      return '';
    }
  }

  async saveNotes(projectPath: string, content: string): Promise<void> {
    this.requireProject(projectPath);
    const file = path.join(projectPath, NOTES_FILE);
    // Don't create an empty NOTES.md just because the panel was opened.
    if (!content.trim()) {
      try {
        await fs.access(file);
      } catch {
        return;
      }
    }
    await fs.writeFile(file, content, 'utf8');
  }

  quickFind(query: string, limit = 60): QuickFindItem[] {
    const q = query.trim();
    const items: QuickFindItem[] = [];
    for (const p of this.projects.values()) {
      const label = p.group ? `${p.group}/${p.name}` : p.name;
      const score = q ? fuzzyScore(q, label) : 0;
      if (score >= 0) {
        items.push({ kind: 'project', projectPath: p.path, projectName: p.name, path: p.path, relPath: '', score: score + 25 });
      }
    }
    if (q) {
      for (const [projectPath, files] of this.files) {
        const projectName = this.projects.get(projectPath)?.name ?? path.basename(projectPath);
        for (const rel of files) {
          const score = fuzzyScore(q, rel);
          if (score > 0) {
            items.push({ kind: 'file', projectPath, projectName, path: path.join(projectPath, rel), relPath: rel, score });
          }
        }
      }
    } else {
      items.sort((a, b) => a.projectName.localeCompare(b.projectName));
      return items.slice(0, limit);
    }
    items.sort((a, b) => b.score - a.score);
    return items.slice(0, limit);
  }

  /** Full-text search; a newer search cancels the previous one. */
  async search(query: string, opts: { projectPath?: string; caseSensitive?: boolean } = {}): Promise<SearchResponse> {
    const id = ++this.searchId;
    if (query.trim().length < 2) return { results: [], filesSearched: 0, truncated: false, cancelled: false };
    let targets = this.sorted().map((p) => ({ path: p.path, name: p.name }));
    if (opts.projectPath) targets = targets.filter((t) => t.path === opts.projectPath);
    return searchProjects(targets, query, {
      caseSensitive: opts.caseSensitive,
      isCancelled: () => id !== this.searchId,
    });
  }

  dispose() {
    this.watcher?.close();
    this.watcher = null;
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
  }

  // ---------------------------------------------------------------------------

  private reset(root: string) {
    this.dispose();
    this._root = root;
    this.projects.clear();
    this.files.clear();
    this.loaded = false;
  }

  private requireProject(projectPath: string) {
    if (!this.root || !isInside(this.root, projectPath) || !this.projects.has(projectPath)) {
      throw new Error('Unknown project');
    }
  }

  private sorted(): ProjectSummary[] {
    return [...this.projects.values()].sort((a, b) => b.modified - a.modified);
  }

  private debounce(key: string, ms: number, fn: () => void) {
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        fn();
      }, ms),
    );
  }

  private projectFor(fullPath: string): ProjectSummary | undefined {
    let best: ProjectSummary | undefined;
    for (const p of this.projects.values()) {
      if (isInside(p.path, fullPath) && (!best || p.path.length > best.path.length)) best = p;
    }
    return best;
  }

  private startWatcher() {
    if (this.watcher || !this.root) return;
    const root = this.root;
    try {
      this.watcher = watch(root, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const rel = filename.toString();
        const parts = rel.split(/[\\/]+/);
        const full = path.join(root, rel);
        const gitIndex = parts.findIndex((s) => s === '.git');
        if (parts.some((s, i) => HEAVY_DIRS.has(s.toLowerCase()) && (gitIndex === -1 || i < gitIndex))) return;

        const project = this.projectFor(full);
        if (!project) {
          // Something changed at the top level (new / renamed project folder).
          this.debounce('full', 1500, () => void this.rescan());
          return;
        }
        if (gitIndex !== -1) {
          // Commits, checkouts, staging: refresh git info a bit later.
          this.debounce(`p:${project.path}`, 3000, () => void this.refreshProject(project.path));
          return;
        }
        if (full === project.path) {
          this.debounce('full', 1500, () => void this.rescan());
          return;
        }
        const dir = path.dirname(full);
        this.debounce(`d:${dir}`, 300, () => this.events.fsChanged({ projectPath: project.path, dir }));
        this.debounce(`p:${project.path}`, 1500, () => void this.refreshProject(project.path));
      });
      this.watcher.on('error', () => {
        this.watcher?.close();
        this.watcher = null;
      });
    } catch {
      this.watcher = null; // recursive watch unsupported: manual refresh still works
    }
  }

  /** project.yaml stays out of git: added to each repo's local .git/info/exclude. */
  private async excludeBenchtopFiles(list: ProjectSummary[]) {
    for (const p of list) {
      if (!p.isGitRepo) continue;
      try {
        await ensureExcluded(p.path);
      } catch {
        /* read-only repo or permissions: not critical */
      }
    }
  }

  private async readCache(root: string): Promise<ProjectSummary[] | null> {
    try {
      const data = JSON.parse(await fs.readFile(this.cacheFile, 'utf8')) as CacheFile;
      if (data.version !== 2 || data.root !== root || !Array.isArray(data.projects)) return null;
      return data.projects;
    } catch {
      return null;
    }
  }

  private async writeCache() {
    if (!this.root) return;
    const data: CacheFile = { version: 2, root: this.root, projects: this.sorted() };
    try {
      await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
      await fs.writeFile(this.cacheFile, JSON.stringify(data), 'utf8');
    } catch {
      /* cache is optional */
    }
  }
}
