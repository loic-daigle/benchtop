import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loopsToPath, parsePath, repairOutline, stitch } from './outline';

test('parses lines and arcs', () => {
  const segs = parsePath('M 0 0 10 0 A 5 5 0 0 0 10 10 L 0 10 Z');
  assert.equal(segs.length, 4);
  assert.deepEqual(segs[1].arc, [5, 5, 0, 0, 0]);
  assert.deepEqual(segs[3].to, [0, 0]);
});

test('stitches loose, reversed segments with small gaps', () => {
  // A square drawn as four separate strokes in random directions, with 0.05 gaps.
  const segs = parsePath('M 0 0 100 0 M 100 100 100 0.05 M 0 100 99.95 100 M 0 0.04 0 100');
  const loops = stitch(segs, 0.3);
  assert.ok(loops);
  assert.equal(loops!.length, 1);
  assert.equal(loops![0].length, 4);
  assert.match(loopsToPath(loops!), /^M 0 0 L 100 0 L 100 100 L 0 100 L 0 0.04 Z$/);
});

test('reversing an arc flips its sweep', () => {
  const segs = parsePath('M 0 0 10 0 M 0 0 A 5 5 0 0 1 10 0');
  const loops = stitch(segs, 0.1)!;
  assert.equal(loops[0][1].arc![4], 0);
});

test('an open outline gives up', () => {
  assert.equal(stitch(parsePath('M 0 0 100 0 M 0 50 0 100'), 0.3), null);
});

test('repairOutline rewrites only the outline clip path', () => {
  const svg =
    '<svg viewBox="0 0 100000 100000" width="100mm" height="100mm"><clipPath id="a_top_outline"><path d="M 0 0 100000 0 M 100000 100000 100000 0 M 0 100000 100000 100000 M 0 0 0 100000" fill="none" stroke-width="254"/></clipPath><rect/></svg>';
  const out = repairOutline(svg)!;
  assert.match(out, /<path d="M 0 0 L 100000 0 L 100000 100000 L 0 100000 L 0 0 Z" fill="#fff" clip-rule="evenodd" stroke-width="254"\/>/);
  assert.ok(out.endsWith('<rect/></svg>'));
  const closed = '<svg viewBox="0 0 10 10" width="10mm" height="10mm"><clipPath id="a_top_outline"><path d="M 0 0 10 0 10 10 0 10 0 0" fill="none"/></clipPath></svg>';
  assert.equal(repairOutline(closed), closed);
});
