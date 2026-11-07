import { app } from 'electron';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import type { Settings } from '../shared/types';

const file = () => path.join(app.getPath('userData'), 'settings.json');

let cache: Settings | null = null;

/** Benchtop's own settings file (in its app-data folder, never in your projects). */
export async function loadSettings(): Promise<Settings> {
  if (cache) return cache;
  let settings: Settings = { root: null, pinned: [], recent: [] };
  try {
    const saved = JSON.parse(await fs.readFile(file(), 'utf8')) as Partial<Settings>;
    settings = {
      root: typeof saved.root === 'string' ? saved.root : null,
      pinned: Array.isArray(saved.pinned) ? saved.pinned.filter((p) => typeof p === 'string') : [],
      recent: Array.isArray(saved.recent) ? saved.recent.filter((p) => typeof p === 'string') : [],
    };
  } catch {
    /* first run */
  }
  if (settings.root && !existsSync(settings.root)) settings.root = null;
  if (!settings.root) {
    // First run: use Desktop\Projets if it exists.
    const guess = path.join(app.getPath('desktop'), 'Projets');
    if (existsSync(guess)) settings.root = guess;
  }
  cache = settings;
  return settings;
}

export async function saveSettings(next: Settings): Promise<Settings> {
  cache = next;
  await fs.mkdir(path.dirname(file()), { recursive: true });
  await fs.writeFile(file(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export async function updateSettings(patch: Partial<Pick<Settings, 'pinned' | 'recent'>>): Promise<Settings> {
  const current = await loadSettings();
  const next: Settings = { ...current };
  if (Array.isArray(patch.pinned)) next.pinned = [...new Set(patch.pinned.filter((p) => typeof p === 'string'))];
  if (Array.isArray(patch.recent)) next.recent = [...new Set(patch.recent.filter((p) => typeof p === 'string'))].slice(0, 12);
  return saveSettings(next);
}
