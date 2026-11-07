/**
 * Renders a Gerber zip (as EasyEDA, KiCad or Altium export it) into top and bottom board images.
 * Uses tracespace's pcb-stackup (pure JavaScript, runs in the main process).
 */
import { promises as fs } from 'node:fs';
import JSZip from 'jszip';
import pcbStackup from 'pcb-stackup';
import whatsThatGerber from 'whats-that-gerber';
import type { GerberRender, ZipInfo } from '../shared/types';
import { repairOutline } from './outline';

const MAX_ZIP = 60 * 1024 * 1024;
const cache = new Map<string, { mtime: number; render: GerberRender }>();

// Colors close to a typical JLC green board.
const COLORS = {
  fr4: '#4d3f22',
  cu: '#c9a24b',
  cf: '#d8b45a',
  sm: 'rgba(0, 90, 40, 0.80)',
  ss: '#f4f4f4',
  sp: '#9aa0a6',
  out: '#000000',
};

const SKIP = /\.(txt|html?|pdf|csv|xlsx?|json|md|png|jpe?g|step|stp|gbrjob|rpt)$/i;
/** Drill maps and drawing layers are documentation, not part of the board (KiCad's *-drl_map.gbr). */
const DOC_ONLY = /drl_map|drill_?map|drill_?drawing|fab\.g|courtyard|user_|cmts|dwgs|eco\d/i;

function readBox(svg: string): { width: number; height: number; units: string } | null {
  const w = /\swidth="([\d.]+)(mm|in)"/.exec(svg);
  const h = /\sheight="([\d.]+)(mm|in)"/.exec(svg);
  if (!w || !h) return null;
  return { width: Number(w[1]), height: Number(h[1]), units: w[2] };
}

export async function renderGerberZip(zipPath: string): Promise<GerberRender> {
  const stat = await fs.stat(zipPath);
  const hit = cache.get(zipPath);
  if (hit && hit.mtime === stat.mtimeMs) return hit.render;
  if (stat.size > MAX_ZIP) throw new Error('This zip is too large to preview.');

  const zip = await JSZip.loadAsync(await fs.readFile(zipPath));
  const names = Object.values(zip.files)
    .filter((f) => !f.dir && !SKIP.test(f.name) && !/(^|\/)(__MACOSX|\.)/.test(f.name))
    .map((f) => f.name);
  const types = whatsThatGerber(names);
  const known = names.filter((n) => types[n]?.type && types[n].type !== 'drawing' && !DOC_ONLY.test(n.split('/').pop()!));
  if (!known.length) throw new Error('No Gerber layers recognised in this zip.');

  const layers = await Promise.all(
    known.map(async (name) => ({
      filename: name,
      type: types[name].type!,
      side: types[name].side!,
      gerber: await zip.files[name].async('string'),
    })),
  );

  let stackup = await pcbStackup(layers, { color: COLORS });
  let top = repairOutline(stackup.top.svg);
  let bottom = repairOutline(stackup.bottom.svg);
  let outline = true;
  if (top === null || bottom === null) {
    // The outline couldn't be closed: show the board as a rectangle instead of a broken shape.
    stackup = await pcbStackup(layers, { color: COLORS, useOutline: false });
    top = stackup.top.svg;
    bottom = stackup.bottom.svg;
    outline = false;
  }
  const box = readBox(top);
  const render: GerberRender = {
    top,
    bottom,
    outline,
    width: box?.width ?? null,
    height: box?.height ?? null,
    units: box?.units === 'in' ? 'in' : 'mm',
    layers: known.map((n) => ({ name: n.split('/').pop()!, type: types[n].type!, side: types[n].side ?? null })),
    skipped: names.filter((n) => !known.includes(n)).map((n) => n.split('/').pop()!),
  };
  cache.set(zipPath, { mtime: stat.mtimeMs, render });
  if (cache.size > 20) cache.delete(cache.keys().next().value!);
  return render;
}

/** What's inside a zip, and whether it's a set of Gerber files (any naming: EasyEDA, KiCad, Altium…). */
export async function zipInfo(zipPath: string): Promise<ZipInfo> {
  const stat = await fs.stat(zipPath);
  if (stat.size > MAX_ZIP) return { entries: [], gerber: false, tooLarge: true };
  const zip = await JSZip.loadAsync(await fs.readFile(zipPath));
  const files = Object.values(zip.files).filter((f) => !f.dir);
  const names = files.map((f) => f.name).filter((n) => !SKIP.test(n));
  const types = whatsThatGerber(names);
  const layers = names.filter((n) => types[n]?.type && types[n].type !== 'drawing' && !DOC_ONLY.test(n));
  const copper = layers.filter((n) => types[n].type === 'copper').length;
  return {
    entries: files.slice(0, 500).map((f) => ({
      name: f.name,
      // JSZip keeps the uncompressed size in a private field; fine for display.
      size: (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0,
    })),
    gerber: copper > 0 && layers.length >= 2,
    tooLarge: false,
  };
}
