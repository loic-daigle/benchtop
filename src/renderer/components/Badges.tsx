import type { ProjectStatus, ProjectSummary } from '../../shared/types';
import { STATUS_LABEL } from '../lib/status';

export function StatusPill({ status, className = '' }: { status?: ProjectStatus; className?: string }) {
  if (!status) return null;
  return <span className={`status status-${status} ${className}`}>{STATUS_LABEL[status]}</span>;
}

export function GitChip({ project }: { project: ProjectSummary }) {
  const g = project.git;
  if (!project.isGitRepo) {
    return project.containsGitRepo ? (
      <span className="badge badge-git" title="A git repository exists in a subfolder">
        Git inside
      </span>
    ) : null;
  }
  if (!g) return <span className="badge badge-git">Git</span>;
  const title = [
    g.branch && `Branch ${g.branch}`,
    g.changes ? `${g.changes} uncommitted change${g.changes > 1 ? 's' : ''}` : 'No uncommitted changes',
    g.ahead ? `${g.ahead} commit(s) to push` : '',
    g.behind ? `${g.behind} commit(s) to pull` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <span className={`badge badge-git${g.changes ? ' dirty' : ''}`} title={title}>
      {g.branch ?? 'Git'}
      {g.changes ? ` · ${g.changes}` : ''}
      {g.ahead ? ` ↑${g.ahead}` : ''}
      {g.behind ? ` ↓${g.behind}` : ''}
    </span>
  );
}

/** Small chips describing what a project contains. */
export function Badges({ project, compact = false }: { project: ProjectSummary; compact?: boolean }) {
  const { counts } = project;
  const chips: Array<{ key: string; label: string; title: string }> = [];
  if (!compact && project.readmePath) chips.push({ key: 'readme', label: 'README', title: 'Has a README' });
  if (counts.code) chips.push({ key: 'code', label: compact ? 'Code' : `Code ${counts.code}`, title: `${counts.code} code / config files` });
  if (counts.pcb) chips.push({ key: 'pcb', label: compact ? 'PCB' : `PCB ${counts.pcb}`, title: `${counts.pcb} PCB files (Gerbers, BOMs, schematics)` });
  if (counts.cad) chips.push({ key: 'cad', label: compact ? '3D' : `3D ${counts.cad}`, title: `${counts.cad} 3D / CAD files` });
  if (!compact && counts.image) chips.push({ key: 'image', label: `Images ${counts.image}`, title: `${counts.image} images` });
  return (
    <div className="badges">
      <GitChip project={project} />
      {(project.meta.easyeda?.length ?? 0) > 0 && (
        <span className="badge badge-easyeda" title={`EasyEDA: ${project.meta.easyeda!.join(', ')}`}>
          EasyEDA
        </span>
      )}
      {chips.map((c) => (
        <span key={c.key} className={`badge badge-${c.key}`} title={c.title}>
          {c.label}
        </span>
      ))}
    </div>
  );
}
