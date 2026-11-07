import { useEffect, useMemo, useState } from 'react';
import type { GitChange, ProjectSummary, PublishPrecheck } from '../../shared/types';
import { api, formatBytes } from '../lib/format';
import { Dialog, errMsg } from './Dialog';
import { GitHubAccountPanel, useGitHubStatus } from './GitHubDialog';

interface PublishProps {
  project: ProjectSummary;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function PublishDialog({ project, onClose, onDone }: PublishProps) {
  const [status, setStatus] = useGitHubStatus();
  const [check, setCheck] = useState<PublishPrecheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repoName, setRepoName] = useState('');
  const [description, setDescription] = useState(project.meta.description ?? project.description ?? '');
  const [isPrivate, setIsPrivate] = useState(true);
  const [useLfs, setUseLfs] = useState(true);
  const [exclude, setExclude] = useState<Set<string>>(new Set());
  const [secretsOk, setSecretsOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    api()
      .publishPrecheck(project.path)
      .then((c) => {
        setCheck(c);
        setRepoName(c.suggestedName);
        setExclude(new Set(c.nestedRepos)); // other repos inside are excluded by default
      })
      .catch((err) => setError(errMsg(err)));
  }, [project.path]);

  useEffect(() => api().onPublishProgress((msg) => setLog((l) => [...l, msg])), []);

  const secretFiles = useMemo(() => [...new Set(check?.secrets.map((s) => s.relPath) ?? [])], [check]);
  const unhandledSecrets = secretFiles.filter((f) => !exclude.has(f));
  const lfsPossible = !!status?.lfsAvailable && (check?.cadFileCount ?? 0) > 0;
  const blocked = check?.blockedFiles.filter((f) => !exclude.has(f.relPath)) ?? [];
  const canPublish =
    !!status?.account && !!check && !!repoName.trim() && !busy && !url && blocked.length === 0 && (unhandledSecrets.length === 0 || secretsOk);

  const toggleExclude = (rel: string) => {
    const next = new Set(exclude);
    if (next.has(rel)) next.delete(rel);
    else next.add(rel);
    setExclude(next);
  };

  const go = async () => {
    if (!check) return;
    setBusy(true);
    setError(null);
    setLog([]);
    try {
      const r = await api().publish(project.path, {
        repoName,
        description,
        isPrivate,
        useLfs: lfsPossible && useLfs,
        exclude: [...exclude],
        commitMessage: check.isRepo ? 'Update' : 'Initial commit',
      });
      setUrl(r.url);
      onDone(`Published to ${r.url.replace(/^https:\/\//, '')}`);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={check?.hasRemote ? `Push “${project.name}”` : `Publish “${project.name}” to GitHub`}
      wide
      onClose={onClose}
      busy={busy}
      footer={
        url ? (
          <>
            <div className="spacer" />
            <button className="button ghost" onClick={onClose}>
              Close
            </button>
            <button className="button primary small" onClick={() => void api().openExternal(url)}>
              Open on GitHub
            </button>
          </>
        ) : (
          <>
            <div className="spacer" />
            <button className="button ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="button primary small" disabled={!canPublish} onClick={() => void go()}>
              {busy ? 'Publishing…' : check?.hasRemote ? 'Commit & push' : `Publish ${isPrivate ? 'private' : 'public'} repo`}
            </button>
          </>
        )
      }
    >
      {!status || (!check && !error) ? (
        <div className="preview-note">Checking the project…</div>
      ) : !status.account ? (
        <>
          <p>Connect your GitHub account first.</p>
          <GitHubAccountPanel status={status} onChange={setStatus} />
        </>
      ) : url ? (
        <div className="publish-done">
          <div className="big-check">✓</div>
          <p>
            <strong>{project.name}</strong> is on GitHub.
          </p>
          <button className="link-button" onClick={() => void api().openExternal(url)}>
            {url.replace(/^https:\/\//, '')}
          </button>
          <p className="muted small">The link was also saved in project.yaml.</p>
        </div>
      ) : (
        check && (
          <div className="form">
            {!check.hasRemote && (
              <>
                <div className="field-row">
                  <label className="field">
                    <span>Repository</span>
                    <div className="repo-name">
                      <span className="muted">{status.account.login} /</span>
                      <input className="input" value={repoName} onChange={(e) => setRepoName(e.target.value)} />
                    </div>
                  </label>
                  <div className="field">
                    <span>Visibility</span>
                    <div className="segmented">
                      <button className={isPrivate ? 'active' : ''} onClick={() => setIsPrivate(true)}>
                        Private
                      </button>
                      <button className={!isPrivate ? 'active' : ''} onClick={() => setIsPrivate(false)}>
                        Public
                      </button>
                    </div>
                  </div>
                </div>
                <label className="field">
                  <span>Description</span>
                  <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
                </label>
              </>
            )}
            {check.hasRemote && <p className="muted small">Remote: {check.remoteUrl}</p>}

            <div className="checks">
              <div className="check ok">
                {check.fileCount} files · {formatBytes(check.totalBytes)}
                {!check.hasGitignore && ' · a .gitignore will be added (build folders, secrets.h, backups)'}
              </div>

              {check.secrets.length > 0 ? (
                <div className="check warn">
                  <strong>Possible passwords or keys found</strong>
                  <p className="small">
                    Anyone who can see the repo could read these. Exclude the file, or move the values into a <code>secrets.h</code> (already
                    ignored) and publish again.
                  </p>
                  <ul className="hits">
                    {check.secrets.map((s, i) => (
                      <li key={i}>
                        <code className="hit-file">
                          {s.relPath}:{s.line}
                        </code>
                        <code className="hit-text">{s.text}</code>
                      </li>
                    ))}
                  </ul>
                  <div className="exclusions">
                    {secretFiles.map((f) => (
                      <label key={f} className="checkbox">
                        <input type="checkbox" checked={exclude.has(f)} onChange={() => toggleExclude(f)} />
                        Don’t publish {f}
                      </label>
                    ))}
                  </div>
                  {unhandledSecrets.length > 0 && (
                    <label className="checkbox">
                      <input type="checkbox" checked={secretsOk} onChange={(e) => setSecretsOk(e.target.checked)} />
                      I checked: these are safe to publish
                    </label>
                  )}
                </div>
              ) : (
                <div className="check ok">No passwords or API keys found in the code.</div>
              )}

              {check.nestedRepos.length > 0 && (
                <div className="check warn">
                  <strong>Folders that are their own git repository</strong>
                  <p className="small">Usually someone else’s code. They are left out by default.</p>
                  {check.nestedRepos.map((r) => (
                    <label key={r} className="checkbox">
                      <input type="checkbox" checked={exclude.has(r)} onChange={() => toggleExclude(r)} />
                      Leave out {r}
                    </label>
                  ))}
                </div>
              )}

              {(check.largeFiles.length > 0 || check.blockedFiles.length > 0) && (
                <div className={`check ${blocked.length ? 'bad' : 'warn'}`}>
                  <strong>Large files</strong>
                  <p className="small">GitHub refuses files over 100 MB (CAD files are fine with Git LFS).</p>
                  {[...new Map([...check.largeFiles, ...check.blockedFiles].map((f) => [f.relPath, f])).values()].map((f) => (
                    <label key={f.relPath} className="checkbox">
                      <input type="checkbox" checked={exclude.has(f.relPath)} onChange={() => toggleExclude(f.relPath)} />
                      Leave out {f.relPath} ({formatBytes(f.size)})
                    </label>
                  ))}
                </div>
              )}

              {check.cadFileCount > 0 && !check.hasRemote && (
                <div className="check ok">
                  {lfsPossible ? (
                    <label className="checkbox">
                      <input type="checkbox" checked={useLfs} onChange={(e) => setUseLfs(e.target.checked)} />
                      Store the {check.cadFileCount} CAD files (STEP, STL, 3MF, F3D) with Git LFS — keeps the repo small
                    </label>
                  ) : (
                    <span className="small">
                      {check.cadFileCount} CAD files will be stored normally (Git LFS isn’t installed — fine for small files).
                    </span>
                  )}
                </div>
              )}
            </div>

            {log.length > 0 && (
              <ul className="progress-log">
                {log.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            )}
            {error && <div className="notice error">{error}</div>}
          </div>
        )
      )}
    </Dialog>
  );
}

interface SyncProps {
  project: ProjectSummary;
  onClose: () => void;
  onDone: (message: string) => void;
}

/** Commit & push / pull for a project that already has a remote. */
export function SyncDialog({ project, onClose, onDone }: SyncProps) {
  const [list, setList] = useState<GitChange[] | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api()
      .gitChanges(project.path)
      .then(setList)
      .catch((err) => setError(errMsg(err)));
  }, [project.path]);

  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      onDone(await fn());
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };

  const changes = list?.length ?? 0;
  const ahead = project.git?.ahead ?? 0;

  return (
    <Dialog
      title={`Sync “${project.name}”`}
      wide
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button className="button ghost" disabled={busy} onClick={() => void act(() => api().pull(project.path))}>
            Pull{project.git?.behind ? ` (${project.git.behind})` : ''}
          </button>
          <div className="spacer" />
          <button className="button ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="button primary small"
            disabled={busy || (!changes && !ahead) || (changes > 0 && !message.trim())}
            onClick={() => void act(() => api().commitAndPush(project.path, message))}
          >
            {busy ? 'Working…' : changes ? 'Commit & push' : `Push ${ahead} commit${ahead === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      <div className="form">
        <p className="muted small">
          Branch <strong>{project.git?.branch ?? '—'}</strong>
          {project.git?.webUrl && (
            <>
              {' · '}
              <button className="link-button" onClick={() => void api().openExternal(project.git!.webUrl!)}>
                {project.git.webUrl.replace(/^https:\/\//, '')}
              </button>
            </>
          )}
        </p>
        {list === null && !error ? (
          <div className="preview-note">Reading changes…</div>
        ) : changes ? (
          <>
            <span className="section-label">
              {changes} changed file{changes === 1 ? '' : 's'}
            </span>
            <ul className="change-list">
              {list!.slice(0, 200).map((c) => (
                <li key={c.path}>
                  <span className={`change-status s-${c.status.replace('?', 'u')}`}>{c.status === '??' || c.status === '?' ? 'new' : c.status}</span>
                  <span>{c.path}</span>
                </li>
              ))}
            </ul>
            <label className="field">
              <span>What changed?</span>
              <input
                className="input"
                autoFocus
                placeholder="e.g. Fix WiFi reconnect, add case v3"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && message.trim() && void act(() => api().commitAndPush(project.path, message))}
              />
            </label>
          </>
        ) : (
          <div className="preview-note">{ahead ? `No uncommitted changes. ${ahead} commit(s) waiting to be pushed.` : 'Everything is committed and pushed.'}</div>
        )}
        {error && <div className="notice error">{error}</div>}
      </div>
    </Dialog>
  );
}
