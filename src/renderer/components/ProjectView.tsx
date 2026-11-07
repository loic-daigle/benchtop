import { useCallback, useEffect, useRef, useState } from 'react';
import type { DirEntry, FsChange, ProjectSummary } from '../../shared/types';
import { api, dirname, splitPath } from '../lib/format';
import { Badges, StatusPill } from './Badges';
import { FileTree } from './FileTree';
import { BackIcon, CodeIcon, FolderOpenIcon, ForwardIcon, PinIcon, RefreshIcon, TerminalIcon } from './Icons';
import { ReleasesPanel } from './ReleasesPanel';
import { NotesPanel } from './NotesPanel';
import { OverviewPanel } from './OverviewPanel';
import { Preview } from './Preview';
import { PublishDialog, SyncDialog } from './PublishDialog';
import { StructureDialog } from './StructureDialog';

export type ProjectTab = 'files' | 'overview' | 'releases' | 'notes';

export interface OpenTarget {
  path: string;
  line?: number;
  /** Changes on every request so the same file can be revealed twice. */
  n: number;
}

interface Props {
  project: ProjectSummary;
  allTags: string[];
  pinned: boolean;
  target: OpenTarget | null;
  fsChange: (FsChange & { n: number }) | null;
  onBack: () => void;
  onTogglePin: () => void;
  onError: (message: string) => void;
  onLinkEasyEda: () => void;
}

interface Selection {
  entry: DirEntry;
  line?: number;
}

function rootEntry(project: ProjectSummary): DirEntry {
  return { name: project.name, path: project.path, isDir: true, size: 0, modified: project.modified, heavy: false };
}

/** All folders between the project root (exclusive) and `target` (exclusive). */
function ancestorsOf(root: string, target: string): string[] {
  const rootParts = splitPath(root).length;
  const sep = target.includes('\\') ? '\\' : '/';
  const parts = splitPath(target);
  const prefix = target.startsWith('/') ? '/' : target.startsWith('\\\\') ? '\\\\' : '';
  const result: string[] = [];
  for (let i = rootParts + 1; i < parts.length; i++) result.push(prefix + parts.slice(0, i).join(sep));
  return result;
}

const expandedKey = (p: string) => `benchtop.expanded:${p}`;
const tabKey = 'benchtop.tab';

