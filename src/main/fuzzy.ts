/**
 * Small fuzzy matcher for the Ctrl+K quick switcher.
 * Every query character must appear in order; contiguous runs, word starts
 * and matches in the file name (not the folders) score higher.
 */
export function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return 0;
  const t = target.toLowerCase();

  // Fast path: plain substring is always a good match.
  const sub = t.indexOf(q);
  const nameStart = Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\')) + 1;
  if (sub !== -1) {
    let score = 100 + q.length * 4;
    if (sub >= nameStart) score += 40;
    if (sub === nameStart) score += 30;
    if (sub === 0 || /[\\/ _\-.]/.test(t[sub - 1])) score += 15;
    return score - t.length * 0.05;
  }

  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return -1;
    score += found === prev + 1 ? 6 : 1;
    if (found === 0 || /[\\/ _\-.]/.test(t[found - 1])) score += 4;
    if (found >= nameStart) score += 2;
    prev = found;
    ti = found + 1;
  }
  return score - t.length * 0.05;
}
