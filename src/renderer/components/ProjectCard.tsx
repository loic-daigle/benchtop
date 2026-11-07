import { useState } from 'react';
import type { ProjectSummary } from '../../shared/types';
import { formatRelative, hueFor, initials, thumbUrl } from '../lib/format';
import { Badges, StatusPill } from './Badges';
import { PinIcon } from './Icons';

interface Props {
  project: ProjectSummary;
  pinned: boolean;
  onOpen: () => void;
  onTogglePin: () => void;
}

export function ProjectCard({ project, pinned, onOpen, onTogglePin }: Props) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const hue = hueFor(project.name);
  const showThumb = project.thumbnailPath && !thumbFailed;
  const tags = project.meta.tags ?? [];

  return (
    <div
      className={`card${project.meta.status === 'archived' ? ' archived' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      title={project.path}
    >
      <div className="card-thumb" style={{ ['--hue' as string]: hue }}>
        {showThumb ? (
          <img src={thumbUrl(project.thumbnailPath!)} alt="" loading="lazy" onError={() => setThumbFailed(true)} />
        ) : (
          <span className="card-initials">{initials(project.name)}</span>
        )}
        <StatusPill status={project.meta.status} className="on-thumb" />
        <button
          className={`pin-button${pinned ? ' pinned' : ''}`}
          title={pinned ? 'Unpin' : 'Pin to top'}
          aria-label={pinned ? 'Unpin' : 'Pin to top'}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
        >
          <PinIcon size={15} filled={pinned} />
        </button>
      </div>
      <div className="card-body">
        <div className="card-title">
          {project.group && <span className="card-group">{project.group} / </span>}
          {project.name}
        </div>
        {project.description ? (
          <p className="card-desc">{project.description}</p>
        ) : (
          <p className="card-desc muted">{project.fileCount ? `${project.fileCount} files` : 'Empty folder'}</p>
        )}
        <Badges project={project} compact />
        {tags.length > 0 && (
          <div className="tags">
            {tags.slice(0, 4).map((t) => (
              <span key={t} className="tag">
                #{t}
              </span>
            ))}
            {tags.length > 4 && <span className="tag muted">+{tags.length - 4}</span>}
          </div>
        )}
        <div className="card-meta">Modified {formatRelative(project.modified)}</div>
      </div>
    </div>
  );
}
