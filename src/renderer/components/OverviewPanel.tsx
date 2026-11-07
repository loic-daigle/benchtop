import { useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORY_LABEL } from '../../shared/fileKinds';
import type { FileCategory, ProjectLink, ProjectMeta, ProjectStatus, ProjectSummary } from '../../shared/types';
import { api, dirname, formatDate, formatRelative, relativePath, thumbUrl } from '../lib/format';
import { LINK_PRESETS, STATUS_LABEL, STATUSES, linkName } from '../lib/status';
import { BranchIcon, CloseIcon, FileIcon, LinkIcon, PlusIcon } from './Icons';
import { PcbPanel } from './PcbPanel';

interface Props {
  project: ProjectSummary;
  allTags: string[];
  onSaved: (p: ProjectSummary) => void;
  onError: (message: string) => void;
  onShowFiles: () => void;
  onPublish: () => void;
  onSync: () => void;
  onStructure: () => void;
  onOpenFile: (path: string) => void;
  onLinkEasyEda: () => void;
}

function sameMeta(a: ProjectMeta, b: ProjectMeta): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}
function normalize(m: ProjectMeta): ProjectMeta {
  return {
    status: m.status,
    description: m.description?.trim() || undefined,
    tags: m.tags?.length ? m.tags : undefined,
    cover: m.cover || undefined,
    links: m.links?.filter((l) => l.url.trim()).length ? m.links.filter((l) => l.url.trim()) : undefined,
    easyeda: m.easyeda,
  };
}

