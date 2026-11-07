/**
 * Benchtop extension for EasyEDA Pro (v3).
 *
 * Menu "Benchtop" (home, schematic and PCB editors):
 *  - Export to Benchtop…   exports Gerber, BOM, pick & place, schematic PDF, STEP and the .epro
 *                          straight into the linked Benchtop project (pcb/ or releases/<date>/)
 *  - Open in Benchtop      brings Benchtop to the front on this project
 *  - Link to a Benchtop project…
 *  - Connect to Benchtop…  pairing code (once)
 *
 * Talks to Benchtop over a WebSocket on 127.0.0.1 (see src/shared/easyedaProtocol.ts).
 * Requires "Allow external interaction" for this extension in EasyEDA's Extension Manager.
 */
import extensionConfig from '../extension.json' with { type: 'json' };
import {
  BRIDGE_PATH,
  BRIDGE_PORT,
  type BeginExportResult,
  type BenchtopMessage,
  type EeProjectRef,
  type EndExportResult,
  type ExportKind,
  type ExportTarget,
  type ExtensionMessage,
  type LookupResult,
} from '../../src/shared/easyedaProtocol';

const WS_ID = 'benchtop-bridge';
const TOKEN_KEY = 'pairingCode';
const KINDS_KEY = 'lastExportKinds';
const CONNECT_TIMEOUT = 5000;
const TITLE = 'Benchtop';

const NOT_RUNNING =
  'Can’t reach Benchtop. Make sure the Benchtop app is open on this computer, then try again.';
const EXTERNAL_DISABLED =
  'EasyEDA blocked the connection. Open Settings → Extensions → Extension Manager, click Benchtop, ' +
  'and in its Config tab tick “Allow external interaction”. Then try again.';

// ---------------------------------------------------------------- small helpers

// The enums are declared as globals in the type package; use their values so the
// bundle never depends on them existing at runtime.
const TOAST = {
  INFO: 'info' as ESYS_ToastMessageType,
  SUCCESS: 'success' as ESYS_ToastMessageType,
};
const MM = 'mm' as ESYS_Unit.MILLIMETER;

function toast(message: string, type: ESYS_ToastMessageType = TOAST.INFO): void {
  eda.sys_Message.showToastMessage(message, type);
}

function inform(message: string, title = TITLE): void {
  eda.sys_Dialog.showInformationMessage(message, title);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function selectOne(
  options: Array<{ value: string; displayContent: string }>,
  before: string,
  title: string,
  defaultOption?: string,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    eda.sys_Dialog.showSelectDialog(options, before, '', title, defaultOption, false, (value: string) => resolve(value || undefined));
  });
}

function selectMany(
  options: Array<{ value: string; displayContent: string }>,
  before: string,
  title: string,
  defaults: Array<string>,
): Promise<Array<string> | undefined> {
  return new Promise((resolve) => {
    eda.sys_Dialog.showSelectDialog(options, before, '', title, defaults, true, (value: Array<string>) => resolve(value));
  });
}

function inputText(before: string, title: string, placeholder: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    eda.sys_Dialog.showInputDialog(before, '', title, 'text', '', { placeholder }, (value: unknown) =>
      resolve(typeof value === 'string' && value.trim() ? value.trim() : undefined),
    );
  });
}

/** Base64 without relying on btoa (not guaranteed in the extension runtime). */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function toBase64(bytes: Uint8Array): string {
  const out: Array<string> = [];
  let chunk = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    chunk +=
      B64[(n >> 18) & 63] +
      B64[(n >> 12) & 63] +
      (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') +
      (i + 2 < bytes.length ? B64[n & 63] : '=');
    if (chunk.length >= 65536) {
      out.push(chunk);
      chunk = '';
    }
  }
  out.push(chunk);
  return out.join('');
}

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'Project';
}

// ---------------------------------------------------------------- connection

type Pending = { resolve: (data: unknown) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> };

let ready = false;
let connecting: Promise<void> | null = null;
let onWelcome: (() => void) | null = null;
let onDenied: ((error: string) => void) | null = null;
const pending = new Map<string, Pending>();
let seq = 0;

function handleMessage(event: MessageEvent<any>): void {
  let msg: BenchtopMessage;
  try {
    msg = JSON.parse(typeof event.data === 'string' ? event.data : '');
  }
  catch {
    return;
  }
  if (msg.type === 'welcome') {
    ready = true;
    onWelcome?.();
  }
  else if (msg.type === 'denied') {
    ready = false;
    onDenied?.(msg.error);
  }
  else if (msg.type === 'reply') {
    const p = pending.get(msg.id);
    if (!p)
      return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ok)
      p.resolve(msg.data);
    else p.reject(new Error(msg.error));
  }
}

function send(message: ExtensionMessage): void {
  eda.sys_WebSocket.send(WS_ID, JSON.stringify(message));
}

