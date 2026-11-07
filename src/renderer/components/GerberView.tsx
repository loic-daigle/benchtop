import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react';
import type { GerberRender } from '../../shared/types';
import { api } from '../lib/format';

type Side = 'top' | 'bottom' | 'both';

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Board render of a Gerber zip: top, bottom or side by side, with zoom and pan. */
export function GerberView({ path, modified }: { path: string; modified: number }) {
  const [render, setRender] = useState<GerberRender | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [side, setSide] = useState<Side>('both');

  useEffect(() => {
    let cancelled = false;
    setRender(null);
    setError(null);
    api()
      .renderGerber(path)
      .then((r) => !cancelled && setRender(r))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)));
    return () => {
      cancelled = true;
    };
  }, [path, modified]);

  const urls = useMemo(() => (render ? { top: svgUrl(render.top), bottom: svgUrl(render.bottom) } : null), [render]);

  if (error) return <div className="preview-note error">Couldn’t draw this board: {error}</div>;
  if (!render || !urls) return <div className="preview-note">Drawing the board…</div>;

  const size =
    render.width && render.height
      ? `${round(render.width)} × ${round(render.height)} ${render.units}${render.units === 'in' ? ` (${round(render.width * 25.4)} × ${round(render.height * 25.4)} mm)` : ''}`
      : null;
  const copper = render.layers.filter((l) => l.type === 'copper').length;

  return (
    <div className="viewer">
      <div className="text-toolbar">
        <div className="segmented">
          {(['top', 'bottom', 'both'] as Side[]).map((s) => (
            <button key={s} className={side === s ? 'active' : ''} onClick={() => setSide(s)}>
              {s === 'top' ? 'Top' : s === 'bottom' ? 'Bottom' : 'Both'}
            </button>
          ))}
        </div>
        {size && <span className="muted">{size}</span>}
        {copper > 0 && <span className="muted">{copper}-layer</span>}
        {!render.outline && <span className="muted">Outline not closed, drawn as a rectangle</span>}
        <div className="spacer" />
        <span className="muted small">Scroll to zoom · drag to move · double-click to reset</span>
      </div>
      <ZoomPan resetKey={`${path}:${side}`}>
        <div className={`board-sides ${side}`}>
          {side !== 'bottom' && (
            <figure>
              <img src={urls.top} alt="Top of the board" draggable={false} />
              {side === 'both' && <figcaption>Top</figcaption>}
            </figure>
          )}
          {side !== 'top' && (
            <figure>
              <img src={urls.bottom} alt="Bottom of the board" draggable={false} />
              {side === 'both' && <figcaption>Bottom (seen from below)</figcaption>}
            </figure>
          )}
        </div>
      </ZoomPan>
      <details className="viewer-layers">
        <summary>
          {render.layers.length} layers{render.skipped.length ? `, ${render.skipped.length} other file${render.skipped.length > 1 ? 's' : ''}` : ''}
        </summary>
        <ul>
          {render.layers.map((l) => (
            <li key={l.name}>
              <code>{l.name}</code> <span className="muted">{[l.side !== 'all' ? l.side : null, l.type].filter(Boolean).join(' ')}</span>
            </li>
          ))}
          {render.skipped.map((n) => (
            <li key={n}>
              <code>{n}</code> <span className="muted">not drawn</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Wheel to zoom around the cursor, drag to pan, double-click to reset. */
export function ZoomPan({ children, resetKey }: { children: React.ReactNode; resetKey: string }) {
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setView({ x: 0, y: 0, k: 1 }), [resetKey]);

  const onWheel = (e: RWheelEvent) => {
    const rect = box.current!.getBoundingClientRect();
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top - rect.height / 2;
    setView((v) => {
      const k = Math.min(40, Math.max(0.5, v.k * Math.exp(-e.deltaY * 0.0015)));
      const f = k / v.k;
      return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
    });
  };
  const onDown = (e: RPointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  };
  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
  };

  return (
    <div
      ref={box}
      className="zoompan"
      onWheel={onWheel}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={() => (drag.current = null)}
      onDoubleClick={() => setView({ x: 0, y: 0, k: 1 })}
    >
      <div className="zoompan-inner" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        {children}
      </div>
    </div>
  );
}
