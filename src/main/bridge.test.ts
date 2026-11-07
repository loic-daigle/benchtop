import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import WebSocket from 'ws';
import { BRIDGE_PATH } from '../shared/easyedaProtocol';
import { EasyEdaBridge, freeName, newPairingCode, pcbDir, safeFileName, type BridgeProject } from './bridge';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'benchtop-bridge-'));

function setup() {
  const root = tmp();
  const projects: BridgeProject[] = [
    { path: path.join(root, 'Desk USB-C PD Hub'), name: 'Desk USB-C PD Hub', group: null, easyeda: [] },
    { path: path.join(root, 'PartSense', 'Cabinet'), name: 'Cabinet', group: 'PartSense', easyeda: ['Cabinet-PCB'] },
  ];
  for (const p of projects) mkdirSync(p.path, { recursive: true });
  mkdirSync(path.join(projects[1].path, 'PCB'));
  const events: string[] = [];
  const pairing = ['ABCD', 'EFGH', 'JKLM', 'NPQR'].join('-'); // test pairing code
  const token = pairing;
  const bridge = new EasyEdaBridge(
    {
      appVersion: 'test',
      getToken: () => token,
      getRoot: () => root,
      getProjects: () => projects,
      setLinks: async (p, names) => {
        projects.find((x) => x.path === p)!.easyeda = names;
      },
      exported: (p, rel, written) => void events.push(`exported ${path.basename(p)} ${rel} ${written.length}`),
      open: (p) => void events.push(`open ${path.basename(p)}`),
    },
    0, // any free port
  );
  return { root, projects, events, token, bridge };
}

