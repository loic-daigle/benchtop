import type { FileCategory } from './types';

const CODE = new Set([
  'ino', 'c', 'h', 'cpp', 'hpp', 'cc', 'cxx', 'hh', 'py', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'sh', 'bash', 'ps1', 'bat', 'cmd', 'cmake',
  'html', 'htm', 'css', 'scss', 'lua', 'rs', 'go', 'java', 'kt', 'cs', 'swift', 'xml', 'vue',
  'svelte', 'ld', 's', 'asm', 'mk', 'csv', 'tsv', 'sll', 'spj', 'slt',
]);
const PCB = new Set([
  'kicad_pcb', 'kicad_sch', 'kicad_pro', 'sch', 'brd', 'epro', 'eprj', 'gbr', 'gtl', 'gbl', 'gto',
  'gbo', 'gts', 'gbs', 'gtp', 'gbp', 'gko', 'gm1', 'drl', 'xln', 'pcbdoc', 'schdoc', 'prjpcb',
]);
const CAD = new Set([
  'stl', 'step', 'stp', 'f3d', 'f3z', '3mf', 'obj', 'iges', 'igs', 'dxf', 'dwg', 'glb', 'gltf',
  'scad', 'fcstd', 'sldprt', 'sldasm', 'ipt', 'gcode', 'bgcode',
]);
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico']);
const DOC = new Set(['md', 'markdown', 'txt', 'pdf', 'doc', 'docx', 'rtf', 'odt', 'url', 'xlsx', 'xls']);
const MEDIA = new Set(['mp4', 'mov', 'mkv', 'avi', 'webm', 'mp3', 'wav', 'm4a']);
const ARCHIVE = new Set(['zip', '7z', 'rar', 'tar', 'gz', 'tgz']);

/** Files that are almost always plain text even though they have no or an odd extension. */
const TEXT_NAMES = new Set([
  'license', 'licence', 'readme', 'makefile', 'dockerfile', 'cmakelists.txt', 'sdkconfig',
  'sdkconfig.defaults', 'sdkconfig.default', '.gitignore', '.gitattributes', '.gitmodules',
  '.editorconfig', '.env.example', 'platformio.ini', 'partitions.csv', 'dependencies.lock',
]);

/** Extensions we try to show as text. */
const TEXT_EXT = new Set([...CODE, 'md', 'markdown', 'txt', 'log', 'url', 'svg', 'lock', 'bak', 'gitignore']);

export function extOf(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  return dot > 0 ? lower.slice(dot + 1) : '';
}

export function categorize(name: string): FileCategory {
  const lower = name.toLowerCase();
  const ext = extOf(lower);
  // Gerber zips, EasyEDA exports and BOMs are named, not extension-typed.
  if (/^(gerber|bom|pcb|sch|schematic|pickandplace|pick_place)[_\- ]/.test(lower)) {
    if (ext === 'zip' || ext === 'csv' || ext === 'json' || ext === 'pdf' || ext === 'svg' || ext === 'html' || ext === 'xlsx') {
      return 'pcb';
    }
  }
  if (TEXT_NAMES.has(lower) && lower !== 'readme' && lower !== 'license' && lower !== 'licence') return 'code';
  if (CAD.has(ext)) return 'cad';
  if (PCB.has(ext)) return 'pcb';
  if (IMAGE.has(ext)) return 'image';
  if (MEDIA.has(ext)) return 'media';
  if (ARCHIVE.has(ext)) return 'archive';
  if (DOC.has(ext)) return 'doc';
  if (CODE.has(ext) || TEXT_NAMES.has(lower)) return 'code';
  return 'other';
}

export function isLikelyText(name: string): boolean {
  const lower = name.toLowerCase();
  return TEXT_EXT.has(extOf(lower)) || TEXT_NAMES.has(lower);
}

export function isPreviewableImage(name: string): boolean {
  const ext = extOf(name);
  return IMAGE.has(ext);
}

export function isMarkdown(name: string): boolean {
  const ext = extOf(name);
  return ext === 'md' || ext === 'markdown';
}

/** Folders that are dependencies or build output: shown dimmed, never scanned. */
export const HEAVY_DIRS = new Set([
  'node_modules', '.vite', '.next', 'out', 'dist', 'build', 'managed_components', '.pio',
  '__pycache__', '.venv', 'venv', '.gradle', 'target', '.cache', 'cache', 'autosave', 'backup',
]);

/** Never shown in the file tree. */
export const HIDDEN_NAMES = new Set(['.git', 'desktop.ini', 'thumbs.db', '.ds_store']);

export const CATEGORY_LABEL: Record<FileCategory, string> = {
  code: 'Code',
  pcb: 'PCB',
  cad: '3D / CAD',
  image: 'Images',
  doc: 'Docs',
  media: 'Media',
  archive: 'Archives',
  other: 'Other',
};
