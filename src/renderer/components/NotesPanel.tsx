import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../lib/format';

const TEMPLATE = `## Where I left off

## Next steps
- [ ]

## Ideas

## Video notes
`;

const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/gm;

/** Flip the n-th "- [ ]" checkbox in the markdown source. */
export function toggleTask(source: string, index: number): string {
  let i = 0;
  return source.replace(TASK, (match, a: string, mark: string, b: string) => {
    if (i++ !== index) return match;
    return `${a}${mark === ' ' ? 'x' : ' '}${b}`;
  });
}

export function countTasks(source: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const m of source.matchAll(TASK)) {
    total++;
    if (m[2] !== ' ') done++;
  }
  return { done, total };
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function NotesPanel({ projectPath, onError }: { projectPath: string; onError: (m: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  const [mode, setMode] = useState<'edit' | 'preview'>('preview');
  const [state, setState] = useState<SaveState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    api()
      .readNotes(projectPath)
      .then((t) => {
        if (cancelled) return;
        setText(t);
        setMode(t.trim() ? 'preview' : 'edit');
      })
      .catch(() => !cancelled && setText(''));
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const value = pending.current;
    if (value === null) return;
    pending.current = null;
    setState('saving');
    try {
      await api().saveNotes(projectPath, value);
      setState('saved');
    } catch (err) {
      setState('error');
      onError(`Couldn’t save NOTES.md: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [projectPath, onError]);

  // Save when leaving the project or closing the tab.
  useEffect(() => () => void flush(), [flush]);

  const change = (value: string) => {
    setText(value);
    pending.current = value;
    setState('idle');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 700);
  };

  if (text === null) return <div className="preview-note">Loading…</div>;

  const tasks = countTasks(text);
  let taskIndex = 0;

  return (
    <div className="notes">
      <div className="notes-toolbar">
        <div className="segmented">
          <button className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}>
            Preview
          </button>
          <button className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>
            Edit
          </button>
        </div>
        {tasks.total > 0 && (
          <span className="task-progress" title="To-dos done">
            <span className="task-bar">
              <span style={{ width: `${(tasks.done / tasks.total) * 100}%` }} />
            </span>
            {tasks.done}/{tasks.total}
          </span>
        )}
        <div className="spacer" />
        <span className="muted small">
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved to NOTES.md' : state === 'error' ? 'Not saved' : 'NOTES.md'}
        </span>
      </div>

      {mode === 'edit' ? (
        <textarea
          className="notes-editor"
          value={text}
          autoFocus
          spellCheck
          placeholder={'Where you left off, next steps, ideas…\n\nUse "- [ ] task" for to-dos.'}
          onChange={(e) => change(e.target.value)}
          onBlur={() => void flush()}
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              e.preventDefault();
              const el = e.currentTarget;
              const { selectionStart: s, selectionEnd: end } = el;
              const next = `${text.slice(0, s)}  ${text.slice(end)}`;
              change(next);
              requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
            }
          }}
        />
      ) : text.trim() ? (
        <article className="markdown notes-preview" onDoubleClick={() => setMode('edit')}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => (
                <a
                  href={href}
                  onClick={(e) => {
                    e.preventDefault();
                    if (href && /^https?:/i.test(href)) void api().openExternal(href);
                  }}
                >
                  {children}
                </a>
              ),
              input: ({ type, checked }) => {
                if (type !== 'checkbox') return null;
                const index = taskIndex++;
                return (
                  <input
                    type="checkbox"
                    checked={!!checked}
                    onChange={() => {
                      change(toggleTask(text, index));
                    }}
                  />
                );
              },
            }}
          >
            {text}
          </ReactMarkdown>
        </article>
      ) : (
        <div className="notes-empty">
          <p className="muted">No notes yet for this project.</p>
          <div className="notes-empty-actions">
            <button className="button" onClick={() => setMode('edit')}>
              Write notes
            </button>
            <button
              className="button ghost"
              onClick={() => {
                change(TEMPLATE);
                setMode('edit');
              }}
            >
              Start from template
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
