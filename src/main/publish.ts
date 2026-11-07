/**
 * Publish a project to GitHub and keep it in sync.
 * Auth: a token pasted by the user (stored encrypted) or the GitHub CLI login.
 * The token is never written into the repo or its remote URL.
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { HEAVY_DIRS, categorize, isLikelyText } from '../shared/fileKinds';
import type { GitChange, GitHubAccount, PublishOptions, PublishPrecheck, PublishResult, SecretHit } from '../shared/types';
import { readMeta, writeMeta } from './meta';
import { GITATTRIBUTES, GITIGNORE, slugify } from './structure';
import { ensureExcluded } from './gitExclude';

// ---------------------------------------------------------------- process helpers

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function run(cmd: string, args: string[], cwd?: string, timeout = 120000): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd, timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout, stderr) => {
        const e = err as (Error & { code?: string | number }) | null;
        const code = !e ? 0 : e.code === 'ENOENT' ? 127 : typeof e.code === 'number' ? e.code : 1;
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr || e?.message || '') });
      },
    );
  });
}

async function git(cwd: string, args: string[], token?: string | null): Promise<RunResult> {
  const auth = token ? ['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`] : [];
  return run('git', [...auth, '-c', 'core.quotepath=false', ...args], cwd);
}

async function gitOk(cwd: string, args: string[], token?: string | null): Promise<string> {
  const r = await git(cwd, args, token);
  if (r.code !== 0) {
    const msg = (r.stderr || r.stdout).trim().split('\n').filter((l) => !/^hint:/.test(l)).slice(-3).join(' ');
    throw new Error(`git ${args[0]} failed: ${msg || `exit ${r.code}`}`);
  }
  return r.stdout;
}

export async function gitAvailable(): Promise<boolean> {
  return (await run('git', ['--version'], undefined, 10000)).code === 0;
}
export async function lfsAvailable(): Promise<boolean> {
  return (await run('git', ['lfs', 'version'], undefined, 10000)).code === 0;
}
export async function ghCliAvailable(): Promise<boolean> {
  return (await run('gh', ['--version'], undefined, 10000)).code === 0;
}
export async function ghCliToken(): Promise<string | null> {
  const r = await run('gh', ['auth', 'token'], undefined, 15000);
  const token = r.stdout.trim();
  return r.code === 0 && token ? token : null;
}

// ---------------------------------------------------------------- GitHub API

async function gh<T>(token: string, method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.github.com${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Benchtop',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const detail = Array.isArray(data.errors) && data.errors[0]?.message ? ` (${data.errors[0].message})` : '';
    if (res.status === 401) throw new Error('GitHub refused the token (expired or wrong). Sign in again.');
    if (res.status === 422 && /name already exists/i.test(text)) throw new Error('You already have a repository with that name on GitHub. Pick another name.');
    throw new Error(`GitHub: ${data.message ?? res.statusText}${detail}`);
  }
  return data as T;
}

interface ApiUser {
  login: string;
  name: string | null;
  avatar_url: string;
  id: number;
}

export async function fetchAccount(token: string, source: GitHubAccount['source']): Promise<GitHubAccount & { id: number }> {
  const u = await gh<ApiUser>(token, 'GET', '/user');
  return { login: u.login, name: u.name, avatarUrl: u.avatar_url, source, id: u.id };
}

// ---------------------------------------------------------------- precheck

const SECRET_PATTERNS: RegExp[] = [
  /\b(ssid|password|passwd|pass|pwd|wifi_?pass\w*|api[_-]?key|apikey|secret|token|auth[_-]?token|mqtt_?pass\w*)\b\s*(?:\[\s*\])?\s*[:=]\s*["'][^"'\s]{4,}["']/i,
  /#define\s+\w*(PASS|PASSWORD|PSK|SSID|API_?KEY|TOKEN|SECRET)\w*\s+"[^"]{3,}"/i,
  /\b(ghp|gho|ghu|ghs)_[A-Za-z0-9]{30,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bxox[abps]-[A-Za-z0-9-]{10,}/,
];
const PLACEHOLDER = /["'](your|my|enter|change|insert)?[_ -]?(wifi[_ -]?)?(ssid|password|pass|key|token|secret|name|here)?["']|["'](x+|\*+|\.\.\.|<[^>]*>|TODO|CHANGEME|placeholder)["']|YOUR_|_HERE/i;

export function findSecrets(text: string, relPath: string, limit = 20): SecretHit[] {
  const hits: SecretHit[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length && hits.length < limit; i++) {
    const line = lines[i];
    if (line.length > 2000) continue;
    if (SECRET_PATTERNS.some((re) => re.test(line)) && !PLACEHOLDER.test(line)) {
      hits.push({ relPath, line: i + 1, text: line.trim().slice(0, 160) });
    }
  }
  return hits;
}

/** Simple .gitignore matching for the precheck: names and directory names only. */
async function ignoredNames(projectPath: string): Promise<Set<string>> {
  const names = new Set<string>();
  try {
    const text = await fs.readFile(path.join(projectPath, '.gitignore'), 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith('!') || /[*?[]/.test(line.replace(/^\*\./, ''))) {
        if (line.startsWith('*.')) names.add(line.slice(1).toLowerCase()); // "*.bak" -> ".bak" suffix
        continue;
      }
      names.add(line.replace(/^\/|\/$/g, '').toLowerCase());
    }
  } catch {
    /* no .gitignore */
  }
  return names;
}

