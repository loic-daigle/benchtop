import { useMemo, useState } from 'react';
import type { ProjectKind, ProjectStatus } from '../../shared/types';
import { api } from '../lib/format';
import { STATUS_LABEL, STATUSES } from '../lib/status';
import { Dialog, errMsg } from './Dialog';

interface Props {
  root: string;
  groups: string[];
  onClose: () => void;
  onCreated: (path: string) => void;
}

const KINDS: Array<{ kind: ProjectKind; title: string; folders: string }> = [
  { kind: 'hardware', title: 'Hardware', folders: 'firmware · pcb · mechanical · docs · releases' },
  { kind: 'firmware', title: 'Firmware only', folders: 'firmware · docs · releases' },
  { kind: 'software', title: 'Software / app', folders: 'src · docs' },
];

export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function NewProjectDialog({ root, groups, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [folderEdited, setFolderEdited] = useState(false);
  const [kind, setKind] = useState<ProjectKind>('hardware');
  const [status, setStatus] = useState<ProjectStatus>('idea');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [group, setGroup] = useState('');
  const [gitInit, setGitInit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const folderName = folderEdited ? folder : slugify(name);
  const sep = root.includes('\\') ? '\\' : '/';
  const parentDir = group ? `${root}${sep}${group}` : root;
  const fullPath = useMemo(() => `${parentDir}${sep}${folderName || '…'}`, [parentDir, sep, folderName]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const path = await api().createProject({
        name: name.trim(),
        folderName,
        parentDir,
        kind,
        status,
        description: description.trim() || undefined,
        tags: tags
          .split(/[,\s]+/)
          .map((t) => t.trim().toLowerCase().replace(/^#/, ''))
          .filter(Boolean),
        gitInit,
      });
      onCreated(path);
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="New project"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <span className="muted small path-preview" title={fullPath}>
            {fullPath}
          </span>
          <div className="spacer" />
          <button className="button ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="button primary small" disabled={!name.trim() || !folderName || busy} onClick={() => void create()}>
            {busy ? 'Creating…' : 'Create project'}
          </button>
        </>
      }
    >
      <div className="form">
        <label className="field">
          <span>Name</span>
          <input
            className="input"
            autoFocus
            value={name}
            placeholder="Smart Dial"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && void create()}
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Folder name</span>
            <input
              className="input"
              value={folderName}
              onChange={(e) => {
                setFolderEdited(true);
                setFolder(e.target.value);
              }}
            />
          </label>
          <label className="field">
            <span>Location</span>
            <select className="select full" value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">Projects folder</option>
              {groups.map((g) => (
                <option key={g} value={g}>
                  {g}/
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="field">
          <span>Type</span>
          <div className="kind-picker">
            {KINDS.map((k) => (
              <button key={k.kind} className={`kind-option${kind === k.kind ? ' active' : ''}`} onClick={() => setKind(k.kind)}>
                <strong>{k.title}</strong>
                <span>{k.folders}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>Status</span>
          <div className="status-picker">
            {STATUSES.filter((s) => s !== 'archived' && s !== 'done').map((s) => (
              <button key={s} className={`status-option status-${s}${status === s ? ' active' : ''}`} onClick={() => setStatus(s)}>
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span>Description</span>
          <input className="input" value={description} placeholder="One line about it (optional)" onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="field">
          <span>Tags</span>
          <input className="input" value={tags} placeholder="esp32, usb-c, video (optional)" onChange={(e) => setTags(e.target.value)} />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={gitInit} onChange={(e) => setGitInit(e.target.checked)} />
          Start a git repository (you can publish it to GitHub later)
        </label>
        <p className="muted small">
          Also creates README.md, project.yaml, a .gitignore (keeps <code>secrets.h</code> and build folders out of git)
          {kind !== 'software' ? ' and a .gitattributes that stores STEP/STL/3MF/F3D files with Git LFS.' : '.'}
        </p>
        {error && <div className="notice error">{error}</div>}
      </div>
    </Dialog>
  );
}
