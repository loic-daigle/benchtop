import { useMemo, useState } from 'react';
import type { ProjectStatus, ProjectSummary } from '../../shared/types';
import { STATUS_LABEL, STATUSES } from '../lib/status';
import { ChipIcon, GitHubIcon, PlusIcon, RefreshIcon, SearchFilesIcon, SearchIcon } from './Icons';
import { ProjectCard } from './ProjectCard';
import appIcon from '../assets/icon.svg';

type Sort = 'recent' | 'name' | 'status';
type StatusFilter = 'all' | ProjectStatus | 'none';
type ContentFilter = 'any' | 'git' | 'code' | 'pcb' | 'cad';

interface Props {
  root: string;
  projects: ProjectSummary[];
  pinned: string[];
  recent: string[];
  loading: boolean;
  error: string | null;
  onOpen: (path: string) => void;
  onTogglePin: (path: string) => void;
  onRefresh: () => void;
  onChangeRoot: () => void;
  onQuickOpen: () => void;
  onSearch: () => void;
  onNewProject: () => void;
  onGitHub: () => void;
  onEasyEda: () => void;
}

function stored<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

const STATUS_ORDER: Record<string, number> = { active: 0, idea: 1, paused: 2, done: 3, archived: 4, none: 5 };

export function Dashboard(props: Props) {
  const { root, projects, pinned, recent, loading, error, onOpen, onTogglePin } = props;
  const [query, setQuery] = useState('');
  const [sort, setSortState] = useState<Sort>(() => stored('benchtop.sort', 'recent'));
  const [status, setStatusState] = useState<StatusFilter>(() => stored('benchtop.status', 'all'));
  const [tag, setTagState] = useState<string>(() => stored('benchtop.tag', ''));
  const [content, setContentState] = useState<ContentFilter>(() => stored('benchtop.content', 'any'));

  const setSort = (v: Sort) => (setSortState(v), store('benchtop.sort', v));
  const setStatus = (v: StatusFilter) => (setStatusState(v), store('benchtop.status', v));
  const setTag = (v: string) => (setTagState(v), store('benchtop.tag', v));
  const setContent = (v: ContentFilter) => (setContentState(v), store('benchtop.content', v));

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { all: 0, none: 0 };
    for (const p of projects) {
      const s = p.meta.status ?? 'none';
      c[s] = (c[s] ?? 0) + 1;
      if (s !== 'archived') c.all++;
    }
    return c;
  }, [projects]);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    projects.forEach((p) => p.meta.tags?.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [projects]);

  const filtersActive = query.trim() !== '' || status !== 'all' || tag !== '' || content !== 'any';

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = projects.filter((p) => {
      const s = p.meta.status ?? 'none';
      if (status === 'all' ? s === 'archived' : s !== status) return false;
      if (tag && !p.meta.tags?.includes(tag)) return false;
      if (content === 'git' && !(p.isGitRepo || p.containsGitRepo)) return false;
      if (content === 'code' && !p.counts.code) return false;
      if (content === 'pcb' && !p.counts.pcb) return false;
      if (content === 'cad' && !p.counts.cad) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.group?.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        p.meta.tags?.some((t) => t.includes(q))
      );
    });
    list.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
      if (sort === 'status') {
        const d = STATUS_ORDER[a.meta.status ?? 'none'] - STATUS_ORDER[b.meta.status ?? 'none'];
        if (d) return d;
      }
      return b.modified - a.modified;
    });
    return list;
  }, [projects, query, status, tag, content, sort]);

  const pinnedSet = new Set(pinned);
  const byPath = new Map(projects.map((p) => [p.path, p]));
  const pinnedVisible = visible.filter((p) => pinnedSet.has(p.path));
  const others = visible.filter((p) => !pinnedSet.has(p.path));
  const recentProjects = recent.map((r) => byPath.get(r)).filter((p): p is ProjectSummary => !!p).slice(0, 8);

  const card = (p: ProjectSummary) => (
    <ProjectCard
      key={p.path}
      project={p}
      pinned={pinnedSet.has(p.path)}
      onOpen={() => onOpen(p.path)}
      onTogglePin={() => onTogglePin(p.path)}
    />
  );

  return (
    <div className="dashboard">
      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src={appIcon} alt="" />
          Benchtop
        </div>
        <button className="root-button" onClick={props.onChangeRoot} title="Change projects folder">
          {root}
        </button>
        <div className="spacer" />
        <button className="button primary small" onClick={props.onNewProject}>
          <PlusIcon size={14} /> New project
        </button>
        <button className="kbd-button" onClick={props.onQuickOpen} title="Jump to any project or file">
          <SearchIcon size={14} />
          Go to… <kbd>Ctrl K</kbd>
        </button>
        <button className="icon-button" onClick={props.onSearch} title="Search in files (Ctrl+Shift+F)">
          <SearchFilesIcon />
        </button>
        <button className="icon-button" onClick={props.onEasyEda} title="EasyEDA: extension and linked projects">
          <ChipIcon />
        </button>
        <button className="icon-button" onClick={props.onGitHub} title="GitHub account">
          <GitHubIcon />
        </button>
        <button className="icon-button" onClick={props.onRefresh} disabled={loading} title="Rescan folder">
          <span className={loading ? 'spin' : ''}>
            <RefreshIcon />
          </span>
        </button>
      </header>

      <main className="dashboard-main">
        {error && <div className="notice error">{error}</div>}

        {recentProjects.length > 0 && !filtersActive && (
          <section className="recent">
            <span className="section-label">Recently opened</span>
            <div className="recent-list">
              {recentProjects.map((p) => (
                <button key={p.path} className="recent-chip" onClick={() => onOpen(p.path)} title={p.path}>
                  {p.name}
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="filters">
          <label className="search">
            <SearchIcon />
            <input
              type="search"
              placeholder="Filter projects"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </label>
          <div className="chips" role="tablist" aria-label="Status">
            <button className={`chip${status === 'all' ? ' active' : ''}`} onClick={() => setStatus('all')}>
              All <span className="chip-count">{statusCounts.all}</span>
            </button>
            {STATUSES.map((s) => (
              <button
                key={s}
                className={`chip chip-${s}${status === s ? ' active' : ''}`}
                onClick={() => setStatus(status === s ? 'all' : s)}
              >
                {STATUS_LABEL[s]} <span className="chip-count">{statusCounts[s] ?? 0}</span>
              </button>
            ))}
            {statusCounts.none > 0 && (
              <button
                className={`chip${status === 'none' ? ' active' : ''}`}
                onClick={() => setStatus(status === 'none' ? 'all' : 'none')}
                title="Projects without a status yet"
              >
                No status <span className="chip-count">{statusCounts.none}</span>
              </button>
            )}
          </div>
          <div className="spacer" />
          <select className="select" value={content} onChange={(e) => setContent(e.target.value as ContentFilter)} aria-label="Contains">
            <option value="any">Any content</option>
            <option value="git">Has Git</option>
            <option value="code">Has code</option>
            <option value="pcb">Has PCB</option>
            <option value="cad">Has 3D</option>
          </select>
          {allTags.length > 0 && (
            <select className="select" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
              <option value="">All tags</option>
              {allTags.map(([t, n]) => (
                <option key={t} value={t}>
                  #{t} ({n})
                </option>
              ))}
            </select>
          )}
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
            <option value="recent">Recently modified</option>
            <option value="name">Name</option>
            <option value="status">Status</option>
          </select>
        </div>

        {loading && !projects.length ? (
          <div className="grid">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="card skeleton" />
            ))}
          </div>
        ) : (
          <>
            {pinnedVisible.length > 0 && (
              <section>
                <h2 className="section-title">Pinned</h2>
                <div className="grid">{pinnedVisible.map(card)}</div>
              </section>
            )}
            <section>
              <h2 className="section-title">
                {pinnedVisible.length ? 'Projects' : status === 'all' ? 'All projects' : STATUS_LABEL[status as ProjectStatus] ?? 'No status'}
                <span className="muted"> {filtersActive ? `${visible.length} of ${projects.length}` : visible.length}</span>
                {filtersActive && (
                  <button
                    className="link-button"
                    onClick={() => {
                      setQuery('');
                      setStatus('all');
                      setTag('');
                      setContent('any');
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </h2>
              {others.length ? (
                <div className="grid">{others.map(card)}</div>
              ) : (
                <div className="empty">{pinnedVisible.length ? 'Everything here is pinned.' : 'No project matches these filters.'}</div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