export async function precheck(projectPath: string): Promise<PublishPrecheck> {
  const isRepo = await exists(path.join(projectPath, '.git'));
  let remoteUrl: string | null = null;
  if (isRepo) {
    const r = await git(projectPath, ['remote', 'get-url', 'origin']);
    remoteUrl = r.code === 0 ? r.stdout.trim() || null : null;
  }
  const ignored = await ignoredNames(projectPath);
  const isIgnored = (rel: string, name: string) => {
    const lower = name.toLowerCase();
    if (ignored.has(lower) || ignored.has(rel.replace(/\\/g, '/').toLowerCase())) return true;
    for (const n of ignored) if (n.startsWith('.') && lower.endsWith(n)) return true;
    return false;
  };

  const result: PublishPrecheck = {
    isRepo,
    hasRemote: !!remoteUrl,
    remoteUrl,
    fileCount: 0,
    totalBytes: 0,
    largeFiles: [],
    blockedFiles: [],
    cadFileCount: 0,
    secrets: [],
    nestedRepos: [],
    hasGitignore: await exists(path.join(projectPath, '.gitignore')),
    suggestedName: slugify(path.basename(projectPath)) || 'project',
  };

  const queue: string[] = [projectPath];
  while (queue.length) {
    const dir = queue.shift()!;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = path.relative(projectPath, full);
      if (e.isDirectory()) {
        if (e.name === '.git' || HEAVY_DIRS.has(e.name.toLowerCase()) || isIgnored(rel, e.name)) continue;
        if (await exists(path.join(full, '.git'))) {
          result.nestedRepos.push(rel);
          continue;
        }
        queue.push(full);
        continue;
      }
      if (!e.isFile() || isIgnored(rel, e.name)) continue;
      let size = 0;
      try {
        size = (await fs.stat(full)).size;
      } catch {
        continue;
      }
      result.fileCount++;
      result.totalBytes += size;
      const cat = categorize(e.name);
      if (cat === 'cad') result.cadFileCount++;
      if (size > 50 * 1024 * 1024) result.largeFiles.push({ relPath: rel, size });
      if (size > 100 * 1024 * 1024 && cat !== 'cad') result.blockedFiles.push({ relPath: rel, size });
      if (result.secrets.length < 50 && size < 512 * 1024 && (isLikelyText(e.name) || cat === 'code')) {
        try {
          const text = await fs.readFile(full, 'utf8');
          if (!text.includes('\u0000')) result.secrets.push(...findSecrets(text, rel, 50 - result.secrets.length));
        } catch {
          /* unreadable */
        }
      }
    }
  }
  return result;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- publish

