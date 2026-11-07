import { useEffect, useMemo, useState } from 'react';
import type { EasyEdaProject, FabFile, FabKind, ProjectSummary } from '../../shared/types';
import { api, formatDate, formatRelative } from '../lib/format';
import { errMsg } from './Dialog';
import { FileIcon } from './Icons';

const KIND_LABEL: Record<FabKind, string> = {
  gerber: 'Gerbers',
  bom: 'BOM',
  pnp: 'Pick & place',
  schematic: 'Schematic PDF',
  source: 'EasyEDA sources',
  step: '3D (STEP)',
};
const ORDER: FabKind[] = ['gerber', 'bom', 'pnp', 'schematic', 'step', 'source'];
const HOUR = 3600 * 1000;

interface Props {
  project: ProjectSummary;
  onOpenFile: (path: string) => void;
  onLinkAll: () => void;
  onMessage: (message: string) => void;
}

/** "PCB" section of the Overview: EasyEDA link + backups + fabrication files. */
export function PcbPanel({ project, onOpenFile, onLinkAll, onMessage }: Props) {
  const [fab, setFab] = useState<FabFile[] | null>(null);
  const [ee, setEe] = useState<EasyEdaProject[] | null>(null);
  const [found, setFound] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api()
      .fabFiles(project.path)
      .then((f) => !cancelled && setFab(f))
      .catch(() => !cancelled && setFab([]));
    api()
      .easyedaStatus()
      .then((s) => {
        if (cancelled) return;
        setFound(s.found);
        setEe(s.projects);
      })
      .catch(() => !cancelled && setEe([]));
    return () => {
      cancelled = true;
    };
  }, [project.path, project.modified, project.meta.easyeda?.join('|')]);

  const linked = useMemo(
    () => (ee ?? []).filter((e) => project.meta.easyeda?.some((n) => n.toLowerCase() === e.name.toLowerCase())),
    [ee, project.meta.easyeda],
  );
  const missing = (project.meta.easyeda ?? []).filter((n) => ee && !ee.some((e) => e.name.toLowerCase() === n.toLowerCase()));

  const byKind = useMemo(() => {
    const m = new Map<FabKind, FabFile[]>();
    for (const f of fab ?? []) m.set(f.kind, [...(m.get(f.kind) ?? []), f]);
    return m;
  }, [fab]);

  const lastGerber = byKind.get('gerber')?.[0]?.date ?? 0;
  const lastBoardEdit = Math.max(0, ...linked.map((e) => e.latest?.date ?? 0));
  const stale = lastGerber > 0 && lastBoardEdit > lastGerber + HOUR;
  const neverExported = linked.length > 0 && !lastGerber;

  const copy = async (name: string) => {
    setBusy(name);
    try {
      const dest = await api().copyEasyEdaBackup(project.path, name);
      onMessage(`Copied to ${dest.slice(project.path.length + 1)}`);
    } catch (err) {
      onMessage(errMsg(err));
    } finally {
      setBusy(null);
    }
  };

  const hasAnything = linked.length > 0 || (fab?.length ?? 0) > 0;

  return (
    <section className="panel">
      <h3>PCB · EasyEDA</h3>

      {linked.length > 0 ? (
        <ul className="ee-list">
          {linked.map((e) => (
            <li key={e.name}>
              <div className="ee-name">
                <strong>{e.name}</strong>
                <span className="muted small" title={e.latest ? formatDate(e.latest.date) : ''}>
                  {e.latest ? `Last change ${formatRelative(e.latest.date)}${e.latest.version ? ` · v${e.latest.version}` : ''}` : 'No backup yet'}
                  {' · '}
                  {e.backups} backup{e.backups === 1 ? '' : 's'}
                </span>
              </div>
              {e.latest && (
                <button className="button ghost small" disabled={busy === e.name} onClick={() => void copy(e.name)} title="Copy the latest backup into pcb/easyeda/">
                  {busy === e.name ? 'Copying…' : 'Copy backup to pcb/'}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">
          {found ? 'No EasyEDA project linked yet.' : 'EasyEDA Pro’s folder wasn’t found on this PC.'}{' '}
          {found && (
            <button className="link-button" onClick={onLinkAll}>
              Link EasyEDA projects…
            </button>
          )}
        </p>
      )}
      {missing.length > 0 && (
        <p className="muted small">
          Not found in EasyEDA’s backups: {missing.join(', ')}.{' '}
          <button className="link-button" onClick={onLinkAll}>
            Fix links…
          </button>
        </p>
      )}

      {stale && (
        <div className="check warn small">
          The board changed {formatRelative(lastBoardEdit)}, after the last Gerber export ({formatRelative(lastGerber)}). Export new Gerbers before
          ordering.
        </div>
      )}
      {neverExported && <div className="check warn small">No Gerber export in this project yet.</div>}

      <div className="panel-actions row">
        <button className="button small" onClick={() => void api().openEasyEda(project.path).catch((err) => onMessage(errMsg(err)))}>
          Open in EasyEDA
        </button>
        {linked.length > 0 && (
          <button className="button ghost small" onClick={onLinkAll}>
            Change links…
          </button>
        )}
      </div>

      {fab === null ? (
        <p className="muted small">Looking for exports…</p>
      ) : hasAnything && fab.length > 0 ? (
        <div className="fab-groups">
          {ORDER.filter((k) => byKind.has(k)).map((k) => {
            const files = byKind.get(k)!;
            return (
              <div key={k} className="fab-group">
                <span className="section-label">
                  {KIND_LABEL[k]} <span className="muted">{files.length}</span>
                </span>
                {files.slice(0, 3).map((f) => (
                  <button key={f.path} className="fab-file" onClick={() => onOpenFile(f.path)} title={f.relPath}>
                    <FileIcon size={14} category={k === 'step' ? 'cad' : k === 'schematic' ? 'doc' : 'pcb'} />
                    <span className="fab-name">{f.relPath}</span>
                    <span className="muted small">{formatRelative(f.date)}</span>
                  </button>
                ))}
                {files.length > 3 && <span className="muted small fab-more">+{files.length - 3} older</span>}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted small">No Gerber, BOM or schematic exports found in this project.</p>
      )}
    </section>
  );
}
