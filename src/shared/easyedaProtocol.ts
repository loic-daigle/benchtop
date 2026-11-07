/**
 * Messages between the Benchtop EasyEDA extension and the Benchtop app.
 * Transport: WebSocket on 127.0.0.1 (the only network access EasyEDA extensions get,
 * after "Allow external interaction" is enabled). Every message is JSON.
 */

export const BRIDGE_PORT = 47652;
export const BRIDGE_PATH = '/easyeda';

export interface EeProjectRef {
  uuid: string;
  /** Project name as used for EasyEDA's backup folders, e.g. "Smart-Scroll-Wheel". */
  name: string;
  /** Display name, e.g. "Smart Scroll Wheel". */
  friendlyName: string;
}

export type ExportKind = 'gerber' | 'bom' | 'pnp' | 'schematic' | 'step' | 'project';
export type ExportTarget = 'pcb' | 'release';

export interface BenchtopProjectOption {
  path: string;
  label: string;
}

export interface LookupResult {
  linked: BenchtopProjectOption | null;
  /** Best guess from the name when not linked yet. */
  suggestion: string | null;
  projects: BenchtopProjectOption[];
}

export interface BeginExportResult {
  exportId: string;
  /** Folder the files go to, relative to the project, e.g. "pcb" or "releases/2026-11-06". */
  relDir: string;
}

export interface EndExportResult {
  written: string[];
  relDir: string;
}

/** Extension → Benchtop */
export type ExtensionMessage =
  | { type: 'hello'; token: string; extensionVersion: string }
  | { type: 'lookup'; id: string; project: EeProjectRef }
  | { type: 'link'; id: string; project: EeProjectRef; projectPath: string }
  | { type: 'beginExport'; id: string; projectPath: string; target: ExportTarget }
  | { type: 'file'; id: string; exportId: string; kind: ExportKind; name: string; data: string }
  | { type: 'endExport'; id: string; exportId: string; failed: Array<{ kind: ExportKind; error: string }> }
  | { type: 'open'; id: string; projectPath: string }
  | { type: 'ping'; id: string };

/** Benchtop → Extension */
export type BenchtopMessage =
  | { type: 'welcome'; appVersion: string }
  | { type: 'denied'; error: string }
  | { type: 'reply'; id: string; ok: true; data?: unknown }
  | { type: 'reply'; id: string; ok: false; error: string };
