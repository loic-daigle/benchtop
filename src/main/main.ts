import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, nativeTheme, net, protocol, shell } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import squirrelStartup from 'electron-squirrel-startup';
import { makeUserNotifier, updateElectronApp, UpdateSourceType } from 'update-electron-app';
import type { MoveItem, NewProjectInput, NewReleaseInput, ProjectMeta, PublishOptions, ReleaseInfo } from '../shared/types';
import { openInEditor, openTerminal } from './actions';
import * as github from './githubAuth';
import * as publisher from './publish';
import { applyPlan, canUndo, createProject, planStructure, undoPlan } from './structure';
import * as easyeda from './easyeda';
import { ensureExcluded } from './gitExclude';
import type { EasyEdaStatus } from '../shared/types';
import { readMeta } from './meta';
import { isInside, listDir, readText } from './scanner';
import { loadSettings, saveSettings, updateSettings } from './settings';
import { ProjectStore } from './store';
import { EasyEdaBridge, newPairingCode } from './bridge';
import { renderGerberZip, zipInfo } from './gerber';
import * as releases from './releases';
import { promises as fsp } from 'node:fs';

// Squirrel installer events on Windows (create/remove shortcuts, then quit).
if (squirrelStartup) app.quit();

// One Benchtop at a time: a second launch (Start menu while it's open) brings the first one forward.
// Two copies would also fight over the EasyEDA connection port.
const isPrimary = !squirrelStartup && app.requestSingleInstanceLock();
if (!isPrimary && !squirrelStartup) app.quit();
app.on('second-instance', () => focusWindow());

/**
 * benchtop://file/<encoded path>  -> the file's bytes (images in previews/README)
 * benchtop://thumb/<encoded path> -> a small OS-generated thumbnail (dashboard cards)
 */
