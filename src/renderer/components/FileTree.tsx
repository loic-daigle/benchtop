import { useCallback, useEffect, useRef, useState } from 'react';
import { categorize } from '../../shared/fileKinds';
import type { DirEntry } from '../../shared/types';
import { api } from '../lib/format';
import { ChevronIcon, FileIcon, FolderIcon } from './Icons';

type Children = DirEntry[] | 'loading' | { error: string };

interface Props {
  rootPath: string;
  selectedPath: string | null;
  expanded: Set<string>;
  onToggle: (dir: string) => void;
  onSelect: (entry: DirEntry) => void;
  /** Bumped by the parent to force a reload of all listings. */
  reloadKey: number;
  /** A folder that changed on disk (from the file watcher). */
  changed: { dir: string; n: number } | null;
}

export function FileTree({ rootPath, selectedPath, expanded, onToggle, onSelect, reloadKey, changed }: Props) {
  const [children, setChildren] = useState<Map<string, Children>>(new Map());
  const requested = useRef(new Set<string>());

  const load = useCallback((dir: string) => {
    if (requested.current.has(dir)) return;
    requested.current.add(dir);
    setChildren((m) => new Map(m).set(dir, 'loading'));
    api()
      .listDir(dir)
      .then((entries) => setChildren((m) => new Map(m).set(dir, entries)))
      .catch((err: unknown) =>
        setChildren((m) => new Map(m).set(dir, { error: err instanceof Error ? err.message : String(err) })),
      );
  }, []);

  useEffect(() => {
    requested.current.clear();
    setChildren(new Map());
  }, [rootPath, reloadKey]);

  // Reload just the folder that changed on disk, if it's currently shown.
  useEffect(() => {
    if (!changed) return;
    const dir = changed.dir;
    if (!requested.current.has(dir)) return;
    api()
      .listDir(dir)
      .then((entries) => setChildren((m) => new Map(m).set(dir, entries)))
      .catch(() => undefined);
  }, [changed]);

  useEffect(() => {
    load(rootPath);
    expanded.forEach((dir) => load(dir));
  }, [rootPath, expanded, load, children]);

  // Keep the selected row visible when it changes from outside the tree.
  const selectedRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedPath, children]);

  const renderLevel = (dir: string, depth: number): React.ReactNode => {
    const list = children.get(dir);
    if (!list || list === 'loading') {
      return (
        <div className="tree-note" style={{ paddingLeft: 12 + depth * 14 }}>
          Loading…
        </div>
      );
    }
    if (!Array.isArray(list)) {
      return (
        <div className="tree-note error" style={{ paddingLeft: 12 + depth * 14 }}>
          {list.error}
        </div>
      );
    }
    if (!list.length) {
      return (
        <div className="tree-note" style={{ paddingLeft: 12 + depth * 14 }}>
          Empty
        </div>
      );
    }
    return list.map((entry) => {
      const isOpen = entry.isDir && expanded.has(entry.path);
      const isSelected = entry.path === selectedPath;
      return (
        <div key={entry.path} role="treeitem" aria-expanded={entry.isDir ? isOpen : undefined}>
          <button
            ref={isSelected ? selectedRef : undefined}
            className={`tree-row${isSelected ? ' selected' : ''}${entry.heavy ? ' heavy' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => {
              onSelect(entry);
              if (entry.isDir && !isOpen) onToggle(entry.path);
            }}
            onDoubleClick={() => {
              if (!entry.isDir) void api().openPath(entry.path);
            }}
            title={entry.heavy ? `${entry.name} (dependencies / build output)` : entry.name}
          >
            {entry.isDir ? (
              <span
                className={`tree-chevron${isOpen ? ' open' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(entry.path);
                }}
              >
                <ChevronIcon />
              </span>
            ) : (
              <span className="tree-chevron placeholder" />
            )}
            {entry.isDir ? (
              <FolderIcon className="folder-icon" open={isOpen} />
            ) : (
              <FileIcon category={categorize(entry.name)} />
            )}
            <span className="tree-name">{entry.name}</span>
          </button>
          {isOpen && <div role="group">{renderLevel(entry.path, depth + 1)}</div>}
        </div>
      );
    });
  };

  return (
    <div className="tree" role="tree">
      {renderLevel(rootPath, 0)}
    </div>
  );
}
