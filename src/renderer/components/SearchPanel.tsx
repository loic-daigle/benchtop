import { useEffect, useState } from 'react';
import { categorize } from '../../shared/fileKinds';
import type { SearchResponse } from '../../shared/types';
import { api } from '../lib/format';
import { CloseIcon, FileIcon } from './Icons';

interface Props {
  initialQuery: string;
  /** When set, offer "this project only". */
  currentProject: { path: string; name: string } | null;
  onClose: () => void;
  onOpen: (projectPath: string, filePath: string, line: number) => void;
}

export function SearchPanel({ initialQuery, currentProject, onClose, onOpen }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [scope, setScope] = useState<'all' | 'project'>(currentProject ? 'project' : 'all');
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResponse(null);
      setBusy(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(() => {
      api()
        .search(q, { caseSensitive, projectPath: scope === 'project' ? currentProject?.path : undefined })
        .then((r) => {
          if (!cancelled && !r.cancelled) {
            setResponse(r);
            setBusy(false);
          }
        })
        .catch(() => !cancelled && setBusy(false));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, caseSensitive, scope, currentProject?.path]);

  const matchCount = response?.results.reduce((n, r) => n + r.matches.length, 0) ?? 0;

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="search-panel" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Search in files">
        <div className="search-panel-head">
          <input
            className="palette-input"
            autoFocus
            placeholder="Search inside files (part numbers, functions, notes…)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
          />
          <button className="icon-button" onClick={onClose} title="Close (Esc)">
            <CloseIcon />
          </button>
        </div>
        <div className="search-options">
          {currentProject && (
            <div className="segmented">
              <button className={scope === 'project' ? 'active' : ''} onClick={() => setScope('project')}>
                {currentProject.name}
              </button>
              <button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>
                All projects
              </button>
            </div>
          )}
          <label className="checkbox">
            <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
            Match case
          </label>
          <div className="spacer" />
          <span className="muted small">
            {busy
              ? 'Searching…'
              : response
                ? `${matchCount} match${matchCount === 1 ? '' : 'es'} in ${response.results.length} file${response.results.length === 1 ? '' : 's'}${response.truncated ? ' (stopped at 500)' : ''} · ${response.filesSearched} files searched`
                : 'Type at least 2 characters'}
          </span>
        </div>
        <div className="search-results">
          {response?.results.map((file) => {
            const q = query.trim();
            return (
              <div key={file.path} className="search-file">
                <button className="search-file-head" onClick={() => onOpen(file.projectPath, file.path, file.matches[0].line)}>
                  <FileIcon size={15} category={categorize(file.relPath)} />
                  <span className="search-file-name">{file.relPath}</span>
                  <span className="muted small">{file.projectName}</span>
                </button>
                {file.matches.slice(0, 20).map((m) => (
                  <button key={m.line} className="search-line" onClick={() => onOpen(file.projectPath, file.path, m.line)}>
                    <span className="search-line-no">{m.line}</span>
                    <span className="search-line-text">
                      {m.text.slice(0, m.col)}
                      <mark>{m.text.slice(m.col, m.col + q.length)}</mark>
                      {m.text.slice(m.col + q.length)}
                    </span>
                  </button>
                ))}
                {file.matches.length > 20 && <div className="muted small search-more">+{file.matches.length - 20} more in this file</div>}
              </div>
            );
          })}
          {response && !response.results.length && !busy && <div className="palette-empty">No matches.</div>}
        </div>
      </div>
    </div>
  );
}
