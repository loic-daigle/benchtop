/**
 * Local WebSocket bridge for the Benchtop EasyEDA extension.
 *
 * - Listens on 127.0.0.1 only (never on the network).
 * - The extension must say hello with the pairing code shown in Benchtop; anything else is dropped.
 * - Files are only written inside a project Benchtop knows about, and never overwrite anything.
 *
 * Kept free of Electron imports so it can be tested with plain Node.
 */
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  BRIDGE_PATH,
  BRIDGE_PORT,
  type BenchtopMessage,
  type BenchtopProjectOption,
  type ExportKind,
  type ExportTarget,
  type ExtensionMessage,
  type LookupResult,
} from '../shared/easyedaProtocol';
import { nameScore } from './easyeda';
import { isInside } from './scanner';

export interface BridgeProject {
  path: string;
  name: string;
  group: string | null;
  easyeda: string[];
}

export interface BridgeDeps {
  appVersion: string;
  getToken(): string;
  getRoot(): string | null;
  getProjects(): BridgeProject[];
  /** Replace the list of EasyEDA project names saved in the project's project.yaml. */
  setLinks(projectPath: string, easyedaNames: string[]): Promise<void>;
  /** Called after an export finished (refresh the project, tell the UI). */
  exported(projectPath: string, relDir: string, written: string[], failed: Array<{ kind: ExportKind; error: string }>): void | Promise<void>;
  /** Bring the window to the front and open the project. */
  open(projectPath: string): void;
  /** Number of connected (paired) extensions changed. */
  clientsChanged?(count: number): void;
}

export interface BridgeState {
  listening: boolean;
  port: number;
  clients: number;
  error: string | null;
  lastSeen: number | null;
  extensionVersion: string | null;
}

const MAX_FILE = 200 * 1024 * 1024; // bytes after decoding
const MAX_MESSAGE = Math.ceil((MAX_FILE * 4) / 3) + 64 * 1024;

export function newPairingCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
  const bytes = randomBytes(16);
  let s = '';
  for (let i = 0; i < 16; i++) {
    s += alphabet[bytes[i] % alphabet.length];
    if (i % 4 === 3 && i < 15) s += '-';
  }
  return s;
}