function loadExpanded(projectPath: string): Set<string> {
  try {
    const raw = localStorage.getItem(expandedKey(projectPath));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function ProjectView({ project, allTags, pinned, target, fsChange, onBack, onTogglePin, onError, onLinkEasyEda }: Props) {
  const [tab, setTabState] = useState<ProjectTab>(() => {
    try {
      return (localStorage.getItem(tabKey) as ProjectTab) || 'files';
    } catch {
      return 'files';
    }
  });
  const [selected, setSelected] = useState<Selection>(() => ({ entry: rootEntry(project) }));
  const [past, setPast] = useState<Selection[]>([]);
  const [future, setFuture] = useState<Selection[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded(project.path));
  const [reloadKey, setReloadKey] = useState(0);
  const [treeChange, setTreeChange] = useState<{ dir: string; n: number } | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [dialog, setDialog] = useState<'publish' | 'sync' | 'structure' | null>(null);
  const projectPathRef = useRef(project.path);
  projectPathRef.current = project.path;

  const setTab = (t: ProjectTab) => {
    setTabState(t);
    try {
      localStorage.setItem(tabKey, t);
    } catch {
      /* ignore */
    }
  };

  const run = useCallback(
    (p: Promise<unknown>) => p.catch((err: unknown) => onError(err instanceof Error ? err.message : String(err))),
    [onError],
  );

  // Remember open folders per project.
  useEffect(() => {
    try {
      localStorage.setItem(expandedKey(project.path), JSON.stringify([...expanded]));
    } catch {
      /* ignore */
    }
  }, [expanded, project.path]);

  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const pastRef = useRef(past);
  pastRef.current = past;
  const futureRef = useRef(future);
  futureRef.current = future;

  const reveal = useCallback(
    (sel: Selection, record = true) => {
      const prev = selectedRef.current;
      if (record && prev.entry.path !== sel.entry.path) {
        setPast([...pastRef.current.slice(-49), prev]);
        setFuture([]);
      }
      setSelected(sel);
      const parents = ancestorsOf(projectPathRef.current, sel.entry.path);
      if (parents.length) {
        setExpanded((prev) => {
          if (parents.every((p) => prev.has(p))) return prev;
          const next = new Set(prev);
          parents.forEach((p) => next.add(p));
          return next;
        });
      }
    },
    [],
  );

  /** Find a path on disk and select it (README links, quick-open, search results). */
  const openPath = useCallback(
    (targetPath: string, line?: number) => {
      if (targetPath === projectPathRef.current) {
        reveal({ entry: rootEntry(project) });
        return;
      }
      api()
        .listDir(dirname(targetPath))
        .then((list) => {
          const entry = list.find((e) => e.path.toLowerCase() === targetPath.toLowerCase());
          if (entry) reveal({ entry, line });
          else onError(`Couldn’t find ${targetPath}`);
        })
        .catch(() => onError(`Couldn’t find ${targetPath}`));
    },
    [project, reveal, onError],
  );

  // New project: reset, open the README by default (like GitHub).
  useEffect(() => {
    setSelected({ entry: rootEntry(project) });
    setPast([]);
    setFuture([]);
    setExpanded(loadExpanded(project.path));
    if (target) return;
    if (project.readmePath) {
      api()
        .listDir(project.path)
        .then((list) => {
          const readme = list.find((e) => e.path === project.readmePath);
          if (readme && projectPathRef.current === project.path) setSelected({ entry: readme });
        })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.path]);

  // Requests from quick-open / search.
  useEffect(() => {
    if (!target) return;
    setTab('files');
    openPath(target.path, target.line);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.n]);

  // Live updates from the file watcher.
  useEffect(() => {
    if (!fsChange || fsChange.projectPath !== project.path) return;
    setTreeChange({ dir: fsChange.dir ?? project.path, n: fsChange.n });
    const selDir = selected.entry.isDir ? selected.entry.path : dirname(selected.entry.path);
    if (!fsChange.dir || fsChange.dir === selDir) {
      api()
        .listDir(dirname(selected.entry.path))
        .then((list) => {
          const fresh = list.find((e) => e.path === selected.entry.path);
          if (fresh && fresh.modified !== selected.entry.modified) setSelected((s) => ({ ...s, entry: fresh }));
          else if (selected.entry.isDir) setPreviewKey((k) => k + 1);
        })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fsChange?.n]);

  const goBack = useCallback(() => {
    const p = pastRef.current;
    if (!p.length) return;
    setFuture([selectedRef.current, ...futureRef.current]);
    setPast(p.slice(0, -1));
    reveal(p[p.length - 1], false);
  }, [reveal]);
  const goForward = useCallback(() => {
    const f = futureRef.current;
    if (!f.length) return;
    setPast([...pastRef.current, selectedRef.current]);
    setFuture(f.slice(1));
    reveal(f[0], false);
  }, [reveal]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (e.key === 'Escape' && !typing && !document.querySelector('.overlay')) onBack();
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        goBack();
      }
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        goForward();
      }
    };
    // Mouse side buttons
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) goBack();
      if (e.button === 4) goForward();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mouseup', onMouse);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mouseup', onMouse);
    };
  }, [onBack, goBack, goForward]);

  const toggle = useCallback((dir: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  }, []);

  const setCover = (relPath: string) =>
    void run(api().saveMeta(project.path, { ...project.meta, cover: relPath.replace(/\\/g, '/') }));

  const noteTasks = project.notesPath ? '•' : '';

  return (
    <div className="project">
      <header className="topbar">
        <button className="icon-button" onClick={onBack} title="All projects (Esc)">
          <BackIcon />
        </button>
        <div className="project-title">
          {project.group && <span className="muted">{project.group} / </span>}
          <button className="project-name" onClick={() => reveal({ entry: rootEntry(project) })} title={project.path}>
            {project.name}
          </button>
          <StatusPill status={project.meta.status} />
        </div>
        <nav className="tabs" role="tablist">
          {(['files', 'overview', 'releases', 'notes'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {t === 'files' ? 'Files' : t === 'overview' ? 'Overview' : t === 'releases' ? 'Releases' : 'Notes'}
              {t === 'notes' && noteTasks && <span className="tab-dot" />}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <button className="icon-button" title="Open in VS Code" onClick={() => void run(api().openInEditor(project.path))}>
          <CodeIcon />
        </button>
        <button className="icon-button" title="Open terminal here" onClick={() => void run(api().openTerminal(project.path))}>
          <TerminalIcon />
        </button>
        <button className="icon-button" title="Open folder in Explorer" onClick={() => void run(api().openPath(project.path))}>
          <FolderOpenIcon />
        </button>
        <button className={`icon-button${pinned ? ' pinned' : ''}`} title={pinned ? 'Unpin' : 'Pin to top'} onClick={onTogglePin}>
          <PinIcon filled={pinned} />
        </button>
        <button
          className="icon-button"
          title="Reload"
          onClick={() => {
            setReloadKey((k) => k + 1);
            setPreviewKey((k) => k + 1);
          }}
        >
          <RefreshIcon />
        </button>
      </header>

      {tab === 'files' && (
        <div className="project-body">
          <aside className="sidebar">
            <div className="sidebar-head">
              <button className="icon-button small" disabled={!past.length} onClick={goBack} title="Back (Alt+←)">
                <BackIcon size={14} />
              </button>
              <button className="icon-button small" disabled={!future.length} onClick={goForward} title="Forward (Alt+→)">
                <ForwardIcon size={14} />
              </button>
              <button
                className={`tree-row root${selected.entry.path === project.path ? ' selected' : ''}`}
                onClick={() => reveal({ entry: rootEntry(project) })}
              >
                {project.name}
              </button>
              {expanded.size > 0 && (
                <button className="link-button small" onClick={() => setExpanded(new Set())} title="Collapse all folders">
                  Collapse
                </button>
              )}
            </div>
            <FileTree
              rootPath={project.path}
              selectedPath={selected.entry.path}
              expanded={expanded}
              onToggle={toggle}
              onSelect={(entry) => reveal({ entry })}
              reloadKey={reloadKey}
              changed={treeChange}
            />
          </aside>
          <div className="content">
            <Preview
              key={`${selected.entry.path}:${reloadKey}:${previewKey}:${selected.line ?? ''}`}
              entry={selected.entry}
              projectPath={project.path}
              revealLine={selected.line}
              isCover={!!project.meta.cover && project.thumbnailPath === selected.entry.path}
              onSelect={(entry) => reveal({ entry })}
              onOpenPath={(p) => openPath(p)}
              onSetCover={setCover}
              onError={onError}
            />
          </div>
        </div>
      )}

      {tab === 'overview' && (
        <div className="project-scroll">
          <div className="overview-header">
            <Badges project={project} />
          </div>
          <OverviewPanel
            project={project}
            allTags={allTags}
            onSaved={() => undefined}
            onError={onError}
            onShowFiles={() => setTab('files')}
            onPublish={() => setDialog('publish')}
            onSync={() => setDialog('sync')}
            onStructure={() => setDialog('structure')}
            onOpenFile={(p) => {
              setTab('files');
              openPath(p);
            }}
            onLinkEasyEda={onLinkEasyEda}
          />
        </div>
      )}

      {dialog === 'publish' && (
        <PublishDialog project={project} onClose={() => setDialog(null)} onDone={(m) => onError(m)} />
      )}
      {dialog === 'sync' && (
        <SyncDialog
          project={project}
          onClose={() => setDialog(null)}
          onDone={(m) => {
            setDialog(null);
            onError(m);
          }}
        />
      )}
      {dialog === 'structure' && (
        <StructureDialog
          projectPath={project.path}
          projectName={project.name}
          onClose={() => setDialog(null)}
          onDone={(m) => {
            setDialog(null);
            setReloadKey((k) => k + 1);
            onError(m);
          }}
        />
      )}

      {tab === 'releases' && (
        <div className="project-scroll">
          <ReleasesPanel
            key={project.path}
            project={project}
            changeKey={fsChange?.projectPath === project.path ? fsChange.n : 0}
            onOpenFile={(p) => {
              setTab('files');
              openPath(p);
            }}
            onError={onError}
          />
        </div>
      )}

      {tab === 'notes' && (
        <div className="project-scroll">
          <NotesPanel key={project.path} projectPath={project.path} onError={onError} />
        </div>
      )}
    </div>
  );
}
