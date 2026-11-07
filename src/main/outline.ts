/**
 * Board outlines are often drawn as loose segments, in any order and direction, with tiny
 * gaps between them (EasyEDA does this). pcb-stackup can only clip to an outline that is
 * already one continuous path, so we stitch the segments into closed loops ourselves.
 */

type Pt = [number, number];
interface Seg {
  from: Pt;
  to: Pt;
  /** "L" for a line, or the SVG arc parameters "rx ry rot large sweep". */
  arc: [number, number, number, number, number] | null;
}

/** Parse the subset of SVG path data pcb-stackup emits: M, L (also implicit), A. */
export function parsePath(d: string): Seg[] {
  const tokens = d.match(/[MLAZmlaz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const segs: Seg[] = [];
  let i = 0;
  let cmd = 'M';
  let cur: Pt = [0, 0];
  let start: Pt = [0, 0];
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) {
      cmd = tokens[i++].toUpperCase();
      if (cmd === 'Z') {
        if (cur[0] !== start[0] || cur[1] !== start[1]) segs.push({ from: cur, to: start, arc: null });
        cur = start;
        continue;
      }
    }
    if (cmd === 'M') {
      cur = [num(), num()];
      start = cur;
      cmd = 'L'; // further pairs are lines
    } else if (cmd === 'L') {
      const to: Pt = [num(), num()];
      segs.push({ from: cur, to, arc: null });
      cur = to;
    } else if (cmd === 'A') {
      const arc: Seg['arc'] = [num(), num(), num(), num(), num()];
      const to: Pt = [num(), num()];
      segs.push({ from: cur, to, arc });
      cur = to;
    } else {
      i++; // unknown command: skip
    }
  }
  return segs.filter((s) => s.arc || s.from[0] !== s.to[0] || s.from[1] !== s.to[1]);
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const reverse = (s: Seg): Seg => ({ from: s.to, to: s.from, arc: s.arc ? [s.arc[0], s.arc[1], s.arc[2], s.arc[3], s.arc[4] ? 0 : 1] : null });
const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** Chain segments into closed loops. Returns null when no loop could be closed. */
export function stitch(segs: Seg[], tolerance: number): Seg[][] | null {
  const left = [...segs];
  const loops: Seg[][] = [];
  while (left.length) {
    const loop = [left.shift()!];
    const start = loop[0].from;
    // A full circle (or a segment that already closes on itself)
    if (dist(loop[0].to, start) <= tolerance && loop[0].arc) {
      loops.push(loop);
      continue;
    }
    for (;;) {
      const end = loop[loop.length - 1].to;
      if (loop.length > 1 && dist(end, start) <= tolerance) break;
      let best = -1;
      let bestD = Infinity;
      let flip = false;
      for (let k = 0; k < left.length; k++) {
        const a = dist(end, left[k].from);
        const b = dist(end, left[k].to);
        if (a < bestD) [best, bestD, flip] = [k, a, false];
        if (b < bestD) [best, bestD, flip] = [k, b, true];
      }
      if (best < 0 || bestD > tolerance) {
        loop.length = 0; // open chain: drop it
        break;
      }
      const [next] = left.splice(best, 1);
      loop.push(flip ? reverse(next) : next);
    }
    if (loop.length) loops.push(loop);
  }
  return loops.length ? loops : null;
}

export function loopsToPath(loops: Seg[][]): string {
  return loops
    .map((loop) => {
      // Each segment starts where the previous one ended (snaps the small gaps shut).
      let d = `M ${fmt(loop[0].from[0])} ${fmt(loop[0].from[1])}`;
      for (const s of loop) {
        d += s.arc
          ? ` A ${s.arc.map(fmt).join(' ')} ${fmt(s.to[0])} ${fmt(s.to[1])}`
          : ` L ${fmt(s.to[0])} ${fmt(s.to[1])}`;
      }
      return `${d} Z`;
    })
    .join(' ');
}

function unitsPerMm(svg: string): number {
  const vb = /viewBox="[-\d.e]+ [-\d.e]+ ([\d.e]+) [\d.e]+"/.exec(svg);
  const w = /\swidth="([\d.]+)(mm|in)"/.exec(svg);
  if (!vb || !w) return 1000;
  const mm = Number(w[1]) * (w[2] === 'in' ? 25.4 : 1);
  return Number(vb[1]) / mm;
}

/**
 * Fix the outline clip path in a pcb-stackup SVG. Returns the SVG unchanged when the outline
 * is already fine, or `null` when it can't be closed (render without an outline instead).
 */
export function repairOutline(svg: string): string | null {
  const m = /(<clipPath id="[^"]*_outline"><path d=")([^"]*)("[^>]*?)(\/>)/.exec(svg);
  if (!m) return svg;
  const segs = parsePath(m[2]);
  if (!segs.length) return null;
  const subpaths = (m[2].match(/M/g) ?? []).length;
  const first = segs[0].from;
  const last = segs[segs.length - 1].to;
  const tol = 0.3 * unitsPerMm(svg);
  if (subpaths === 1 && dist(first, last) <= tol / 100) return svg; // already one closed loop
  const loops = stitch(segs, tol);
  if (!loops) return null;
  const fixed = `${m[1]}${loopsToPath(loops)}${m[3].replace(/fill="none"/, 'fill="#fff" clip-rule="evenodd"')}${m[4]}`;
  return svg.replace(m[0], fixed);
}