async function askPairingCode(): Promise<string | undefined> {
  return inputText(
    'In Benchtop, click the chip icon at the top of the dashboard and copy the pairing code shown under “EasyEDA extension”. Paste it here:',
    'Connect to Benchtop',
    'XXXX-XXXX-XXXX-XXXX',
  );
}

async function ensureConnected(): Promise<void> {
  if (ready)
    return;
  if (connecting)
    return connecting;

  let token = eda.sys_Storage.getExtensionUserConfig(TOKEN_KEY) as string | undefined;
  if (!token) {
    token = await askPairingCode();
    if (!token)
      throw new Error('cancelled');
    await eda.sys_Storage.setExtensionUserConfig(TOKEN_KEY, token);
  }
  const code = token;

  connecting = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(NOT_RUNNING)), CONNECT_TIMEOUT);
    onWelcome = () => {
      clearTimeout(timer);
      resolve();
    };
    onDenied = (error) => {
      clearTimeout(timer);
      void eda.sys_Storage.deleteExtensionUserConfig(TOKEN_KEY);
      reject(new Error(`${error} Use Benchtop → Connect to Benchtop… to enter the current code.`));
    };
    try {
      try {
        eda.sys_WebSocket.close(WS_ID);
      }
      catch {
        /* nothing open */
      }
      eda.sys_WebSocket.register(WS_ID, `ws://127.0.0.1:${BRIDGE_PORT}${BRIDGE_PATH}`, handleMessage, () => {
        send({ type: 'hello', token: code, extensionVersion: extensionConfig.version });
      });
    }
    catch {
      clearTimeout(timer);
      reject(new Error(EXTERNAL_DISABLED));
    }
  }).finally(() => {
    connecting = null;
    onWelcome = null;
  });
  return connecting;
}

type Outgoing = ExtensionMessage extends infer M ? (M extends { id: string } ? Omit<M, 'id'> : never) : never;

/** Sends a request and waits for its reply. */
function request<T>(message: Outgoing, timeoutMs = 30000): Promise<T> {
  const id = String(++seq);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      ready = false; // Benchtop was probably closed; reconnect next time
      reject(new Error(NOT_RUNNING));
    }, timeoutMs);
    pending.set(id, { resolve: resolve as (d: unknown) => void, reject, timer });
    try {
      send({ ...message, id } as ExtensionMessage);
    }
    catch (err) {
      clearTimeout(timer);
      pending.delete(id);
      ready = false;
      reject(new Error(errorText(err)));
    }
  });
}

// ---------------------------------------------------------------- project link

async function currentProject(): Promise<EeProjectRef> {
  const info = await eda.dmt_Project.getCurrentProjectInfo();
  if (!info)
    throw new Error('Open a project first.');
  return { uuid: info.uuid, name: info.name, friendlyName: info.friendlyName };
}

async function chooseBenchtopProject(project: EeProjectRef, lookup: LookupResult): Promise<string | undefined> {
  if (!lookup.projects.length)
    throw new Error('Benchtop has no projects yet. Check its projects folder.');
  const chosen = await selectOne(
    lookup.projects.map((p) => ({ value: p.path, displayContent: p.label })),
    `Which Benchtop project is “${project.friendlyName}”? This is saved in its project.yaml, so you only choose once.`,
    'Link to a Benchtop project',
    lookup.linked?.path ?? lookup.suggestion ?? undefined,
  );
  if (!chosen)
    return undefined;
  await request({ type: 'link', project, projectPath: chosen });
  return chosen;
}

/** The linked Benchtop project, asking once if needed. */
async function linkedProject(project: EeProjectRef, forceChoose = false): Promise<{ path: string; label: string } | undefined> {
  const lookup = await request<LookupResult>({ type: 'lookup', project });
  if (lookup.linked && !forceChoose)
    return lookup.linked;
  const path = await chooseBenchtopProject(project, lookup);
  if (!path)
    return undefined;
  return lookup.projects.find((p) => p.path === path);
}

// ---------------------------------------------------------------- export

const KIND_OPTIONS: Array<{ value: ExportKind; displayContent: string }> = [
  { value: 'gerber', displayContent: 'Gerber (zip)' },
  { value: 'bom', displayContent: 'BOM (csv)' },
  { value: 'pnp', displayContent: 'Pick & place (csv)' },
  { value: 'schematic', displayContent: 'Schematic (pdf)' },
  { value: 'step', displayContent: '3D model (step)' },
  { value: 'project', displayContent: 'EasyEDA project file (epro), a backup of the design' },
];
const DEFAULT_KINDS: Array<ExportKind> = ['gerber', 'bom', 'pnp', 'schematic', 'project'];

