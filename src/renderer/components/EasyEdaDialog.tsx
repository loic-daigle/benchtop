import { useEffect, useMemo, useRef, useState } from 'react';
import type { BridgeInfo, EasyEdaStatus, ProjectSummary } from '../../shared/types';
import { api, formatDate, formatRelative } from '../lib/format';
import { Dialog, errMsg } from './Dialog';

interface Props {
  projects: ProjectSummary[];
  onClose: () => void;
  onDone: (message: string) => void;
}

/** Status of the EasyEDA extension connection, with the setup steps and the pairing code. */
export function ExtensionPanel() {
  const [info, setInfo] = useState<BridgeInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api().easyedaBridgeInfo().then(setInfo).catch((err) => setError(errMsg(err)));
    return api().onEasyEdaBridge(setInfo);
  }, []);

  const copy = async () => {
    if (!info) return;
    await api().copyText(info.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const act = (fn: () => Promise<BridgeInfo>) => () =>
    fn()
      .then((i) => {
        setInfo(i);
        setError(null);
      })
      .catch((err) => setError(errMsg(err)));

  if (!info) return error ? <div className="notice error">{error}</div> : null;

  const state = !info.listening ? 'error' : info.clients > 0 ? 'on' : 'idle';
  const label = !info.listening
    ? `Not listening: ${info.error ?? 'unknown error'}`
    : info.clients > 0
      ? `EasyEDA is connected${info.extensionVersion ? ` (extension v${info.extensionVersion})` : ''}`
      : 'Waiting for EasyEDA';

  return (
    <section className="ext-panel">
      <div className="ext-head">
        <strong>EasyEDA extension</strong>
        <span className={`ext-state ${state}`}>
          <span className="ext-dot" />
          {label}
        </span>
        <div className="spacer" />
        {!info.listening && (
          <button className="button ghost small" onClick={act(() => api().easyedaRestartBridge())}>
            Retry
          </button>
        )}
      </div>
      <p className="muted small">
        Adds a <b>Benchtop</b> menu to EasyEDA Pro to export Gerber, BOM, pick &amp; place, schematic PDF, STEP and the project file straight
        into a project here, and to jump back to it.
      </p>
      <ol className="ext-steps small">
        <li>
          In EasyEDA: <b>Settings → Extensions → Extension Manager → Import</b>, and pick{' '}
          {info.extensionFile ? (
            <button className="linklike" onClick={() => void api().easyedaShowExtension()}>
              benchtop-easyeda.eext
            </button>
          ) : (
            <code>benchtop-easyeda.eext</code>
          )}
          .
        </li>
        <li>
          Click <b>Benchtop</b> in the list, open its <b>Config</b> tab and tick <b>Allow external interaction</b> (it lets the extension talk
          to this app; only on this computer).
        </li>
        <li>
          In the new <b>Benchtop</b> menu, choose <b>Connect to Benchtop…</b> and paste this code:
          <div className="ext-code">
            <code>{info.code}</code>
            <button className="button ghost small" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              className="button ghost small"
              title="Make a new code. EasyEDA will need the new one."
              onClick={act(() => api().easyedaNewPairingCode())}
            >
              New code
            </button>
          </div>
        </li>
      </ol>
      {error && <div className="notice error">{error}</div>}
    </section>
  );
}

/** One screen to link every EasyEDA project to a Benchtop project. */
export function EasyEdaDialog({ projects, onClose, onDone }: Props) {
  const [status, setStatus] = useState<EasyEdaStatus | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [initial, setInitial] = useState<Record<string, string>>({});
  const [suggested, setSuggested] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load once when the window opens. The project list refreshes in the background
  // (file watcher), and re-running this would wipe the choices being edited.
  const projectsAtOpen = useRef(projects);
  useEffect(() => {
    Promise.all([api().easyedaStatus(true), api().easyedaSuggest()])
      .then(([s, sug]) => {
        setStatus(s);
        const linked: Record<string, string> = {};
        for (const p of projectsAtOpen.current) for (const n of p.meta.easyeda ?? []) linked[n] = p.path;
        const start: Record<string, string> = {};
        const sugg = new Set<string>();
        for (const e of s.projects) {
          if (linked[e.name]) start[e.name] = linked[e.name];
          else if (sug[e.name]) {
            start[e.name] = sug[e.name]!;
            sugg.add(e.name);
          } else start[e.name] = '';
        }
        setChoice(start);
        setInitial(linked);
        setSuggested(sugg);
      })
      .catch((err) => setError(errMsg(err)));
  }, []);

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '') || a.name.localeCompare(b.name)),
    [projects],
  );

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      // Rebuild the list of EasyEDA names for every project that changed.
      const touched = new Set<string>([...Object.values(initial), ...Object.values(choice)].filter(Boolean));
      const links: Record<string, string[]> = {};
      for (const p of touched) {
        const keepOthers = (projects.find((x) => x.path === p)?.meta.easyeda ?? []).filter((n) => !(n in choice));
        links[p] = [...keepOthers, ...Object.entries(choice).filter(([, path]) => path === p).map(([n]) => n)];
      }
      await api().easyedaLink(links);
      const count = Object.values(choice).filter(Boolean).length;
      onDone(`Linked ${count} EasyEDA project${count === 1 ? '' : 's'}. Saved in each project.yaml.`);
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="EasyEDA"
      wide
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <span className="muted small">Saved as an “easyeda:” list in each project.yaml</span>
          <div className="spacer" />
          <button className="button ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="button primary small" disabled={!status?.found || busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save links'}
          </button>
        </>
      }
    >
      <ExtensionPanel />
      {error && <div className="notice error">{error}</div>}
      {!status && !error && <div className="preview-note">Reading EasyEDA’s folder…</div>}
      {status && !status.found && (
        <div className="notice">
          EasyEDA Pro’s data folder wasn’t found in Documents (EasyEDA-Pro). Install the desktop client, or open it once so it creates its
          folder.
        </div>
      )}
      {status?.found && (
        <div className="form">
          <h3 className="ext-subtitle">Linked projects</h3>
          <p className="muted small">
            EasyEDA Pro ({status.mode?.toLowerCase().replace('_', ' ') ?? 'unknown'} mode) keeps automatic backups of your cloud projects on
            this PC. Pick which Benchtop project each one belongs to. <span className="suggested-dot" /> = suggested from the name, check it.
          </p>
          {status.projects.length === 0 ? (
            <div className="preview-note">No EasyEDA backups found yet.</div>
          ) : (
            <table className="link-table">
              <thead>
                <tr>
                  <th>EasyEDA project</th>
                  <th>Last backup</th>
                  <th>Benchtop project</th>
                </tr>
              </thead>
              <tbody>
                {status.projects.map((e) => (
                  <tr key={e.name}>
                    <td>
                      <strong>{e.name}</strong>
                      {e.eprj && <span className="muted small"> · local file</span>}
                    </td>
                    <td className="muted small" title={e.latest ? formatDate(e.latest.date) : ''}>
                      {e.latest ? formatRelative(e.latest.date) : '—'}
                      {e.latest?.version ? ` · v${e.latest.version}` : ''}
                    </td>
                    <td>
                      <div className="link-select">
                        {suggested.has(e.name) && choice[e.name] && <span className="suggested-dot" title="Suggested from the name" />}
                        <select
                          className="select full"
                          value={choice[e.name] ?? ''}
                          onChange={(ev) => {
                            setChoice({ ...choice, [e.name]: ev.target.value });
                            setSuggested((s) => {
                              const n = new Set(s);
                              n.delete(e.name);
                              return n;
                            });
                          }}
                        >
                          <option value="">— Not linked —</option>
                          {sortedProjects.map((p) => (
                            <option key={p.path} value={p.path}>
                              {p.group ? `${p.group} / ` : ''}
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Dialog>
  );
}
