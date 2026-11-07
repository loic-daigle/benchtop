/**
 * Keep Benchtop's own files out of git without touching the repo:
 * patterns go to .git/info/exclude (local to this clone, never committed).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** project.yaml (project info) and release.yaml (order numbers, notes) stay on this computer. */
export const BENCHTOP_IGNORES = ['/project.yaml', '**/[Rr]eleases/*/release.yaml'];
const HEADER = '# Benchtop (local only, not committed)';

/** Adds the missing patterns. Returns true when the file changed. */
export async function ensureExcluded(repoPath: string, patterns: string[] = BENCHTOP_IGNORES): Promise<boolean> {
  const gitDir = path.join(repoPath, '.git');
  let st;
  try {
    st = await fs.stat(gitDir);
  } catch {
    return false; // not a repo
  }
  if (!st.isDirectory()) return false; // worktree / submodule: .git is a file, leave it alone

  const file = path.join(gitDir, 'info', 'exclude');
  let text = '';
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    /* no exclude file yet */
  }
  const lines = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  const missing = patterns.filter((p) => !lines.has(p));
  if (!missing.length) return false;

  const block = `${lines.has(HEADER) ? '' : `${HEADER}\n`}${missing.join('\n')}\n`;
  const prefix = text && !text.endsWith('\n') ? '\n' : '';
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${prefix}${text && !lines.has(HEADER) ? '\n' : ''}${block}`, 'utf8');
  return true;
}
