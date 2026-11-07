import { useCallback, useEffect, useState } from 'react';
import {
  RELEASE_STATUSES,
  type FabKind,
  type FirmwareState,
  type ProjectSummary,
  type Release,
  type ReleaseInfo,
  type ReleaseStatus,
  type ReleasesResult,
} from '../../shared/types';
import { api, formatBytes, formatRelative } from '../lib/format';
import { Dialog, errMsg } from './Dialog';

const STATUS_LABEL: Record<ReleaseStatus, string> = {
  planned: 'Planned',
  ordered: 'Ordered',
  received: 'Received',
  assembled: 'Assembled',
  retired: 'Retired',
};

const KIND_LABEL: Record<FabKind, string> = {
  gerber: 'Gerber',
  bom: 'BOM',
  pnp: 'Pick & place',
  schematic: 'Schematic',
  step: '3D',
  source: 'EasyEDA file',
};
const COPY_ORDER: FabKind[] = ['gerber', 'bom', 'pnp', 'schematic', 'step', 'source'];

interface Props {
  project: ProjectSummary;
  /** Bumped when files in the project change on disk. */
  changeKey: number;
  onOpenFile: (path: string) => void;
  onError: (message: string) => void;
}

/** One card per board order (releases/<name>/), newest first, with the firmware that goes with it. */
export function ReleasesPanel({ project, changeKey, onOpenFile, onError }: Props) {
  const [data, setData] = useState<ReleasesResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(() => {
    api()
      .releases(project.path)
      .then(setData)
      .catch((err) => onError(errMsg(err)));
  }, [project.path, onError]);

  useEffect(() => {
    // Don't reload under an open editor: it would throw away what's being typed.
    if (!editing) load();
  }, [load, changeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <div className="preview-note">Loading releases…</div>;
  const { releases, firmware } = data;

  return (
    <div className="releases">
      <div className="releases-head">
        <div>
          <h2>Releases</h2>
          <p className="muted small">
            One folder per board order in <code>releases/</code>, with the files that were sent and the firmware that goes with them.
          </p>
        </div>
        <div className="spacer" />
        <button className="button primary small" onClick={() => setCreating(true)}>
          New release
        </button>
      </div>

      <FirmwareBanner firmware={firmware} releases={releases} />

      {releases.length === 0 ? (
        <div className="releases-empty">
          <p>No releases yet.</p>
          <p className="muted small">
            Click <b>New release</b> when you order boards: it copies the current Gerber, BOM and pick &amp; place into{' '}
            <code>releases/&lt;date&gt;/</code> and records the firmware commit. Exporting from EasyEDA into a release does the same.
          </p>
        </div>
      ) : (
        <ol className="timeline">
          {releases.map((r) => (
            <li key={r.path} className="timeline-item">
              <span className={`timeline-dot status-${r.info.status || 'none'}`} />
              <ReleaseCard
                projectPath={project.path}
                release={r}
                firmware={firmware}
                editing={editing === r.path}
                onEdit={(on) => setEditing(on ? r.path : null)}
                onChanged={load}
                onOpenFile={onOpenFile}
                onError={onError}
              />
            </li>
          ))}
        </ol>
      )}

      {creating && (
        <NewReleaseDialog
          projectPath={project.path}
          data={data}
          onClose={() => setCreating(false)}
          onCreated={(r) => {
            setCreating(false);
            load();
            onError(`Release ${r.name} created.`);
          }}
        />
      )}
    </div>
  );
}

function FirmwareBanner({ firmware, releases }: { firmware: FirmwareState; releases: Release[] }) {
  if (firmware.repo === null) {
    return (
      <div className="fw-banner muted small">
        No git repository in this project, so firmware versions can’t be tracked. Start one (Overview → Publish to GitHub) to see which
        release your firmware matches.
      </div>
    );
  }
  if (!firmware.head) return <div className="fw-banner muted small">The firmware repository has no commits yet.</div>;
  const recorded = releases.some((r) => r.info.firmware);
  const m = firmware.match;
  let verdict: React.ReactNode;
  let tone = 'neutral';
  if (m && m.commitsSince === 0) {
    verdict = (
      <>
        Same firmware as release <b>{m.release}</b>
      </>
    );
    tone = 'ok';
  } else if (m) {
    verdict = (
      <>
        {m.commitsSince} commit{m.commitsSince > 1 ? 's' : ''} after release <b>{m.release}</b>
      </>
    );
    tone = 'warn';
  } else {
    verdict = recorded ? 'Not based on any release’s firmware (another branch?)' : 'No release has a firmware version recorded yet';
  }
  return (
    <div className={`fw-banner ${tone}`}>
      <div>
        <div className="fw-title">
          Current firmware: {verdict}
          {firmware.dirty && <span className="muted"> · plus uncommitted changes</span>}
        </div>
        <div className="muted small">
          {firmware.repo ? <code>{firmware.repo}/</code> : 'This project'} · {firmware.branch ?? 'detached'} @ <code>{firmware.head}</code>
          {firmware.subject && <> · “{firmware.subject}”</>}
        </div>
      </div>
    </div>
  );
}

function ReleaseCard({
  projectPath,
  release,
  firmware,
  editing,
  onEdit,
  onChanged,
  onOpenFile,
  onError,
}: {
  projectPath: string;
  release: Release;
  firmware: FirmwareState;
  editing: boolean;
  onEdit: (on: boolean) => void;
  onChanged: () => void;
  onOpenFile: (path: string) => void;
  onError: (m: string) => void;
}) {
  const { info } = release;
  const fw = info.firmware;
  const since = firmware.since[release.name];
  const dateTitle = new Date(`${info.date}T12:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  const snapshot = () =>
    api()
      .snapshotFirmware(projectPath, release.relDir)
      .then(onChanged)
      .catch((err) => onError(errMsg(err)));

  if (editing) {
    return (
      <ReleaseEditor
        release={release}
        onCancel={() => onEdit(false)}
        onSave={async (next) => {
          await api().saveRelease(projectPath, release.relDir, next);
          onEdit(false);
          onChanged();
        }}
      />
    );
  }

  return (
    <article className="release-card">
      <header className="release-top">
        <div>
          <div className="release-title">
            {dateTitle}
            {info.board && <span className="release-board">{info.board}</span>}
            {info.status && <span className={`status rstatus-${info.status}`}>{STATUS_LABEL[info.status]}</span>}
          </div>
          <div className="muted small">
            <code>{release.relDir}/</code>
            {info.order && <> · Order {info.order}</>}
            {info.link && (
              <>
                {' · '}
                <button className="linklike" onClick={() => void api().openExternal(info.link)} title={info.link}>
                  {linkLabel(info.link)}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="spacer" />
        <button className="button ghost small" onClick={() => onEdit(true)}>
          Edit
        </button>
        <button className="button ghost small" onClick={() => void api().openPath(release.path)}>
          Open folder
        </button>
      </header>

      {release.infoError && <div className="notice error small">release.yaml has an error: {release.infoError}</div>}
      {!release.hasInfo && <p className="muted small">No release.yaml yet. Click Edit to add the board revision, order number and notes.</p>}
      {info.note && <p className="release-note">{info.note}</p>}

      {release.files.length > 0 && (
        <div className="release-files">
          {release.files.map((f) => (
            <button key={f.path} className="file-chip" onClick={() => onOpenFile(f.path)} title={`${f.relPath} · ${formatBytes(f.size)}`}>
              {f.kind && <b>{KIND_LABEL[f.kind]}</b>}
              <span>{f.name}</span>
            </button>
          ))}
        </div>
      )}

      <div className="release-fw small">
        {fw ? (
          <>
            <span className="muted">Firmware</span> <code>{fw.commit.slice(0, 8)}</code>
            {fw.branch && <span className="muted"> on {fw.branch}</span>}
            {fw.subject && <span className="muted"> · “{fw.subject}”</span>}
            {fw.dirty && <span className="warn-text"> · had uncommitted changes</span>}
            {since === 0 && <span className="ok-text"> · same as now</span>}
            {since !== undefined && since !== null && since > 0 && (
              <span className="muted">
                {' '}
                · {since} commit{since > 1 ? 's' : ''} ago
              </span>
            )}
          </>
        ) : (
          <>
            <span className="muted">No firmware version recorded.</span>{' '}
            {firmware.head && (
              <button className="linklike" onClick={() => void snapshot()}>
                Record current ({firmware.head.slice(0, 8)})
              </button>
            )}
          </>
        )}
      </div>
    </article>
  );
}

function linkLabel(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return 'Link';
  }
}

function ReleaseEditor({ release, onCancel, onSave }: { release: Release; onCancel: () => void; onSave: (i: ReleaseInfo) => Promise<void> }) {
  const [info, setInfo] = useState<ReleaseInfo>(release.info);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ReleaseInfo>(k: K, v: ReleaseInfo[K]) => setInfo((i) => ({ ...i, [k]: v }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(info);
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };

  return (
    <article className="release-card editing">
      <ReleaseFields info={info} set={set} />
      {info.firmware && (
        <label className="checkbox small">
          <input type="checkbox" checked onChange={() => set('firmware', null)} />
          Keep the recorded firmware version (<code>{info.firmware.commit.slice(0, 8)}</code>)
        </label>
      )}
      {error && <div className="notice error">{error}</div>}
      <div className="release-actions">
        <span className="muted small">
          Saved in <code>{release.relDir}/release.yaml</code>, which stays on this computer (never pushed to GitHub)
        </span>
        <div className="spacer" />
        <button className="button ghost small" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="button primary small" onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </article>
  );
}

function ReleaseFields({
  info,
  set,
  autoFocus,
}: {
  info: Omit<ReleaseInfo, 'firmware'>;
  set: <K extends keyof ReleaseInfo>(k: K, v: ReleaseInfo[K]) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="form">
      <div className="field-row three">
        <label className="field">
          <span>Date</span>
          <input className="input" type="date" value={info.date} onChange={(e) => set('date', e.target.value)} />
        </label>
        <label className="field">
          <span>Board revision</span>
          <input className="input" autoFocus={autoFocus} value={info.board} placeholder="rev B" onChange={(e) => set('board', e.target.value)} />
        </label>
        <label className="field">
          <span>Status</span>
          <select className="select full" value={info.status} onChange={(e) => set('status', e.target.value as ReleaseInfo['status'])}>
            <option value="">—</option>
            {RELEASE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span>Order number</span>
          <input className="input" value={info.order} placeholder="Y12-1234567A" onChange={(e) => set('order', e.target.value)} />
        </label>
        <label className="field">
          <span>Link</span>
          <input className="input" value={info.link} placeholder="https://cart.jlcpcb.com/order-detail?…" onChange={(e) => set('link', e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>Notes</span>
        <textarea
          className="input textarea"
          rows={3}
          value={info.note}
          placeholder="What changed in this revision, what to fix next time…"
          onChange={(e) => set('note', e.target.value)}
        />
      </label>
    </div>
  );
}

function todayStr() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function NewReleaseDialog({
  projectPath,
  data,
  onClose,
  onCreated,
}: {
  projectPath: string;
  data: ReleasesResult;
  onClose: () => void;
  onCreated: (r: Release) => void;
}) {
  const available = COPY_ORDER.filter((k) => data.latestFab[k]);
  const lastBoard = data.releases.find((r) => r.info.board)?.info.board ?? '';
  const [info, setInfo] = useState<Omit<ReleaseInfo, 'firmware'>>({
    date: todayStr(),
    board: nextRevision(lastBoard),
    status: 'ordered',
    order: '',
    link: '',
    note: '',
  });
  const [copy, setCopy] = useState<Set<FabKind>>(new Set(available.filter((k) => k !== 'step' && k !== 'source')));
  const [recordFw, setRecordFw] = useState(!!data.firmware.head);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ReleaseInfo>(k: K, v: ReleaseInfo[K]) => setInfo((i) => ({ ...i, [k]: v }));

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api().createRelease(projectPath, { name: info.date, info, copyKinds: [...copy], recordFirmware: recordFw });
      onCreated(r);
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="New release"
      wide
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <span className="muted small">
            Creates <code>releases/{info.date}/</code> (or <code>-2</code> if it exists). Nothing is moved or overwritten. The release info stays on this computer.
          </span>
          <div className="spacer" />
          <button className="button ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="button primary small" onClick={() => void create()} disabled={busy || !info.date}>
            {busy ? 'Creating…' : 'Create release'}
          </button>
        </>
      }
    >
      <ReleaseFields info={info} set={set} autoFocus />
      <div className="field spaced">
        <span className="field-label">Copy into the release</span>
        {available.length === 0 ? (
          <p className="muted small">No Gerber, BOM or pick &amp; place files found in the project. You can add files to the folder afterwards.</p>
        ) : (
          <div className="copy-list">
            {available.map((k) => {
              const f = data.latestFab[k]!;
              return (
                <label key={k} className="checkbox">
                  <input
                    type="checkbox"
                    checked={copy.has(k)}
                    onChange={(e) => {
                      const n = new Set(copy);
                      if (e.target.checked) n.add(k);
                      else n.delete(k);
                      setCopy(n);
                    }}
                  />
                  <b>{KIND_LABEL[k]}</b>
                  <span className="muted small">
                    {f.relPath.replace(/\\/g, '/')} · {formatRelative(f.date)}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
      <label className="checkbox spaced">
        <input type="checkbox" checked={recordFw} disabled={!data.firmware.head} onChange={(e) => setRecordFw(e.target.checked)} />
        {data.firmware.head ? (
          <>
            Record the firmware version: <code>{data.firmware.head.slice(0, 8)}</code>
            {data.firmware.branch && <span className="muted"> on {data.firmware.branch}</span>}
            {data.firmware.dirty && <span className="warn-text"> (has uncommitted changes: commit first to be exact)</span>}
          </>
        ) : (
          <span className="muted">No firmware git repository to record</span>
        )}
      </label>
      {error && <div className="notice error">{error}</div>}
    </Dialog>
  );
}

/** "rev A" -> "rev B", "v1.2" -> "v1.3", "V1" -> "V2". */
export function nextRevision(prev: string): string {
  if (!prev) return '';
  const letter = /^(.*?)([A-Y])$/.exec(prev);
  if (letter) return letter[1] + String.fromCharCode(letter[2].charCodeAt(0) + 1);
  const num = /^(.*?)(\d+)$/.exec(prev);
  if (num) return num[1] + String(Number(num[2]) + 1);
  return prev;
}
