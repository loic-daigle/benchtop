import { useEffect, useState } from 'react';
import type { GitHubStatus } from '../../shared/types';
import { api } from '../lib/format';
import { Dialog, errMsg } from './Dialog';

const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=Benchtop';

interface Props {
  onClose: () => void;
  onChange?: (status: GitHubStatus) => void;
}

export function useGitHubStatus(): [GitHubStatus | null, (s: GitHubStatus) => void] {
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  useEffect(() => {
    api()
      .githubStatus()
      .then(setStatus)
      .catch(() => setStatus({ account: null, ghCliAvailable: false, gitAvailable: false, lfsAvailable: false }));
  }, []);
  return [status, setStatus];
}

export function GitHubAccountPanel({ status, onChange }: { status: GitHubStatus; onChange: (s: GitHubStatus) => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<GitHubStatus>) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await fn());
      setToken('');
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  if (status.account) {
    const a = status.account;
    return (
      <div className="account">
        <img className="avatar" src={a.avatarUrl} alt="" />
        <div className="account-text">
          <strong>{a.name ?? a.login}</strong>
          <span className="muted small">
            @{a.login} · {a.source === 'gh-cli' ? 'via GitHub CLI' : 'personal access token'}
          </span>
        </div>
        <div className="spacer" />
        <button className="button ghost" disabled={busy} onClick={() => void act(() => api().githubSignOut())}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="form">
      {!status.gitAvailable && (
        <div className="notice error">
          Git isn’t installed. Install{' '}
          <button className="link-button" onClick={() => void api().openExternal('https://git-scm.com/download/win')}>
            Git for Windows
          </button>{' '}
          and restart Benchtop.
        </div>
      )}
      {status.ghCliAvailable && (
        <>
          <button className="button primary small" disabled={busy} onClick={() => void act(() => api().githubUseCli())}>
            Use my GitHub CLI login
          </button>
          <div className="or">or</div>
        </>
      )}
      <ol className="steps small">
        <li>
          <button className="link-button" onClick={() => void api().openExternal(TOKEN_URL)}>
            Create a token on GitHub
          </button>{' '}
          (scope <code>repo</code> is pre-selected; pick an expiration).
        </li>
        <li>Copy it and paste it here:</li>
      </ol>
      <div className="field-row">
        <input
          className="input"
          type="password"
          placeholder="ghp_…"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && token && void act(() => api().githubSetToken(token))}
        />
        <button className="button" disabled={!token.trim() || busy} onClick={() => void act(() => api().githubSetToken(token))}>
          {busy ? 'Checking…' : 'Connect'}
        </button>
      </div>
      <p className="muted small">The token is stored encrypted on this computer (Windows credential protection) and only sent to GitHub.</p>
      {error && <div className="notice error">{error}</div>}
    </div>
  );
}

export function GitHubDialog({ onClose, onChange }: Props) {
  const [status, setStatus] = useGitHubStatus();
  return (
    <Dialog title="GitHub account" onClose={onClose}>
      {!status ? (
        <div className="preview-note">Checking…</div>
      ) : (
        <GitHubAccountPanel
          status={status}
          onChange={(s) => {
            setStatus(s);
            onChange?.(s);
          }}
        />
      )}
    </Dialog>
  );
}
