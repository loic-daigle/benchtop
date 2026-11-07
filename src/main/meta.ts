/**
 * project.yaml — per-project info (status, tags, links, cover) stored inside the
 * project so it travels with it (and with git). Comments and unknown keys are kept.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { STATUSES, type ProjectLink, type ProjectMeta, type ProjectStatus } from '../shared/types';

export const META_FILE = 'project.yaml';
export const NOTES_FILE = 'NOTES.md';

const HEADER =
  '# Benchtop project info — edit here or in the Benchtop app.\n' +
  '# status: idea | active | paused | done | archived\n';

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Turn whatever is in the YAML into a clean ProjectMeta, ignoring bad values. */
export function normalizeMeta(raw: unknown): ProjectMeta {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const meta: ProjectMeta = {};

  const status = asString(r.status)?.toLowerCase();
  if (status && (STATUSES as readonly string[]).includes(status)) meta.status = status as ProjectStatus;

  const description = asString(r.description);
  if (description) meta.description = description;

  if (Array.isArray(r.tags)) {
    const tags = r.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
    if (tags.length) meta.tags = [...new Set(tags)];
  } else if (typeof r.tags === 'string') {
    const tags = r.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (tags.length) meta.tags = [...new Set(tags)];
  }

  const cover = asString(r.cover);
  if (cover) meta.cover = cover;

  // links can be a map { github: url } or a list [{ label, url }]
  const links: ProjectLink[] = [];
  if (Array.isArray(r.links)) {
    for (const item of r.links) {
      if (item && typeof item === 'object') {
        const url = asString((item as Record<string, unknown>).url);
        const label = asString((item as Record<string, unknown>).label);
        if (url) links.push({ label: label ?? url, url });
      }
    }
  } else if (r.links && typeof r.links === 'object') {
    for (const [label, value] of Object.entries(r.links as Record<string, unknown>)) {
      const url = asString(value);
      if (url) links.push({ label, url });
    }
  }
  if (links.length) meta.links = links;
  if (r.group === true || r.group === 'true' || r.group === 'yes') meta.group = true;
  const ee = Array.isArray(r.easyeda) ? r.easyeda : typeof r.easyeda === 'string' ? [r.easyeda] : [];
  const easyeda = ee.map((x) => String(x).trim()).filter(Boolean);
  if (easyeda.length) meta.easyeda = [...new Set(easyeda)];
  return meta;
}

export async function readMeta(projectPath: string): Promise<{ meta: ProjectMeta; error: string | null; exists: boolean }> {
  let text: string;
  try {
    text = await fs.readFile(path.join(projectPath, META_FILE), 'utf8');
  } catch {
    return { meta: {}, error: null, exists: false };
  }
  try {
    return { meta: normalizeMeta(YAML.parse(text)), error: null, exists: true };
  } catch (err) {
    return { meta: {}, error: `project.yaml: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`, exists: true };
  }
}

/** Write meta, keeping comments and any keys Benchtop doesn't know about. */
export async function writeMeta(projectPath: string, meta: ProjectMeta): Promise<void> {
  const file = path.join(projectPath, META_FILE);
  let doc: YAML.Document;
  try {
    doc = YAML.parseDocument(await fs.readFile(file, 'utf8'));
    if (doc.errors.length || !YAML.isMap(doc.contents)) doc = new YAML.Document({});
  } catch {
    doc = new YAML.Document({});
    doc.commentBefore = HEADER.replace(/^#/gm, '').trimEnd(); // yaml adds "#", keep the space
  }

  const setOrDelete = (key: string, value: unknown) => {
    const empty = value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
    if (empty) doc.delete(key);
    else doc.set(key, value);
  };

  setOrDelete('status', meta.status);
  setOrDelete('description', meta.description?.trim());
  setOrDelete('tags', meta.tags?.map((t) => t.trim().toLowerCase()).filter(Boolean));
  setOrDelete('cover', meta.cover?.replace(/\\/g, '/'));
  const links = meta.links?.filter((l) => l.url.trim());
  if (links?.length) {
    const map: Record<string, string> = {};
    for (const l of links) {
      let label = l.label.trim() || 'link';
      let n = 2;
      while (label in map) label = `${l.label.trim() || 'link'} ${n++}`;
      map[label] = l.url.trim();
    }
    doc.set('links', map);
  } else {
    doc.delete('links');
  }

  if (meta.easyeda !== undefined) {
    const list = meta.easyeda.map((x) => x.trim()).filter(Boolean);
    if (list.length) doc.set('easyeda', list);
    else doc.delete('easyeda');
  }

  // Only touched when explicitly set, so normal edits never change it.
  if (meta.group === true) doc.set('group', true);
  else if (meta.group === false) doc.delete('group');

  await fs.writeFile(file, doc.toString({ lineWidth: 0 }), 'utf8');
}