export async function publish(
  projectPath: string,
  opts: PublishOptions,
  token: string,
  progress: (msg: string) => void,
): Promise<PublishResult> {
  if (!(await gitAvailable())) throw new Error('Git is not installed. Get it from https://git-scm.com and restart Benchtop.');
  const name = slugify(opts.repoName) || slugify(path.basename(projectPath));
  if (!name) throw new Error('Pick a repository name.');

  progress('Checking your GitHub account…');
  const account = await fetchAccount(token, 'token');

  // .gitignore (create, or append the exclusions)
  const gi = path.join(projectPath, '.gitignore');
  let gitignore = '';
  try {
    gitignore = await fs.readFile(gi, 'utf8');
  } catch {
    gitignore = GITIGNORE;
    progress('Adding a .gitignore…');
  }
  const extra = opts.exclude
    .map((p) => `/${p.replace(/\\/g, '/')}`)
    .filter((line) => !gitignore.split(/\r?\n/).includes(line));
  if (extra.length) gitignore = `${gitignore.trimEnd()}\n\n# Excluded when publishing with Benchtop\n${extra.join('\n')}\n`;
  await fs.writeFile(gi, gitignore, 'utf8');

  const isRepo = await exists(path.join(projectPath, '.git'));
  if (!isRepo) {
    progress('Creating the git repository…');
    const init = await git(projectPath, ['init', '-b', 'main']);
    if (init.code !== 0) {
      await gitOk(projectPath, ['init']);
      await git(projectPath, ['checkout', '-b', 'main']);
    }
  }

  await ensureExcluded(projectPath);

  if (opts.useLfs) {
    progress('Setting up Git LFS for CAD files…');
    await gitOk(projectPath, ['lfs', 'install', '--local']);
    const ga = path.join(projectPath, '.gitattributes');
    let attrs = '';
    try {
      attrs = await fs.readFile(ga, 'utf8');
    } catch {
      /* none */
    }
    if (!attrs.includes('filter=lfs')) await fs.writeFile(ga, `${attrs.trimEnd()}${attrs ? '\n\n' : ''}${GITATTRIBUTES}`, 'utf8');
  }

  // Commit identity: use the GitHub account if git has none configured.
  const email = (await git(projectPath, ['config', 'user.email'])).stdout.trim();
  if (!email) {
    await gitOk(projectPath, ['config', 'user.name', account.name || account.login]);
    await gitOk(projectPath, ['config', 'user.email', `${account.id}+${account.login}@users.noreply.github.com`]);
  }

  progress('Committing files…');
  await gitOk(projectPath, ['add', '-A']);
  const staged = await git(projectPath, ['diff', '--cached', '--quiet']);
  if (staged.code !== 0) await gitOk(projectPath, ['commit', '-m', opts.commitMessage.trim() || 'Initial commit']);
  const head = await git(projectPath, ['rev-parse', '--verify', 'HEAD']);
  if (head.code !== 0) throw new Error('Nothing to publish: the project has no files to commit.');

  let url: string;
  const remote = await git(projectPath, ['remote', 'get-url', 'origin']);
  if (remote.code === 0 && remote.stdout.trim()) {
    url = remote.stdout.trim().replace(/\.git$/, '');
    progress('Pushing to the existing remote…');
  } else {
    progress(`Creating github.com/${account.login}/${name}…`);
    const repo = await gh<{ html_url: string; clone_url: string }>(token, 'POST', '/user/repos', {
      name,
      description: opts.description.slice(0, 350) || undefined,
      private: opts.isPrivate,
      has_wiki: false,
    });
    url = repo.html_url;
    await gitOk(projectPath, ['remote', 'add', 'origin', repo.clone_url]);
    progress('Uploading…');
  }

  const branch = (await gitOk(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim() || 'main';
  await gitOk(projectPath, ['push', '-u', 'origin', branch], url.includes('github.com') ? token : null);

  // Remember the link in project.yaml.
  try {
    const { meta } = await readMeta(projectPath);
    const links = (meta.links ?? []).filter((l) => l.label.toLowerCase() !== 'github');
    await writeMeta(projectPath, { ...meta, links: [{ label: 'github', url }, ...links] });
  } catch {
    /* not critical */
  }
  progress('Done!');
  return { url };
}

// ---------------------------------------------------------------- sync

export async function changes(projectPath: string): Promise<GitChange[]> {
  const out = await gitOk(projectPath, ['status', '--porcelain=v1', '--untracked-files=all']);
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => ({ status: l.slice(0, 2).trim() || '?', path: l.slice(3).replace(/^"|"$/g, '') }));
}

function needsToken(remote: string): boolean {
  return /^https:\/\/github\.com\//i.test(remote);
}

export async function commitAndPush(projectPath: string, message: string, token: string | null): Promise<string> {
  const remote = (await gitOk(projectPath, ['remote', 'get-url', 'origin'])).trim();
  await gitOk(projectPath, ['add', '-A']);
  const staged = await git(projectPath, ['diff', '--cached', '--quiet']);
  let summary = 'Nothing new to commit.';
  if (staged.code !== 0) {
    if (!message.trim()) throw new Error('Write a short commit message.');
    await gitOk(projectPath, ['commit', '-m', message.trim()]);
    summary = 'Committed.';
  }
  const branch = (await gitOk(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  await gitOk(projectPath, ['push', '-u', 'origin', branch], needsToken(remote) ? token : null);
  return `${summary} Pushed to ${branch}.`;
}

export async function pull(projectPath: string, token: string | null): Promise<string> {
  const remote = (await gitOk(projectPath, ['remote', 'get-url', 'origin'])).trim();
  const out = await gitOk(projectPath, ['pull', '--ff-only'], needsToken(remote) ? token : null);
  return /already up to date/i.test(out) ? 'Already up to date.' : 'Pulled the latest changes.';
}
