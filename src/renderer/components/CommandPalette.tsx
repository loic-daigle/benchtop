import { useEffect, useRef, useState } from 'react';
import { categorize } from '../../shared/fileKinds';
import type { QuickFindItem } from '../../shared/types';
import { api } from '../lib/format';
import { FileIcon, FolderIcon, SearchFilesIcon } from './Icons';

interface Props {
  onClose: () => void;
  onOpen: (item: QuickFindItem) => void;
  onSearchInFiles: (query: string) => void;
}

export function CommandPalette({ onClose, onOpen, onSearchInFiles }: Props) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<QuickFindItem[]>([]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      api()
        .quickFind(query)
        .then((r) => {
          if (!cancelled) {
            setItems(r);
            setActive(0);
          }
        })
        .catch(() => undefined);
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // Last row: search inside files.
  const total = items.length + (query.trim().length >= 2 ? 1 : 0);

  const choose = (i: number) => {
    if (i < items.length) onOpen(items[i]);
    else onSearchInFiles(query);
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Go to project or file">
        <input
          className="palette-input"
          autoFocus
          placeholder="Go to project or file…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, total - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && total) {
              e.preventDefault();
              choose(active);
            }
          }}
        />
        <div className="palette-list" ref={listRef}>
          {items.map((item, i) => {
            const name = item.kind === 'project' ? item.projectName : item.relPath.split(/[\\/]/).pop()!;
            const dir = item.kind === 'file' ? item.relPath.slice(0, item.relPath.length - name.length).replace(/[\\/]$/, '') : '';
            return (
              <button
                key={`${item.kind}:${item.path}`}
                className={`palette-item${i === active ? ' active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
              >
                {item.kind === 'project' ? (
                  <FolderIcon className="folder-icon" size={16} />
                ) : (
                  <FileIcon size={16} category={categorize(name)} />
                )}
                <span className="palette-name">{name}</span>
                <span className="palette-detail">
                  {item.kind === 'project' ? 'Project' : `${item.projectName}${dir ? ` / ${dir}` : ''}`}
                </span>
              </button>
            );
          })}
          {query.trim().length >= 2 && (
            <button
              className={`palette-item${active === items.length ? ' active' : ''}`}
              onMouseEnter={() => setActive(items.length)}
              onClick={() => choose(items.length)}
            >
              <SearchFilesIcon size={16} />
              <span className="palette-name">Search inside files for “{query.trim()}”</span>
              <span className="palette-detail">Ctrl+Shift+F</span>
            </button>
          )}
          {!items.length && query.trim().length < 2 && <div className="palette-empty">Type to search projects and files</div>}
        </div>
        <div className="palette-footer muted small">↑↓ to move · Enter to open · Esc to close</div>
      </div>
    </div>
  );
}
