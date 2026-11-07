import { execFile } from 'node:child_process';
import type { GitInfo } from '../shared/types';

let gitMissing = false;

export function git(cwd: string, args: string[]): Promise<string | null> {
  if (gitMissing) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', cwd, '-c', 'core.quotepath=false', ...args],
      { timeout: 20000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') gitMissing = true;
          resolve(null);
        } else resolve(stdout);
      },
    );
  });
}

/** git@github.com:user/repo.git -> https://github.com/user/repo */
export function remoteToWebUrl(remote: string | null): string | null {
  if (!remote) return null;
  let url = remote.trim();
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(url);
  if (scp) url = `https://${scp[1]}/${scp[2]}`;
  url = url.replace(/^ssh:\/\/(?:[\w.-]+@)?/, 'https://').replace(/^git:\/\//, 'https://');
  url = url.replace(/\/\/[^/@]+@/, '//'); // drop credentials
  url = url.replace(/\.git$/, '');
  return /^https?:\/\//.test(url) ? url : null;
}

/** Parses `git status --porcelain=v1 -b` output. */
export function parseStatus(out: string): Pick<GitInfo, 'branch' | 'ahead' | 'behind' | 'changes'> {
  const lines = out.split('\n').filter(Boolean);
  let branch: string | null = null;
  let ahead = 0;
  let behind = 0;
  const head = lines[0]?.startsWith('## ') ? lines.shift()!.slice(3) : '';
  if (head) {
    const m = /^(?:No commits yet on |Initial commit on )?([^.\s]+)/.exec(head);
    branch = head.startsWith('HEAD (no branch)') ? 'detached' : (m?.[1] ?? null);
    ahead = Number(/ahead (\d+)/.exec(head)?.[1] ?? 0);
    behind = Number(/behind (\d+)/.exec(head)?.[1] ?? 0);
  }
  return { branch, ahead, behind, changes: lines.length };
}

export async function getGitInfo(repoPath: string): Promise<GitInfo | null> {
  const [status, log, remote] = await Promise.all([
    git(repoPath, ['status', '--porcelain=v1', '-b', '--untracked-files=normal']),
    git(repoPath, ['log', '-1', '--format=%H%x1f%s%x1f%ct']),
    git(repoPath, ['remote', 'get-url', 'origin']),
  ]);
  if (status === null) return null;
  const parsed = parseStatus(status);
  let lastCommit: GitInfo['lastCommit'] = null;
  if (log?.trim()) {
    const [hash, subject, ct] = log.trim().split('\x1f');
    lastCommit = { hash, subject, date: Number(ct) * 1000 };
  }
  const remoteUrl = remote?.trim() || null;
  return { ...parsed, lastCommit, remoteUrl, webUrl: remoteToWebUrl(remoteUrl) };
}
