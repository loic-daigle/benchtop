/** "Open in VS Code" and "Open terminal here". */
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

function launch(cmd: string, args: string[], opts: { cwd?: string; shell?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { ...opts, detached: true, stdio: 'ignore', windowsHide: false });
      let settled = false;
      child.once('error', () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      });
      child.once('exit', (code) => {
        if (!settled) {
          settled = true;
          resolve(code === 0);
        }
      });
      // Still running after a moment = it launched fine.
      setTimeout(() => {
        if (!settled) {
          settled = true;
          child.unref();
          resolve(true);
        }
      }, 1500);
    } catch {
      resolve(false);
    }
  });
}

function vscodeCandidates(): string[] {
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? '';
    const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
    return [
      path.join(local, 'Programs', 'Microsoft VS Code', 'Code.exe'),
      path.join(pf, 'Microsoft VS Code', 'Code.exe'),
      path.join(local, 'Programs', 'cursor', 'Cursor.exe'),
    ];
  }
  if (process.platform === 'darwin') return ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'];
  return ['/usr/bin/code', '/snap/bin/code'];
}

export async function openInEditor(target: string): Promise<void> {
  for (const exe of vscodeCandidates()) {
    if (existsSync(exe) && (await launch(exe, [target]))) return;
  }
  // `code` from PATH (needs a shell on Windows because it's a .cmd).
  const quoted = process.platform === 'win32' ? `"${target}"` : target;
  if (await launch('code', [quoted], { shell: process.platform === 'win32' })) return;
  throw new Error('VS Code was not found. Install it, or add "code" to your PATH.');
}

export async function openTerminal(target: string): Promise<void> {
  let dir = target;
  try {
    if (!statSync(target).isDirectory()) dir = path.dirname(target);
  } catch {
    /* use as-is */
  }
  if (process.platform === 'win32') {
    if (await launch('wt.exe', ['-d', dir])) return; // Windows Terminal
    if (await launch('cmd.exe', ['/c', 'start', '""', '/D', dir, 'powershell.exe', '-NoExit'], { cwd: dir })) return;
    throw new Error('Could not open a terminal.');
  }
  if (process.platform === 'darwin') {
    if (await launch('open', ['-a', 'Terminal', dir])) return;
    throw new Error('Could not open Terminal.');
  }
  for (const term of ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm']) {
    if (await launch(term, [], { cwd: dir })) return;
  }
  throw new Error('Could not open a terminal.');
}