export function OverviewPanel({ project, allTags, onSaved, onError, onShowFiles, onPublish, onSync, onStructure, onOpenFile, onLinkEasyEda }: Props) {
  const [draft, setDraft] = useState<ProjectMeta>(project.meta);
  const [saving, setSaving] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const dirty = !sameMeta(draft, project.meta);
  // A new link row with no URL yet isn't a change to save, but it is something being edited.
  const editing = dirty || (draft.links ?? []).some((l) => !l.url.trim());

  // Pick up outside changes (e.g. project.yaml edited in VS Code) when nothing is being edited.
  // The project list refreshes often in the background, so only react when project.yaml really changed.
  const lastMeta = useRef(JSON.stringify(project.meta));
  useEffect(() => {
    const now = JSON.stringify(project.meta);
    if (now === lastMeta.current) return;
    lastMeta.current = now;
    if (!editing) setDraft(project.meta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.meta]);

  const update = (patch: Partial<ProjectMeta>) => setDraft((d) => ({ ...d, ...patch }));
  const links = draft.links ?? [];
  const setLinks = (next: ProjectLink[]) => update({ links: next });

  const addTag = (raw: string) => {
    const tags = raw
      .split(/[,\s]+/)
      .map((t) => t.trim().toLowerCase().replace(/^#/, ''))
      .filter(Boolean);
    if (!tags.length) return;
    update({ tags: [...new Set([...(draft.tags ?? []), ...tags])] });
    setTagInput('');
  };

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api().saveMeta(project.path, normalize(draft));
      onSaved(updated);
      setDraft(updated.meta);
    } catch (err) {
      onError(`Couldn’t save project.yaml: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const suggestions = useMemo(
    () => allTags.filter((t) => !draft.tags?.includes(t) && (!tagInput || t.includes(tagInput.toLowerCase()))).slice(0, 8),
    [allTags, draft.tags, tagInput],
  );
  const missingPresets = LINK_PRESETS.filter((p) => !links.some((l) => l.label.toLowerCase() === p.label));
  const g = project.git;
  const counts = Object.entries(project.counts).filter(([, n]) => n > 0) as Array<[FileCategory, number]>;

  return (
    <div className="overview">
      <div className="overview-main">
        {project.metaError && <div className="notice error">{project.metaError} — fix it or save here to rewrite it.</div>}

        <section className="panel">
          <h3>Status</h3>
          <div className="status-picker">
            {STATUSES.map((s) => (
              <button
                key={s}
                className={`status-option status-${s}${draft.status === s ? ' active' : ''}`}
                onClick={() => update({ status: draft.status === s ? undefined : (s as ProjectStatus) })}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <h3>Description</h3>
          <textarea
            className="input"
            rows={3}
            placeholder={project.description && !project.meta.description ? `From README: ${project.description}` : 'One or two lines about this project'}
            value={draft.description ?? ''}
            onChange={(e) => update({ description: e.target.value })}
          />
        </section>

        <section className="panel">
          <h3>Tags</h3>
          <div className="tag-editor">
            {(draft.tags ?? []).map((t) => (
              <span key={t} className="tag removable">
                #{t}
                <button aria-label={`Remove ${t}`} onClick={() => update({ tags: draft.tags?.filter((x) => x !== t) })}>
                  <CloseIcon size={11} />
                </button>
              </span>
            ))}
            <input
              className="tag-input"
              placeholder="Add tag (esp32, usb-c, video…)"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addTag(tagInput);
                } else if (e.key === 'Backspace' && !tagInput && draft.tags?.length) {
                  update({ tags: draft.tags.slice(0, -1) });
                }
              }}
              onBlur={() => tagInput && addTag(tagInput)}
            />
          </div>
          {suggestions.length > 0 && (
            <div className="tag-suggestions">
              {suggestions.map((t) => (
                <button
                  key={t}
                  className="tag ghost"
                  // Keep focus in the input: otherwise its blur would first add the half-typed text.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => addTag(t)}
                >
                  +#{t}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <h3>Links</h3>
          {links.map((l, i) => (
            <div key={i} className="link-row">
              <input
                className="input link-label"
                value={l.label}
                placeholder="Label"
                onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              />
              <input
                className="input"
                value={l.url}
                placeholder={LINK_PRESETS.find((p) => p.label === l.label.toLowerCase())?.placeholder ?? 'https://…'}
                onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
              />
              <button
                className="icon-button"
                title="Open"
                disabled={!/^https?:\/\//i.test(l.url)}
                onClick={() => void api().openExternal(l.url)}
              >
                <LinkIcon />
              </button>
              <button className="icon-button" title="Remove" onClick={() => setLinks(links.filter((_, j) => j !== i))}>
                <CloseIcon />
              </button>
            </div>
          ))}
          <div className="link-presets">
            {missingPresets.map((p) => (
              <button key={p.label} className="chip" onClick={() => setLinks([...links, { label: p.label, url: '' }])}>
                <PlusIcon size={12} /> {p.name}
              </button>
            ))}
            <button className="chip" onClick={() => setLinks([...links, { label: '', url: '' }])}>
              <PlusIcon size={12} /> Other
            </button>
          </div>
        </section>

        <PcbPanel project={project} onOpenFile={onOpenFile} onLinkAll={onLinkEasyEda} onMessage={onError} />

        <section className="panel">
          <h3>Cover image</h3>
          <div className="cover-row">
            {project.thumbnailPath ? (
              <img className="cover-preview" src={thumbUrl(project.thumbnailPath, 320)} alt="" />
            ) : (
              <div className="cover-preview empty">No image</div>
            )}
            <div className="cover-text">
              <div>
                {draft.cover
                  ? draft.cover
                  : project.thumbnailPath
                    ? `Picked automatically: ${relativePath(project.path, project.thumbnailPath)}`
                    : 'No image found in this project.'}
              </div>
              <div className="muted small">
                To choose one, open an image in the{' '}
                <button className="link-button" onClick={onShowFiles}>
                  Files tab
                </button>{' '}
                and click “Set as cover”.
              </div>
              {draft.cover && (
                <button className="link-button" onClick={() => update({ cover: undefined })}>
                  Use automatic cover
                </button>
              )}
            </div>
          </div>
        </section>

        <div className={`save-bar${dirty ? ' visible' : ''}`}>
          <span className="muted small">Saved to project.yaml in this project</span>
          <div className="spacer" />
          <button className="button ghost" disabled={!dirty || saving} onClick={() => setDraft(project.meta)}>
            Discard
          </button>
          <button className="button primary small" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <aside className="overview-side">
        <section className="panel">
          <h3>
            <BranchIcon size={14} /> Git
          </h3>
          {!project.isGitRepo ? (
            <>
              <p className="muted small">
                {project.containsGitRepo ? 'A git repository exists in a subfolder.' : 'Not a git repository yet.'}
              </p>
              <button className="button primary small full" onClick={onPublish}>
                Publish to GitHub
              </button>
            </>
          ) : !g ? (
            <p className="muted small">Git isn’t installed or couldn’t read this repository.</p>
          ) : (
            <dl className="facts">
              <dt>Branch</dt>
              <dd>{g.branch ?? '—'}</dd>
              <dt>Changes</dt>
              <dd className={g.changes ? 'warn' : ''}>{g.changes ? `${g.changes} uncommitted` : 'Clean'}</dd>
              {(g.ahead > 0 || g.behind > 0) && (
                <>
                  <dt>Sync</dt>
                  <dd>
                    {g.ahead ? `${g.ahead} to push` : ''}
                    {g.ahead && g.behind ? ' · ' : ''}
                    {g.behind ? `${g.behind} to pull` : ''}
                  </dd>
                </>
              )}
              <dt>Last commit</dt>
              <dd title={g.lastCommit ? formatDate(g.lastCommit.date) : ''}>
                {g.lastCommit ? (
                  <>
                    {g.lastCommit.subject}
                    <span className="muted small"> · {formatRelative(g.lastCommit.date)}</span>
                  </>
                ) : (
                  'No commits yet'
                )}
              </dd>
              <dt>Remote</dt>
              <dd>
                {g.webUrl ? (
                  <button className="link-button" onClick={() => void api().openExternal(g.webUrl!)}>
                    {g.webUrl.replace(/^https?:\/\//, '')}
                  </button>
                ) : (
                  (g.remoteUrl ?? 'None')
                )}
              </dd>
            </dl>
          )}
          {project.isGitRepo && g && (
            <div className="panel-actions">
              {g.remoteUrl ? (
                <button className="button small full" onClick={onSync}>
                  {g.changes ? `Commit & push ${g.changes} change${g.changes === 1 ? '' : 's'}` : g.ahead ? `Push ${g.ahead} commit(s)` : 'Sync…'}
                </button>
              ) : (
                <button className="button primary small full" onClick={onPublish}>
                  Publish to GitHub
                </button>
              )}
            </div>
          )}
        </section>

        <section className="panel">
          <h3>Folder layout</h3>
          <p className="muted small">
            Check this project against the standard layout (firmware / pcb / mechanical / docs / releases) and move things into place.
          </p>
          <div className="panel-actions">
            <button className="button small full" onClick={onStructure}>
              Make consistent…
            </button>
          </div>
          {project.group ? (
            <p className="muted small group-note">
              Part of the <strong>{project.group}</strong> group.{' '}
              <button
                className="link-button"
                onClick={() =>
                  void api()
                    .setGroup(dirname(project.path), false)
                    .catch((err) => onError(String(err)))
                }
              >
                Show {project.group} as one project
              </button>
            </p>
          ) : (
            <p className="muted small group-note">
              Does this folder hold several separate projects?{' '}
              <button
                className="link-button"
                onClick={() =>
                  void api()
                    .setGroup(project.path, true)
                    .catch((err) => onError(String(err)))
                }
              >
                Make it a group
              </button>
            </p>
          )}
        </section>

        <section className="panel">
          <h3>Contents</h3>
          <ul className="content-list">
            {counts.map(([cat, n]) => (
              <li key={cat}>
                <FileIcon category={cat} size={15} />
                <span>{CATEGORY_LABEL[cat]}</span>
                <span className="muted">{n}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">
            {project.fileCount} files{project.partial ? ' (large project — partly scanned)' : ''} · modified {formatRelative(project.modified)}
          </p>
        </section>

        {(project.meta.links?.length ?? 0) > 0 && (
          <section className="panel">
            <h3>Quick links</h3>
            <div className="quick-links">
              {project.meta.links!.map((l, i) => (
                <button key={i} className="chip" onClick={() => void api().openExternal(l.url)} title={l.url}>
                  <LinkIcon size={12} /> {linkName(l.label)}
                </button>
              ))}
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}