function client(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${BRIDGE_PATH}`);
  const inbox: any[] = [];
  const waiters: Array<(m: any) => void> = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    const w = waiters.shift();
    if (w) w(m);
    else inbox.push(m);
  });
  const next = () => new Promise<any>((resolve) => (inbox.length ? resolve(inbox.shift()) : waiters.push(resolve)));
  let id = 0;
  const call = async (msg: object) => {
    const mid = String(++id);
    ws.send(JSON.stringify({ ...msg, id: mid }));
    const reply = await next();
    assert.equal(reply.id, mid);
    return reply;
  };
  const opened = new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
  return { ws, next, call, opened, closed };
}

test('pairing code format', () => {
  const c = newPairingCode();
  assert.match(c, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.notEqual(c, newPairingCode());
});

test('file names and folders', async () => {
  assert.equal(safeFileName('../../evil.zip'), 'evil.zip');
  assert.equal(safeFileName('C:\\x\\Gerber_A.zip'), 'Gerber_A.zip');
  assert.equal(safeFileName('a:b?.csv'), 'a_b_.csv');
  assert.equal(safeFileName('...'), 'export');
  const dir = tmp();
  writeFileSync(path.join(dir, 'g.zip'), 'x');
  writeFileSync(path.join(dir, 'g_2.zip'), 'x');
  assert.equal(await freeName(dir, 'g.zip'), 'g_3.zip');
  assert.equal(await pcbDir(dir), 'pcb');
  mkdirSync(path.join(dir, 'Hardware'));
  assert.equal(await pcbDir(dir), 'Hardware');
});

test('wrong pairing code is refused', async () => {
  const { bridge } = setup();
  await bridge.start();
  const c = client(bridge.state.port);
  await c.opened;
  c.ws.send(JSON.stringify({ type: 'hello', token: ['n', 'o', 'p', 'e'].join(''), extensionVersion: '1' }));
  assert.equal((await c.next()).type, 'denied');
  assert.equal(await c.closed, 4001);
  // A request before hello is refused and the socket closed, nothing answered.
  const d = client(bridge.state.port);
  await d.opened;
  d.ws.send(JSON.stringify({ type: 'lookup', id: '1', project: { name: 'x' } }));
  assert.equal((await d.next()).type, 'denied');
  assert.equal(await d.closed, 4001);
  await bridge.stop();
});

test('lookup, link, export and open', async () => {
  const { bridge, projects, events, token } = setup();
  await bridge.start();
  assert.equal(bridge.state.listening, true);
  const c = client(bridge.state.port);
  await c.opened;
  c.ws.send(JSON.stringify({ type: 'hello', token: token.toLowerCase(), extensionVersion: '1.0.0' }));
  assert.equal((await c.next()).type, 'welcome');
  assert.equal(bridge.state.clients, 1);

  // Already linked by name
  let r = await c.call({ type: 'lookup', project: { uuid: 'u', name: 'cabinet-pcb', friendlyName: 'Cabinet PCB' } });
  assert.equal(r.ok, true);
  assert.equal(r.data.linked.label, 'PartSense / Cabinet');

  // Not linked: a suggestion by name
  r = await c.call({ type: 'lookup', project: { uuid: 'u2', name: 'Desk-USB-C-PD-Hub', friendlyName: 'Desk USB-C PD Hub' } });
  assert.equal(r.data.linked, null);
  assert.equal(r.data.suggestion, projects[0].path);
  assert.equal(r.data.projects.length, 2);

  // Link moves the name away from any other project
  r = await c.call({ type: 'link', project: { uuid: 'u', name: 'Cabinet-PCB', friendlyName: 'x' }, projectPath: projects[0].path });
  assert.equal(r.ok, true);
  assert.deepEqual(projects[0].easyeda, ['Cabinet-PCB']);
  assert.deepEqual(projects[1].easyeda, []);

  // Unknown / outside paths are refused
  r = await c.call({ type: 'beginExport', projectPath: os.tmpdir(), target: 'pcb' });
  assert.equal(r.ok, false);

  // Export into the existing PCB folder; the project file goes to PCB/easyeda; nothing overwritten
  r = await c.call({ type: 'beginExport', projectPath: projects[1].path, target: 'pcb' });
  assert.equal(r.data.relDir, 'PCB');
  const exportId = r.data.exportId;
  const data = Buffer.from('hello gerber').toString('base64');
  r = await c.call({ type: 'file', exportId, kind: 'gerber', name: 'Gerber_Cab.zip', data });
  assert.equal(r.data.path, 'PCB/Gerber_Cab.zip');
  r = await c.call({ type: 'file', exportId, kind: 'gerber', name: '../../Gerber_Cab.zip', data });
  assert.equal(r.data.path, 'PCB/Gerber_Cab_2.zip');
  r = await c.call({ type: 'file', exportId, kind: 'project', name: 'Cab.epro', data });
  assert.equal(r.data.path, 'PCB/easyeda/Cab.epro');
  r = await c.call({ type: 'endExport', exportId, failed: [{ kind: 'step', error: 'no 3D' }] });
  assert.equal(r.data.written.length, 3);
  assert.equal(readFileSync(path.join(projects[1].path, 'PCB', 'Gerber_Cab.zip'), 'utf8'), 'hello gerber');
  assert.deepEqual(events, ['exported Cabinet PCB 3']);

  // Releases get a dated folder, a second one the same day gets -2
  r = await c.call({ type: 'beginExport', projectPath: projects[0].path, target: 'release' });
  const rel1 = r.data.relDir;
  assert.match(rel1, /^releases\/\d{4}-\d{2}-\d{2}$/);
  await c.call({ type: 'file', exportId: r.data.exportId, kind: 'bom', name: 'BOM.csv', data });
  await c.call({ type: 'endExport', exportId: r.data.exportId, failed: [] });
  r = await c.call({ type: 'beginExport', projectPath: projects[0].path, target: 'release' });
  assert.equal(r.data.relDir, `${rel1}-2`);
  assert.deepEqual(readdirSync(path.join(projects[0].path, rel1)), ['BOM.csv']);

  // Expired export id
  r = await c.call({ type: 'file', exportId: 'nope', kind: 'bom', name: 'x.csv', data });
  assert.equal(r.ok, false);

  r = await c.call({ type: 'open', projectPath: projects[0].path });
  assert.equal(r.ok, true);
  assert.equal(events.at(-1), 'open Desk USB-C PD Hub');

  c.ws.close();
  await c.closed;
  await new Promise((r2) => setTimeout(r2, 50));
  assert.equal(bridge.state.clients, 0);
  await bridge.stop();
});

test('port already in use is reported, not thrown', async () => {
  const a = setup().bridge;
  await a.start();
  const b = new EasyEdaBridge(
    { appVersion: 't', getToken: () => 'x', getRoot: () => null, getProjects: () => [], setLinks: async () => {}, exported: () => {}, open: () => {} },
    a.state.port,
  );
  await b.start();
  assert.equal(b.state.listening, false);
  assert.match(b.state.error ?? '', /already in use/);
  await a.stop();
  await b.stop();
});