async function makeFile(kind: ExportKind, base: string): Promise<File | undefined> {
  switch (kind) {
    case 'gerber':
      return eda.pcb_ManufactureData.getGerberFile(`Gerber_${base}`);
    case 'bom':
      return eda.pcb_ManufactureData.getBomFile(`BOM_${base}`, 'csv');
    case 'pnp':
      return eda.pcb_ManufactureData.getPickAndPlaceFile(`PickAndPlace_${base}`, 'csv', MM);
    case 'schematic':
      return eda.sch_ManufactureData.getPdfFile(`Schematic_${base}`, undefined, 'All Schematic');
    case 'step':
      return eda.pcb_ManufactureData.get3DFile(`3D_${base}`, 'step');
    case 'project':
      return eda.sys_FileManager.getProjectFile(base, undefined, 'epro');
  }
}

const EXT: Record<ExportKind, string> = { gerber: 'zip', bom: 'csv', pnp: 'csv', schematic: 'pdf', step: 'step', project: 'epro' };

export async function exportToBenchtop(): Promise<void> {
  try {
    await ensureConnected();
    const project = await currentProject();
    const target = await linkedProject(project);
    if (!target)
      return;

    const remembered = eda.sys_Storage.getExtensionUserConfig(KINDS_KEY) as Array<string> | undefined;
    const kinds = (await selectMany(
      KIND_OPTIONS,
      `Export “${project.friendlyName}” to ${target.label}. Run this from the PCB editor so the board files can be made.`,
      'Export to Benchtop',
      remembered?.length ? remembered : DEFAULT_KINDS,
    )) as Array<ExportKind> | undefined;
    if (!kinds?.length)
      return;
    await eda.sys_Storage.setExtensionUserConfig(KINDS_KEY, kinds);

    const where = (await selectOne(
      [
        { value: 'pcb', displayContent: 'pcb/  (working files, updated as the board changes)' },
        { value: 'release', displayContent: `releases/${today()}/  (the exact files of an order)` },
      ],
      'Where should the files go in the project?',
      'Export to Benchtop',
      'pcb',
    )) as ExportTarget | undefined;
    if (!where)
      return;

    const begin = await request<BeginExportResult>({ type: 'beginExport', projectPath: target.path, target: where });
    const base = `${safeName(project.name || project.friendlyName)}_${today()}`;
    const failed: Array<{ kind: ExportKind; error: string }> = [];

    for (const kind of kinds) {
      eda.sys_Message.showToastMessage(`Benchtop: making ${KIND_OPTIONS.find((k) => k.value === kind)?.displayContent ?? kind}…`, TOAST.INFO);
      try {
        const file = await makeFile(kind, base);
        if (!file)
          throw new Error('EasyEDA returned no file (open the PCB or schematic first)');
        const bytes = new Uint8Array(await file.arrayBuffer());
        const name = file.name && /\.\w+$/.test(file.name) ? file.name : `${file.name || base}.${EXT[kind]}`;
        await request({ type: 'file', exportId: begin.exportId, kind, name, data: toBase64(bytes) }, 120000);
      }
      catch (err) {
        failed.push({ kind, error: errorText(err) });
      }
    }

    const end = await request<EndExportResult>({ type: 'endExport', exportId: begin.exportId, failed });
    if (failed.length) {
      inform(
        `Saved ${end.written.length} file(s) to ${target.label}/${end.relDir}.\n\nNot exported:\n${failed
          .map((f) => `• ${f.kind}: ${f.error}`)
          .join('\n')}`,
      );
    }
    else {
      toast(`Saved ${end.written.length} files to ${target.label}/${end.relDir}`, TOAST.SUCCESS);
    }
  }
  catch (err) {
    if (errorText(err) !== 'cancelled')
      inform(errorText(err));
  }
}

export async function openInBenchtop(): Promise<void> {
  try {
    await ensureConnected();
    const project = await currentProject();
    const target = await linkedProject(project);
    if (target)
      await request({ type: 'open', projectPath: target.path });
  }
  catch (err) {
    if (errorText(err) !== 'cancelled')
      inform(errorText(err));
  }
}

export async function linkToBenchtop(): Promise<void> {
  try {
    await ensureConnected();
    const project = await currentProject();
    const target = await linkedProject(project, true);
    if (target)
      toast(`“${project.friendlyName}” is linked to ${target.label}`, TOAST.SUCCESS);
  }
  catch (err) {
    if (errorText(err) !== 'cancelled')
      inform(errorText(err));
  }
}

export async function connectToBenchtop(): Promise<void> {
  const code = await askPairingCode();
  if (!code)
    return;
  await eda.sys_Storage.setExtensionUserConfig(TOKEN_KEY, code);
  ready = false;
  try {
    await ensureConnected();
    toast('Connected to Benchtop', TOAST.SUCCESS);
  }
  catch (err) {
    inform(errorText(err));
  }
}

export function about(): void {
  inform(
    `Benchtop for EasyEDA v${extensionConfig.version}\n\nExports your board files straight into your Benchtop project folder.`,
    'About Benchtop',
  );
}

// eslint-disable-next-line unused-imports/no-unused-vars
export function activate(_status?: 'onStartupFinished', _arg?: string): void {}
