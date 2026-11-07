import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FsChange, ProjectSummary, QuickFindItem, Settings } from '../shared/types';
import { CommandPalette } from './components/CommandPalette';
import { Dashboard } from './components/Dashboard';
import { type OpenTarget, ProjectView } from './components/ProjectView';
import { SearchPanel } from './components/SearchPanel';
import { GitHubDialog } from './components/GitHubDialog';
import { NewProjectDialog } from './components/NewProjectDialog';
import { EasyEdaDialog } from './components/EasyEdaDialog';
import { api } from './lib/format';
import appIcon from './assets/icon.svg';

type Overlay = { kind: 'palette' } | { kind: 'search'; query: string } | { kind: 'new' } | { kind: 'github' } | { kind: 'easyeda' } | null;

export function App() {
  const [settings, setSettings] = useState<Settings | undefined>(undefined);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [target, setTarget] = useState<OpenTarget | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [fsChange, setFsChange] = useState<(FsChange & { n: number }) | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showError = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async (fresh: boolean) => {
    setLoading(true);
    setError(null);
    try {
      setProjects(fresh ? await api().rescan() : await api().listProjects());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const offProjects = api().onProjectsUpdated((list) => {
      setProjects(list);
      setLoading(false);
    });
    let n = 0;
    const offFs = api().onFsChanged((change) => setFsChange({ ...change, n: ++n }));
    api()
      .getSettings()
      .then((s) => {
        setSettings(s);
        if (s.root) void load(false);
      })
      .catch(() => setSettings({ root: null, pinned: [], recent: [] }));
    return () => {
      offProjects();
      offFs();
    };
  }, [load]);

  // Global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && (e.key === 'k' || e.key === 'p')) {
        e.preventDefault();
        setOverlay({ kind: 'palette' });
      } else if (mod && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault();
        setOverlay({ kind: 'search', query: '' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const chooseRoot = useCallback(async () => {
    const picked = await api().chooseRoot();
    if (picked) {
      setSettings(await api().getSettings());
      setOpenPath(null);
      setProjects([]);
      void load(false);
    }
  }, [load]);

  const open = useCallback(
    (path: string, file?: { path: string; line?: number }) => {
      setOpenPath(path);
      setTarget(file ? { path: file.path, line: file.line, n: Date.now() } : null);
      setSettings((s) => {
        if (!s) return s;
        const recent = [path, ...s.recent.filter((r) => r !== path)].slice(0, 12);
        void api().updateSettings({ recent });
        return { ...s, recent };
      });
    },
    [],
  );

  const togglePin = useCallback((path: string) => {
    setSettings((s) => {
      if (!s) return s;
      const pinned = s.pinned.includes(path) ? s.pinned.filter((p) => p !== path) : [...s.pinned, path];
      void api().updateSettings({ pinned });
      return { ...s, pinned };
    });
  }, []);

  const back = useCallback(() => setOpenPath(null), []);

  // From the EasyEDA extension: "Open in Benchtop" and finished exports.
  useEffect(() => {
    const offNav = api().onNavigate(({ projectPath }) => {
      setOverlay(null);
      open(projectPath);
    });
    const offExp = api().onEasyEdaExported((e) => {
      const name = e.projectPath.split(/[\\/]/).pop();
      const failed = e.failed.length ? ` (${e.failed.length} failed: ${e.failed.map((f) => f.kind).join(', ')})` : '';
      setToast(`EasyEDA: saved ${e.written.length} file${e.written.length === 1 ? '' : 's'} to ${name}/${e.relDir}${failed}`);
    });
    return () => {
      offNav();
      offExp();
    };
  }, [open]);

  const allTags = useMemo(() => [...new Set(projects.flatMap((p) => p.meta.tags ?? []))].sort(), [projects]);
  const current = openPath ? projects.find((p) => p.path === openPath) : undefined;
  const groups = useMemo(() => [...new Set(projects.map((p) => p.group).filter((g): g is string => !!g))].sort(), [projects]);

  const onPaletteOpen = (item: QuickFindItem) => {
    setOverlay(null);
    open(item.projectPath, item.kind === 'file' ? { path: item.path } : undefined);
  };

  if (settings === undefined) return null;

  if (!settings.root) {
    return (
      <div className="welcome">
        <div className="brand large">
          <img className="brand-mark" src={appIcon} alt="" />
          Benchtop
        </div>
        <p className="muted">Pick the folder that holds your projects. Benchtop never moves or deletes anything in it.</p>
        <button className="button primary" onClick={() => void chooseRoot()}>
          Choose projects folder
        </button>
      </div>
    );
  }

  return (
    <>
      {current ? (
        <ProjectView
          key={current.path}
          project={current}
          allTags={allTags}
          pinned={settings.pinned.includes(current.path)}
          target={target}
          fsChange={fsChange}
          onBack={back}
          onTogglePin={() => togglePin(current.path)}
          onError={showError}
          onLinkEasyEda={() => setOverlay({ kind: 'easyeda' })}
        />
      ) : (
        <Dashboard
          root={settings.root}
          projects={projects}
          pinned={settings.pinned}
          recent={settings.recent}
          loading={loading}
          error={error}
          onOpen={(p) => open(p)}
          onTogglePin={togglePin}
          onRefresh={() => void load(true)}
          onChangeRoot={() => void chooseRoot()}
          onQuickOpen={() => setOverlay({ kind: 'palette' })}
          onSearch={() => setOverlay({ kind: 'search', query: '' })}
          onNewProject={() => setOverlay({ kind: 'new' })}
          onGitHub={() => setOverlay({ kind: 'github' })}
          onEasyEda={() => setOverlay({ kind: 'easyeda' })}
        />
      )}

      {overlay?.kind === 'palette' && (
        <CommandPalette
          onClose={() => setOverlay(null)}
          onOpen={onPaletteOpen}
          onSearchInFiles={(query) => setOverlay({ kind: 'search', query })}
        />
      )}
      {overlay?.kind === 'search' && (
        <SearchPanel
          initialQuery={overlay.query}
          currentProject={current ? { path: current.path, name: current.name } : null}
          onClose={() => setOverlay(null)}
          onOpen={(projectPath, filePath, line) => {
            setOverlay(null);
            open(projectPath, { path: filePath, line });
          }}
        />
      )}
      {overlay?.kind === 'new' && (
        <NewProjectDialog
          root={settings.root}
          groups={groups}
          onClose={() => setOverlay(null)}
          onCreated={(path) => {
            setOverlay(null);
            setToast('Project created.');
            void api()
              .listProjects()
              .then((list) => {
                setProjects(list);
                open(path);
              });
          }}
        />
      )}
      {overlay?.kind === 'github' && <GitHubDialog onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'easyeda' && (
        <EasyEdaDialog
          projects={projects}
          onClose={() => setOverlay(null)}
          onDone={(m) => {
            setOverlay(null);
            setToast(m);
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </>
  );
}