function sameCode(a: string, b: string): boolean {
  const norm = (s: string) => Buffer.from(s.trim().toUpperCase().replace(/\s+/g, ''), 'utf8');
  const x = norm(a);
  const y = norm(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** "Gerber_PCB1_2026-11-06.zip" -> safe basename (no folders, no reserved characters). */
export function safeFileName(name: string): string {
  const base = path.basename(String(name).replace(/\\/g, '/'));
  const cleaned = base
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, 150);
  return cleaned || 'export';
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** First free name: file.zip, file_2.zip, file_3.zip … */
export async function freeName(dir: string, name: string): Promise<string> {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let i = 2; await exists(path.join(dir, candidate)); i++) candidate = `${stem}_${i}${ext}`;
  return candidate;
}

function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The project's PCB folder: an existing pcb/PCB/hardware folder, else pcb/ (created on first file). */
export async function pcbDir(projectPath: string): Promise<string> {
  try {
    const entries = await fs.readdir(projectPath, { withFileTypes: true });
    for (const wanted of ['pcb', 'hardware', 'electronics']) {
      const hit = entries.find((e) => e.isDirectory() && e.name.toLowerCase() === wanted);
      if (hit) return hit.name;
    }
  } catch {
    /* fall through */
  }
  return 'pcb';
}

/** releases/2026-11-06, or releases/2026-11-06-2 if that one exists already. */
export async function releaseDir(projectPath: string, now = new Date()): Promise<string> {
  const base = `releases/${today(now)}`;
  let rel = base;
  for (let i = 2; await exists(path.join(projectPath, rel)); i++) rel = `${base}-${i}`;
  return rel;
}

interface ExportSession {
  projectPath: string;
  relDir: string;
  target: ExportTarget;
  written: string[];
  created: number;
}

export class EasyEdaBridge {
  private server: WebSocketServer | null = null;
  private paired = new Set<WebSocket>();
  private exports = new Map<string, ExportSession>();
  readonly state: BridgeState = { listening: false, port: BRIDGE_PORT, clients: 0, error: null, lastSeen: null, extensionVersion: null };

  constructor(private deps: BridgeDeps, private port = BRIDGE_PORT) {
    this.state.port = port;
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      const server = new WebSocketServer({ host: '127.0.0.1', port: this.port, path: BRIDGE_PATH, maxPayload: MAX_MESSAGE });
      this.server = server;
      server.on('listening', () => {
        this.state.listening = true;
        this.state.error = null;
        const addr = server.address();
        if (addr && typeof addr === 'object') this.state.port = addr.port;
        resolve();
      });
      server.on('error', (err: NodeJS.ErrnoException) => {
        this.state.listening = false;
        this.state.error =
          err.code === 'EADDRINUSE'
            ? `Port ${this.port} is already in use (is another Benchtop open?)`
            : err.message;
        resolve();
      });
      server.on('connection', (ws, req) => this.accept(ws, req));
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      for (const ws of this.paired) ws.terminate();
      this.paired.clear();
      if (!this.server) return resolve();
      for (const ws of this.server.clients) ws.terminate();
      this.server.close(() => resolve());
      this.server = null;
      this.state.listening = false;
    });
  }

  /** Disconnect everyone (after the pairing code changed). */
  dropClients() {
    for (const ws of this.paired) ws.close(4001, 'Pairing code changed');
    this.paired.clear();
    this.updateClients();
  }

  private updateClients() {
    this.state.clients = this.paired.size;
    this.deps.clientsChanged?.(this.paired.size);
  }

  private accept(ws: WebSocket, req: IncomingMessage) {
    // Any local program (or web page) can open a socket to 127.0.0.1, but nothing is answered
    // until it proves it knows the pairing code shown in Benchtop.
    void req;
    let authed = false;
    const helloTimer = setTimeout(() => {
      if (!authed) ws.close(4000, 'No hello');
    }, 10000);

    ws.on('message', (raw) => {
      let msg: ExtensionMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!authed) {
        if (msg?.type === 'hello' && typeof msg.token === 'string' && sameCode(msg.token, this.deps.getToken())) {
          authed = true;
          clearTimeout(helloTimer);
          this.paired.add(ws);
          this.state.extensionVersion = typeof msg.extensionVersion === 'string' ? msg.extensionVersion : null;
          this.state.lastSeen = Date.now();
          this.updateClients();
          this.send(ws, { type: 'welcome', appVersion: this.deps.appVersion });
        } else {
          this.send(ws, { type: 'denied', error: 'Wrong pairing code.' });
          ws.close(4001, 'Wrong pairing code');
        }
        return;
      }
      this.state.lastSeen = Date.now();
      if (msg?.type === 'hello') {
        this.send(ws, { type: 'welcome', appVersion: this.deps.appVersion });
        return;
      }
      const id = typeof (msg as { id?: unknown }).id === 'string' ? (msg as { id: string }).id : '';
      this.handle(msg)
        .then((data) => this.send(ws, { type: 'reply', id, ok: true, data }))
        .catch((err: unknown) => this.send(ws, { type: 'reply', id, ok: false, error: err instanceof Error ? err.message : String(err) }));
    });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (this.paired.delete(ws)) this.updateClients();
    });
    ws.on('error', () => undefined);
  }

  private send(ws: WebSocket, msg: BenchtopMessage) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private requireProject(projectPath: unknown): BridgeProject {
    const root = this.deps.getRoot();
    if (typeof projectPath !== 'string' || !root || !isInside(root, projectPath)) throw new Error('Unknown Benchtop project');
    const p = this.deps.getProjects().find((x) => path.resolve(x.path) === path.resolve(projectPath));
    if (!p) throw new Error('Unknown Benchtop project');
    return p;
  }

  private options(): BenchtopProjectOption[] {
    return this.deps
      .getProjects()
      .map((p) => ({ path: p.path, label: p.group ? `${p.group} / ${p.name}` : p.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  lookup(project: { name?: unknown; friendlyName?: unknown }): LookupResult {
    const names = [project.name, project.friendlyName]
      .filter((n): n is string => typeof n === 'string' && n.length > 0)
      .map((n) => n.toLowerCase());
    const projects = this.deps.getProjects();
    const linked = projects.find((p) => p.easyeda.some((n) => names.includes(n.toLowerCase())));
    let suggestion: string | null = null;
    if (!linked) {
      let best = 0.5;
      for (const p of projects) {
        for (const n of names) {
          const s = nameScore(n, p.name);
          if (s >= best) {
            best = s;
            suggestion = p.path;
          }
        }
      }
    }
    const options = this.options();
    return { linked: linked ? options.find((o) => o.path === linked.path) ?? null : null, suggestion, projects: options };
  }

  private async handle(msg: ExtensionMessage): Promise<unknown> {
    switch (msg.type) {
      case 'ping':
        return { pong: true };

      case 'lookup':
        return this.lookup(msg.project ?? {});

      case 'link': {
        const p = this.requireProject(msg.projectPath);
        const name = typeof msg.project?.name === 'string' && msg.project.name ? msg.project.name : msg.project?.friendlyName;
        if (typeof name !== 'string' || !name) throw new Error('Missing EasyEDA project name');
        // One EasyEDA project belongs to one Benchtop project: unlink it elsewhere first.
        for (const other of this.deps.getProjects()) {
          if (other.path !== p.path && other.easyeda.some((n) => n.toLowerCase() === name.toLowerCase())) {
            await this.deps.setLinks(other.path, other.easyeda.filter((n) => n.toLowerCase() !== name.toLowerCase()));
          }
        }
        if (!p.easyeda.some((n) => n.toLowerCase() === name.toLowerCase())) await this.deps.setLinks(p.path, [...p.easyeda, name]);
        return { path: p.path };
      }

      case 'beginExport': {
        const p = this.requireProject(msg.projectPath);
        const target: ExportTarget = msg.target === 'release' ? 'release' : 'pcb';
        const relDir = target === 'release' ? await releaseDir(p.path) : await pcbDir(p.path);
        const exportId = randomUUID();
        // Forget stale sessions (extension crashed mid-export).
        for (const [k, s] of this.exports) if (Date.now() - s.created > 60 * 60 * 1000) this.exports.delete(k);
        this.exports.set(exportId, { projectPath: p.path, relDir, target, written: [], created: Date.now() });
        return { exportId, relDir };
      }

      case 'file': {
        const session = this.exports.get(msg.exportId);
        if (!session) throw new Error('Export expired, start again');
        if (typeof msg.data !== 'string') throw new Error('No data');
        const bytes = Buffer.from(msg.data, 'base64');
        if (bytes.length > MAX_FILE) throw new Error('File too large');
        // The EasyEDA project file goes in pcb/easyeda/ next to the backups Benchtop copies.
        const sub = msg.kind === 'project' && session.target === 'pcb' ? path.join(session.relDir, 'easyeda') : session.relDir;
        const dir = path.join(session.projectPath, sub);
        if (!isInside(session.projectPath, dir)) throw new Error('Bad folder');
        await fs.mkdir(dir, { recursive: true });
        const name = await freeName(dir, safeFileName(msg.name));
        const dest = path.join(dir, name);
        await fs.writeFile(dest, bytes, { flag: 'wx' }); // wx: never overwrite
        const rel = path.relative(session.projectPath, dest).split(path.sep).join('/');
        session.written.push(rel);
        return { path: rel };
      }

      case 'endExport': {
        const session = this.exports.get(msg.exportId);
        if (!session) throw new Error('Export expired');
        this.exports.delete(msg.exportId);
        const failed = Array.isArray(msg.failed) ? msg.failed : [];
        await this.deps.exported(session.projectPath, session.relDir, session.written, failed);
        return { written: session.written, relDir: session.relDir.split(path.sep).join('/') };
      }

      case 'open': {
        const p = this.requireProject(msg.projectPath);
        this.deps.open(p.path);
        return { ok: true };
      }

      default:
        throw new Error('Unknown request');
    }
  }
}
