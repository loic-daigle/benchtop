import { useEffect, useState } from 'react';
import type { ApplyResult, StructurePlan } from '../../shared/types';
import { api, relativePath } from '../lib/format';
import { Dialog, errMsg } from './Dialog';
import { FileIcon, FolderIcon } from './Icons';
import { categorize } from '../../shared/fileKinds';

interface Props {
  projectPath: string;
  projectName: string;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function StructureDialog({ projectPath, projectName, onClose, onDone }: Props) {
  const [plan, setPlan] = useState<StructurePlan | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [canUndo, setCanUndo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);

  const load = () => {
    setPlan(null);
    setResult(null);
    Promise.all([api().planStructure(projectPath), api().canUndoStructure(projectPath)])
      .then(([p, u]) => {
        setPlan(p);
        setSelected(new Set(p.moves.map((_, i) => i)));
        setCanUndo(u);
      })
      .catch((err) => setError(errMsg(err)));
  };
  useEffect(load, [projectPath]);

  const rel = (p: string) => relativePath(projectPath, p) || '.';

  const apply = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const moves = plan.moves.filter((_, i) => selected.has(i));
      const r = await api().applyStructure(projectPath, moves);
      setResult(r);
      if (!r.failed.length) {
        onDone(`Moved ${r.done.length} item${r.done.length === 1 ? '' : 's'} in ${projectName}. You can undo it from the same window.`);
      }
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api().undoStructure(projectPath);
      onDone(r.failed.length ? `Undo: ${r.failed.length} item(s) couldn’t be moved back.` : `Undid the last reorganisation of ${projectName}.`);
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };

  const count = selected.size;

  return (
    <Dialog
      title={`Make “${projectName}” consistent`}
      wide
      onClose={onClose}
      busy={busy}
      footer={
        <>
          {canUndo && !result && (
            <button className="button ghost" onClick={() => void undo()} disabled={busy}>
              Undo last reorganisation
            </button>
          )}
          <div className="spacer" />
          <button className="button ghost" onClick={onClose} disabled={busy}>
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button className="button primary small" disabled={!count || busy} onClick={() => void apply()}>
              {busy ? 'Moving…' : `Move ${count} item${count === 1 ? '' : 's'}`}
            </button>
          )}
        </>
      }
    >
      {error && <div className="notice error">{error}</div>}
      {!plan && !error && <div className="preview-note">Looking at the project…</div>}
      {plan && !result && (
        <div className="plan">
          <p className="muted small">
            Standard layout: <code>firmware/</code> <code>pcb/</code> <code>mechanical/</code> <code>docs/</code> <code>releases/</code>. Benchtop
            only <strong>moves</strong> files and folders. Nothing is deleted or overwritten, and you can undo.
          </p>
          {plan.warnings.map((w) => (
            <div key={w} className="notice">
              {w}
            </div>
          ))}
          {plan.moves.length > 0 ? (
            <>
              <div className="plan-head">
                <span className="section-label">Proposed moves</span>
                <button
                  className="link-button small"
                  onClick={() => setSelected(count === plan.moves.length ? new Set() : new Set(plan.moves.map((_, i) => i)))}
                >
                  {count === plan.moves.length ? 'Select none' : 'Select all'}
                </button>
              </div>
              <ul className="plan-list">
                {plan.moves.map((m, i) => (
                  <li key={m.from}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.has(i)}
                        onChange={() => {
                          const next = new Set(selected);
                          if (next.has(i)) next.delete(i);
                          else next.add(i);
                          setSelected(next);
                        }}
                      />
                      {m.isDir ? <FolderIcon className="folder-icon" size={15} /> : <FileIcon size={15} category={categorize(m.from)} />}
                      <span className="plan-from">{rel(m.from)}</span>
                      <span className="plan-arrow">→</span>
                      <span className="plan-to">{rel(m.to)}</span>
                      <span className="plan-reason muted small">{m.reason}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="preview-note">Nothing to move — this project already follows the layout (or is left as is).</div>
          )}
          {plan.kept.length > 0 && (
            <details className="plan-kept">
              <summary className="muted small">{plan.kept.length} item(s) stay where they are</summary>
              <ul>
                {plan.kept.map((k) => (
                  <li key={k.path} className="small">
                    <span>{rel(k.path)}</span> <span className="muted">— {k.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {result && (
        <div className="plan">
          <div className="notice">
            Moved {result.done.length} item{result.done.length === 1 ? '' : 's'}.
            {result.failed.length ? ` ${result.failed.length} couldn’t be moved:` : ''}
          </div>
          {result.failed.length > 0 && (
            <ul className="plan-list">
              {result.failed.map((f) => (
                <li key={f.item.from} className="small">
                  {rel(f.item.from)} <span className="error">— {f.error}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  );
}
