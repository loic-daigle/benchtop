import { useEffect, useMemo, useRef } from 'react';
import { highlight } from '../lib/highlight';

const LINE_HEIGHT = 19.375; // 12.5px * 1.55, must match .code in preview.css
const PAD_TOP = 14;

export function CodeView({ code, name, revealLine }: { code: string; name: string; revealLine?: number }) {
  const { html, lineCount } = useMemo(() => {
    const result = highlight(code, name);
    const lines = code.endsWith('\n') ? code.split('\n').length - 1 : code.split('\n').length;
    return { html: result.html, lineCount: Math.max(lines, 1) };
  }, [code, name]);

  const gutter = useMemo(() => Array.from({ length: lineCount }, (_, i) => i + 1).join('\n'), [lineCount]);
  const markRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (revealLine) markRef.current?.scrollIntoView({ block: 'center' });
  }, [revealLine, html]);

  return (
    <div className="code">
      <pre className="code-gutter" aria-hidden="true">
        {gutter}
      </pre>
      <div className="code-main">
        {revealLine ? (
          <div ref={markRef} className="code-mark" style={{ top: PAD_TOP + (revealLine - 1) * LINE_HEIGHT, height: LINE_HEIGHT }} />
        ) : null}
        {/* html is produced by highlight.js (which escapes input) or by our own escaper */}
        <pre className="code-body hljs">
          <code dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
      </div>
    </div>
  );
}
