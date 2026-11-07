export const api = () => window.benchtop;

/** URL that streams a file from the projects folder (images, README pictures). */
export function fileUrl(filePath: string): string {
  return `benchtop://file/${encodeURIComponent(filePath)}`;
}

/** Small OS-generated thumbnail; falls back to the full file when unsupported. */
export function thumbUrl(filePath: string, size = 480): string {
  return `benchtop://thumb/${encodeURIComponent(filePath)}?s=${size}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function formatRelative(ms: number): string {
  if (!ms) return 'unknown';
  const diff = (ms - Date.now()) / 1000;
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, seconds] of steps) {
    if (Math.abs(diff) >= seconds) return rtf.format(Math.round(diff / seconds), unit);
  }
  return 'just now';
}

export function formatDate(ms: number): string {
  return ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

/** Path separator agnostic helpers (projects live on Windows). */
export function splitPath(p: string): string[] {
  return p.split(/[\\/]+/).filter(Boolean);
}

export function relativePath(from: string, to: string): string {
  const a = splitPath(from);
  const b = splitPath(to);
  let i = 0;
  while (i < a.length && i < b.length && a[i].toLowerCase() === b[i].toLowerCase()) i++;
  return b.slice(i).join('/');
}

export function dirname(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx > 0 ? p.slice(0, idx) : p;
}

export function joinPath(base: string, rel: string): string {
  const sep = base.includes('\\') ? '\\' : '/';
  const parts = splitPath(base);
  const prefix = base.startsWith('/') ? '/' : base.startsWith('\\\\') ? '\\\\' : '';
  for (const piece of rel.split(/[\\/]+/)) {
    if (!piece || piece === '.') continue;
    if (piece === '..') parts.pop();
    else parts.push(piece);
  }
  return prefix + parts.join(sep);
}

/** Stable pleasant hue from a project name, for placeholder tiles. */
export function hueFor(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function initials(name: string): string {
  const words = name.replace(/[_\-]+/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
