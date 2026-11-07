/**
 * Drafts a project.yaml for every project that doesn't have one yet.
 *
 *   npx tsx scripts/draft-project-info.ts <projectsRoot> [drafts.json]          -> writes drafts.json, prints a table
 *   npx tsx scripts/draft-project-info.ts <projectsRoot> drafts.json --write    -> writes the project.yaml files
 *
 * Heuristics: status from last-modified date, description from the README,
 * GitHub link from the git remote, tags from what's in the folder and the code.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { HEAVY_DIRS, extOf } from '../src/shared/fileKinds';
import type { ProjectMeta, ProjectStatus, ProjectSummary } from '../src/shared/types';
import { META_FILE, writeMeta } from '../src/main/meta';
import { listProjects } from '../src/main/scanner';

const DAY = 86400000;

interface Draft {
  path: string;
  name: string;
  group: string | null;
  meta: ProjectMeta;
  why: string;
}

function guessStatus(p: ProjectSummary, now: number): { status: ProjectStatus; why: string } {
  const age = (now - p.modified) / DAY;
  if (/id[ée]e|idea/i.test(p.name)) return { status: 'idea', why: 'name says idea' };
  if (age < 30) return { status: 'active', why: `changed ${Math.round(age)} days ago` };
  if (age < 365) return { status: 'paused', why: `untouched for ${Math.round(age / 30)} months` };
  const finished = !!p.readmePath || p.counts.image >= 8;
  return finished
    ? { status: 'done', why: `untouched for ${(age / 365).toFixed(1)} years, has README/photos` }
    : { status: 'archived', why: `untouched for ${(age / 365).toFixed(1)} years` };
}

const CODE_EXT = new Set(['ino', 'c', 'cpp', 'h', 'hpp', 'py', 'js', 'ts', 'tsx', 'json', 'ini', 'txt', 'yaml', 'yml']);

async function sampleCode(dir: string, limit = 60): Promise<{ text: string; names: Set<string> }> {
  const names = new Set<string>();
  const chunks: string[] = [];
  const queue: Array<{ d: string; depth: number }> = [{ d: dir, depth: 0 }];
  let read = 0;
  while (queue.length && read < limit) {
    const { d, depth } = queue.shift()!;
    let entries: import('node:fs').Dirent[] = [];
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const lower = e.name.toLowerCase();
      if (e.isDirectory()) {
        if (!lower.startsWith('.') && !HEAVY_DIRS.has(lower) && depth < 4) queue.push({ d: path.join(d, e.name), depth: depth + 1 });
        continue;
      }
      names.add(lower);
      if (read >= limit || !CODE_EXT.has(extOf(lower))) continue;
      if (lower === 'package-lock.json') continue;
      try {
        const fh = await fs.open(path.join(d, e.name), 'r');
        const buf = Buffer.alloc(24 * 1024);
        const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
        await fh.close();
        chunks.push(buf.subarray(0, bytesRead).toString('utf8'));
        read++;
      } catch {
        /* skip */
      }
    }
  }
  return { text: chunks.join('\n'), names };
}

async function guessTags(p: ProjectSummary): Promise<string[]> {
  const { text, names } = await sampleCode(p.path);
  const has = (re: RegExp) => re.test(text);
  const anyName = (re: RegExp) => [...names].some((n) => re.test(n));
  const tags: string[] = [];
  const add = (t: string, cond: boolean) => cond && !tags.includes(t) && tags.push(t);

  // Platform
  add('esp32', /esp32/i.test(p.name) || has(/\bESP32\b|esp_wifi|esp_err_t|ESP-IDF|idf_component_register|#include\s*<WiFi\.h>/));
  add('esp8266', /esp0?1|esp8266/i.test(p.name) || has(/ESP8266|esp8266/));
  add('attiny', /attiny/i.test(p.name) || has(/attiny|ATtiny/));
  add('rp2040', has(/rp2040|RP2040|pico\/stdlib/));
  // Tooling
  add('arduino', anyName(/\.ino$/));
  add('platformio', names.has('platformio.ini'));
  add('esp-idf', names.has('sdkconfig') || names.has('sdkconfig.defaults') || anyName(/^idf_component\.yml$/));
  // Features
  add('lvgl', has(/\blv_obj_|lvgl\.h|#include\s*"lvgl/) || anyName(/\.spj$/));
  add('matter', has(/esp_matter|chip::|\bMatter\b/));
  add('home-assistant', has(/home[ _-]?assistant|homeassistant/i));
  add('e-ink', has(/e-?paper|eink|GxEPD/i));
  // Software
  add('electron', has(/"electron"\s*:/));
  add('react', has(/"react"\s*:/));
  add('python', anyName(/\.py$/));
  // Hardware
  add('pcb', p.counts.pcb > 0);
  add('3d-print', anyName(/\.(stl|3mf)$/));
  add('fusion360', anyName(/\.f3d$/));
  return tags.slice(0, 6);
}

async function main() {
  const [root, draftFile = 'drafts.json', flag] = process.argv.slice(2);
  if (!root) throw new Error('usage: draft-project-info <projectsRoot> [drafts.json] [--write]');

  if (flag === '--write') {
    const drafts = JSON.parse(await fs.readFile(draftFile, 'utf8')) as Draft[];
    let n = 0;
    for (const d of drafts) {
      try {
        await fs.access(path.join(d.path, META_FILE));
        console.log(`skip (already has project.yaml): ${d.name}`);
        continue;
      } catch {
        /* good: none yet */
      }
      await writeMeta(d.path, d.meta);
      n++;
    }
    console.log(`wrote ${n} project.yaml files`);
    return;
  }

  const now = Date.now();
  const projects = await listProjects(root);
  const drafts: Draft[] = [];
  for (const p of projects.sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '') || a.name.localeCompare(b.name))) {
    try {
      await fs.access(path.join(p.path, META_FILE));
      continue; // already has info
    } catch {
      /* draft it */
    }
    const { status, why } = guessStatus(p, now);
    const meta: ProjectMeta = { status };
    if (p.description) meta.description = p.description;
    const tags = await guessTags(p);
    if (p.group?.toLowerCase() === 'software' && !tags.includes('software')) tags.unshift('software');
    if (tags.length) meta.tags = tags;
    if (p.git?.webUrl && /github\.com/.test(p.git.webUrl)) meta.links = [{ label: 'github', url: p.git.webUrl }];
    drafts.push({ path: p.path, name: p.name, group: p.group, meta, why });
  }
  await fs.writeFile(draftFile, JSON.stringify(drafts, null, 2), 'utf8');
  for (const d of drafts) {
    const name = (d.group ? `${d.group}/` : '') + d.name;
    console.log(
      [name, d.meta.status, d.why, (d.meta.tags ?? []).join(' '), d.meta.links?.[0]?.url ?? '', (d.meta.description ?? '').slice(0, 90)].join(' | '),
    );
  }
  console.log(`\n${drafts.length} drafts -> ${draftFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
