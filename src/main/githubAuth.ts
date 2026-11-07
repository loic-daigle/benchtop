/** Stores the GitHub token encrypted with the OS keychain (Electron safeStorage). */
import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { GitHubAccount, GitHubStatus } from '../shared/types';
import { fetchAccount, ghCliAvailable, ghCliToken, gitAvailable, lfsAvailable } from './publish';

interface Stored {
  source: 'token' | 'gh-cli';
  /** base64 of the encrypted token (only for source "token"). */
  token?: string;
  plain?: boolean;
}

const file = () => path.join(app.getPath('userData'), 'github.json');
let account: GitHubAccount | null = null;

async function read(): Promise<Stored | null> {
  try {
    return JSON.parse(await fs.readFile(file(), 'utf8')) as Stored;
  } catch {
    return null;
  }
}

export async function getToken(): Promise<string | null> {
  const s = await read();
  if (!s) return null;
  if (s.source === 'gh-cli') return ghCliToken();
  if (!s.token) return null;
  const buf = Buffer.from(s.token, 'base64');
  try {
    return s.plain ? buf.toString('utf8') : safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

export async function setToken(token: string): Promise<GitHubStatus> {
  const clean = token.trim();
  if (!clean) throw new Error('Paste a token first.');
  const acc = await fetchAccount(clean, 'token'); // validates
  const encrypted = safeStorage.isEncryptionAvailable();
  const stored: Stored = {
    source: 'token',
    token: (encrypted ? safeStorage.encryptString(clean) : Buffer.from(clean, 'utf8')).toString('base64'),
    plain: !encrypted,
  };
  await fs.writeFile(file(), JSON.stringify(stored), 'utf8');
  account = { login: acc.login, name: acc.name, avatarUrl: acc.avatarUrl, source: 'token' };
  return status();
}

export async function useCli(): Promise<GitHubStatus> {
  const token = await ghCliToken();
  if (!token) throw new Error('The GitHub CLI is not signed in. Run “gh auth login” in a terminal first.');
  const acc = await fetchAccount(token, 'gh-cli');
  await fs.writeFile(file(), JSON.stringify({ source: 'gh-cli' } satisfies Stored), 'utf8');
  account = { login: acc.login, name: acc.name, avatarUrl: acc.avatarUrl, source: 'gh-cli' };
  return status();
}

export async function signOut(): Promise<GitHubStatus> {
  account = null;
  await fs.rm(file(), { force: true });
  return status();
}

export async function status(): Promise<GitHubStatus> {
  const [git, lfs, cli] = await Promise.all([gitAvailable(), lfsAvailable(), ghCliAvailable()]);
  if (!account) {
    const s = await read();
    const token = s ? await getToken() : null;
    if (token && s) {
      try {
        const acc = await fetchAccount(token, s.source);
        account = { login: acc.login, name: acc.name, avatarUrl: acc.avatarUrl, source: s.source };
      } catch {
        account = null;
      }
    }
  }
  return { account, ghCliAvailable: cli, gitAvailable: git, lfsAvailable: lfs };
}