protocol.registerSchemesAsPrivileged([
  { scheme: 'benchtop', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let store: ProjectStore;
let bridge: EasyEdaBridge | null = null;
let pairingCode = '';

const bridgeFile = () => path.join(app.getPath('userData'), 'easyeda-bridge.json');

async function loadPairingCode(): Promise<string> {
  try {
    const saved = JSON.parse(await fsp.readFile(bridgeFile(), 'utf8')) as { code?: unknown };
    if (typeof saved.code === 'string' && saved.code.length >= 8) return saved.code;
  } catch {
    /* first run */
  }
  return savePairingCode(newPairingCode());
}

async function savePairingCode(code: string): Promise<string> {
  await fsp.mkdir(path.dirname(bridgeFile()), { recursive: true });
  await fsp.writeFile(bridgeFile(), JSON.stringify({ code }, null, 2), 'utf8');
  return code;
}

/** The packaged .eext: next to the app in production, in easyeda-extension/dist during development. */
function extensionFile(): string | null {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'benchtop-easyeda.eext'),
    path.join(app.getAppPath(), 'easyeda-extension', 'dist', 'benchtop-easyeda.eext'),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

function bridgeInfo() {
  return { ...(bridge?.state ?? { listening: false, port: 0, clients: 0, error: 'Not started', lastSeen: null, extensionVersion: null }), code: pairingCode, extensionFile: extensionFile() };
}

function focusWindow() {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

async function startBridge() {
  pairingCode = await loadPairingCode();
  bridge = new EasyEdaBridge({
    appVersion: app.getVersion(),
    getToken: () => pairingCode,
    getRoot: () => store.root,
    getProjects: () => store.all().map((p) => ({ path: p.path, name: p.name, group: p.group, easyeda: p.meta.easyeda ?? [] })),
    setLinks: async (projectPath, names) => {
      const { meta } = await readMeta(projectPath);
      await store.saveMeta(projectPath, { ...meta, easyeda: names });
    },
    exported: async (projectPath, relDir, written, failed) => {
      // An export into releases/<date>/ starts that release's release.yaml (date + firmware commit).
      if (written.length && /^releases?[\\/]/i.test(relDir)) {
        await releases.initRelease(projectPath, path.join(projectPath, relDir)).catch(() => undefined);
      }
      void store.refreshProject(projectPath);
      broadcast('easyeda:exported', { projectPath, relDir: relDir.split(path.sep).join('/'), written, failed });
    },
    open: (projectPath) => {
      focusWindow();
      broadcast('app:navigate', { projectPath });
    },
    clientsChanged: () => broadcast('easyeda:bridge', bridgeInfo()),
  });
  await bridge.start();
  broadcast('easyeda:bridge', bridgeInfo());
}

function broadcast(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
}

async function requireInsideRoot(target: unknown): Promise<string> {
  if (typeof target !== 'string' || !target) throw new Error('Invalid path');
  const { root } = await loadSettings();
  if (!root || !isInside(root, target)) throw new Error('Path is outside the projects folder');
  return path.resolve(target);
}

/** A project folder Benchtop knows about (not just any folder in the root). */
async function requireProject(target: unknown): Promise<string> {
  const p = await requireInsideRoot(target);
  if (!store.get(p)) throw new Error('Unknown project');
  return p;
}

function registerProtocol() {
  protocol.handle('benchtop', async (request) => {
    const url = new URL(request.url);
    let target: string;
    try {
      target = await requireInsideRoot(decodeURIComponent(url.pathname.slice(1)));
    } catch {
      return new Response('Forbidden', { status: 403 });
    }
    if (url.host === 'thumb') {
      const size = Math.min(Number(url.searchParams.get('s')) || 400, 1024);
      try {
        // Uses the Windows/macOS thumbnail cache; fast even for large photos.
        const img = await nativeImage.createThumbnailFromPath(target, { width: size, height: size });
        if (!img.isEmpty()) {
          return new Response(new Uint8Array(img.toPNG()), { headers: { 'content-type': 'image/png' } });
        }
      } catch {
        /* not supported on this OS or file type: fall through to the original */
      }
    }
    // A missing file (an image a README points to that isn't there, a cover that was deleted…)
    // is a plain 404 for the page, not an error in the terminal.
    if (!existsSync(target)) return new Response('Not found', { status: 404 });
    try {
      return await net.fetch(pathToFileURL(target).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function registerIpc() {
  ipcMain.handle('settings:get', () => loadSettings());
  ipcMain.handle('settings:update', (_e, patch: unknown) =>
    updateSettings(patch && typeof patch === 'object' ? (patch as Parameters<typeof updateSettings>[0]) : {}),
  );

  ipcMain.handle('settings:chooseRoot', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const current = await loadSettings();
    const options: Electron.OpenDialogOptions = {
      title: 'Choose your projects folder',
      defaultPath: current.root ?? app.getPath('desktop'),
      properties: ['openDirectory'],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    await saveSettings({ ...current, root: result.filePaths[0] });
    return result.filePaths[0];
  });

  ipcMain.handle('projects:list', async () => {
    const { root } = await loadSettings();
    return root ? store.list(root) : [];
  });
  ipcMain.handle('projects:rescan', async () => {
    const { root } = await loadSettings();
    if (!root) return [];
    await store.list(root);
    return store.rescan();
  });

  ipcMain.handle('fs:listDir', async (_e, dir: unknown) => listDir(await requireInsideRoot(dir)));
  ipcMain.handle('fs:readText', async (_e, file: unknown) => readText(await requireInsideRoot(file)));

  ipcMain.handle('meta:save', async (_e, projectPath: unknown, meta: unknown) =>
    store.saveMeta(await requireInsideRoot(projectPath), (meta ?? {}) as ProjectMeta),
  );
  ipcMain.handle('notes:read', async (_e, projectPath: unknown) => store.readNotes(await requireInsideRoot(projectPath)));
  ipcMain.handle('notes:save', async (_e, projectPath: unknown, content: unknown) =>
    store.saveNotes(await requireInsideRoot(projectPath), typeof content === 'string' ? content : ''),
  );

  ipcMain.handle('find:quick', (_e, query: unknown) => store.quickFind(typeof query === 'string' ? query : ''));
  ipcMain.handle('find:search', async (_e, query: unknown, opts: unknown) => {
    const o = (opts ?? {}) as { projectPath?: string; caseSensitive?: boolean };
    const projectPath = o.projectPath ? await requireInsideRoot(o.projectPath) : undefined;
    return store.search(typeof query === 'string' ? query : '', { projectPath, caseSensitive: !!o.caseSensitive });
  });

  ipcMain.handle('shell:openPath', async (_e, target: unknown) => {
    const error = await shell.openPath(await requireInsideRoot(target));
    if (error) throw new Error(error);
  });
  ipcMain.handle('shell:showInFolder', async (_e, target: unknown) => {
    shell.showItemInFolder(await requireInsideRoot(target));
  });
  ipcMain.handle('shell:openInEditor', async (_e, target: unknown) => openInEditor(await requireInsideRoot(target)));
  ipcMain.handle('shell:openTerminal', async (_e, target: unknown) => openTerminal(await requireInsideRoot(target)));
  // ---- New project / structure
  const undoDir = () => path.join(app.getPath('userData'), 'undo');
  ipcMain.handle('structure:create', async (_e, input: NewProjectInput) => {
    const parent = await requireInsideRoot(input?.parentDir);
    const dir = await createProject({ ...input, parentDir: parent });
    if (input.gitInit && (await publisher.gitAvailable())) {
      await publisher.run('git', ['init', '-b', 'main'], dir);
      await ensureExcluded(dir);
    }
    await store.rescan();
    return dir;
  });
  ipcMain.handle('structure:plan', async (_e, projectPath: unknown) => planStructure(await requireProject(projectPath)));
  ipcMain.handle('structure:apply', async (_e, projectPath: unknown, moves: MoveItem[]) => {
    const p = await requireProject(projectPath);
    const result = await applyPlan(p, Array.isArray(moves) ? moves : [], undoDir());
    await store.refreshProject(p);
    return result;
  });
  ipcMain.handle('structure:canUndo', async (_e, projectPath: unknown) => canUndo(await requireProject(projectPath), undoDir()));
  ipcMain.handle('structure:undo', async (_e, projectPath: unknown) => {
    const p = await requireProject(projectPath);
    const result = await undoPlan(p, undoDir());
    await store.refreshProject(p);
    return result;
  });

  ipcMain.handle('structure:setGroup', async (_e, folderPath: unknown, isGroup: unknown) =>
    store.setGroup(await requireInsideRoot(folderPath), isGroup === true),
  );

  // ---- EasyEDA
  let eeCache: { at: number; status: EasyEdaStatus } | null = null;
  const eeStatus = async (refresh = false) => {
    if (!refresh && eeCache && Date.now() - eeCache.at < 30000) return eeCache.status;
    const status = await easyeda.readStatus(app.getPath('documents'));
    eeCache = { at: Date.now(), status };
    return status;
  };
  ipcMain.handle('easyeda:status', (_e, refresh: unknown) => eeStatus(refresh === true));
  ipcMain.handle('easyeda:suggest', async () => {
    const status = await eeStatus();
    // Projects already linked keep their link; suggest only for the others.
    const linked = new Map<string, string>();
    for (const p of store.all()) for (const n of p.meta.easyeda ?? []) linked.set(n.toLowerCase(), p.path);
    const suggestions = easyeda.suggestMatches(status.projects, store.all());
    for (const e of status.projects) {
      const l = linked.get(e.name.toLowerCase());
      if (l) suggestions[e.name] = l;
    }
    return suggestions;
  });
  ipcMain.handle('easyeda:link', async (_e, links: unknown) => {
    const map = (links && typeof links === 'object' ? links : {}) as Record<string, string[]>;
    for (const [projectPath, names] of Object.entries(map)) {
      const p = await requireProject(projectPath);
      const { meta } = await readMeta(p);
      await store.saveMeta(p, { ...meta, easyeda: Array.isArray(names) ? names.map(String) : [] });
    }
  });
  ipcMain.handle('fs:readBinary', async (_e, filePath: unknown) => {
    const p = await requireInsideRoot(filePath);
    const st = await fsp.stat(p);
    if (st.size > 400 * 1024 * 1024) throw new Error('This file is too large to preview.');
    return fsp.readFile(p);
  });
  // WebAssembly files bundled with the window (the STEP reader). Only .wasm, only from its assets folder.
  ipcMain.handle('app:asset', async (_e, name: unknown) => {
    if (typeof name !== 'string' || !/^[\w.-]+\.wasm$/.test(name)) throw new Error('Bad asset');
    return fsp.readFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/assets`, name));
  });
  ipcMain.handle('releases:list', async (_e, projectPath: unknown) => releases.getReleases(await requireProject(projectPath)));
  ipcMain.handle('releases:create', async (_e, projectPath: unknown, input: NewReleaseInput) => {
    const p = await requireProject(projectPath);
    const r = await releases.createRelease(p, input);
    void store.refreshProject(p);
    return r;
  });
  ipcMain.handle('releases:save', async (_e, projectPath: unknown, relDir: unknown, info: ReleaseInfo) => {
    if (typeof relDir !== 'string') throw new Error('Bad release');
    await releases.saveRelease(await requireProject(projectPath), relDir, info);
  });
  ipcMain.handle('releases:snapshot', async (_e, projectPath: unknown, relDir: unknown) => {
    if (typeof relDir !== 'string') throw new Error('Bad release');
    return releases.snapshotInto(await requireProject(projectPath), relDir);
  });
  ipcMain.handle('zip:info', async (_e, zipPath: unknown) => zipInfo(await requireInsideRoot(zipPath)));
  ipcMain.handle('gerber:render', async (_e, zipPath: unknown) => renderGerberZip(await requireInsideRoot(zipPath)));
  ipcMain.handle('easyeda:bridgeInfo', () => bridgeInfo());
  ipcMain.handle('easyeda:newPairingCode', async () => {
    pairingCode = await savePairingCode(newPairingCode());
    bridge?.dropClients();
    return bridgeInfo();
  });
  ipcMain.handle('easyeda:restartBridge', async () => {
    await bridge?.stop();
    await startBridge();
    return bridgeInfo();
  });
  ipcMain.handle('easyeda:showExtension', () => {
    const f = extensionFile();
    if (f) shell.showItemInFolder(f);
  });
  ipcMain.handle('clipboard:write', (_e, text: unknown) => {
    if (typeof text === 'string') clipboard.writeText(text);
  });
  ipcMain.handle('easyeda:fabFiles', async (_e, projectPath: unknown) => easyeda.findFabFiles(await requireProject(projectPath)));
  ipcMain.handle('easyeda:copyBackup', async (_e, projectPath: unknown, name: unknown) => {
    const p = await requireProject(projectPath);
    const status = await eeStatus(true);
    const project = status.projects.find((x) => x.name === name);
    if (!project?.latest) throw new Error('No EasyEDA backup found for that project.');
    const dest = await easyeda.copyBackup(project.latest.path, p);
    await store.refreshProject(p);
    return dest;
  });
  ipcMain.handle('easyeda:open', async (_e, projectPath: unknown) => {
    const p = await requireProject(projectPath);
    const summary = store.get(p);
    // 1. A link saved in project.yaml (e.g. the editor URL of this board)
    const link = summary?.meta.links?.find((l) => /easyeda|lceda/i.test(l.label) || /easyeda\.com|lceda\.cn/i.test(l.url));
    if (link && /^https?:\/\//i.test(link.url)) return void (await shell.openExternal(link.url));
    // 2. A local project file in the project, or one linked from EasyEDA's own folder
    const fab = await easyeda.findFabFiles(p);
    const eprj = fab.find((f) => /\.eprj$/i.test(f.name))?.path;
    const status = await eeStatus();
    const linkedEprj = status.projects.find((x) => summary?.meta.easyeda?.includes(x.name) && x.eprj)?.eprj;
    const local = eprj ?? linkedEprj;
    if (local) {
      const err = await shell.openPath(local);
      if (!err) return;
    }
    // 3. The EasyEDA Pro editor
    await shell.openExternal('https://pro.easyeda.com/editor');
  });

  // ---- GitHub
  ipcMain.handle('github:status', () => github.status());
  ipcMain.handle('github:setToken', (_e, token: unknown) => github.setToken(typeof token === 'string' ? token : ''));
  ipcMain.handle('github:useCli', () => github.useCli());
  ipcMain.handle('github:signOut', () => github.signOut());
  ipcMain.handle('publish:precheck', async (_e, projectPath: unknown) => publisher.precheck(await requireProject(projectPath)));
  ipcMain.handle('publish:run', async (event, projectPath: unknown, opts: PublishOptions) => {
    const p = await requireProject(projectPath);
    const token = await github.getToken();
    if (!token) throw new Error('Connect your GitHub account first.');
    try {
      return await publisher.publish(p, opts, token, (msg) => event.sender.send('publish:progress', msg));
    } finally {
      await store.refreshProject(p);
    }
  });
  ipcMain.handle('git:changes', async (_e, projectPath: unknown) => publisher.changes(await requireProject(projectPath)));
  ipcMain.handle('git:commitPush', async (_e, projectPath: unknown, message: unknown) => {
    const p = await requireProject(projectPath);
    try {
      return await publisher.commitAndPush(p, typeof message === 'string' ? message : '', await github.getToken());
    } finally {
      await store.refreshProject(p);
    }
  });
  ipcMain.handle('git:pull', async (_e, projectPath: unknown) => {
    const p = await requireProject(projectPath);
    try {
      return await publisher.pull(p, await github.getToken());
    } finally {
      await store.refreshProject(p);
    }
  });

  ipcMain.handle('shell:openExternal', async (_e, url: unknown) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) await shell.openExternal(url);
  });
}

function createWindow() {
  nativeTheme.themeSource = 'system';
  // In development the window would show Electron's icon; the packaged app embeds assets/icon.ico.
  const devIcon = path.join(app.getAppPath(), 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  const win = new BrowserWindow({
    ...(existsSync(devIcon) ? { icon: devIcon } : {}),
    width: 1320,
    height: 860,
    minWidth: 760,
    minHeight: 500,
    title: 'Benchtop',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181d' : '#f6f7f9',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Chromium's built-in PDF viewer (schematics, datasheets) in the preview pane.
      plugins: true,
    },
  });

  // Links (e.g. in READMEs) open in the real browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
}

app.whenReady().then(() => {
  if (!isPrimary) return;
  // Installed app only: check GitHub releases (through update.electronjs.org) at start and every hour,
  // download new versions in the background and offer to restart. Nothing happens under `npm start`.
  if (app.isPackaged && process.platform !== 'linux') {
    updateElectronApp({
      updateSource: { type: UpdateSourceType.ElectronPublicUpdateService, repo: 'loic-daigle/benchtop' },
      updateInterval: '1 hour',
      onNotifyUser: makeUserNotifier({
        title: 'Benchtop update',
        detail: 'A new version of Benchtop has been downloaded. Restart to use it.',
        restartButtonText: 'Restart now',
        laterButtonText: 'Later',
      }),
    });
  }
  store = new ProjectStore(path.join(app.getPath('userData'), 'projects-cache.json'), {
    projects: (list) => broadcast('projects:updated', list),
    fsChanged: (change) => broadcast('fs:changed', change),
  });
  registerProtocol();
  registerIpc();
  createWindow();
  void startBridge();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  store?.dispose();
  void bridge?.stop();
  if (process.platform !== 'darwin') app.quit();
});
