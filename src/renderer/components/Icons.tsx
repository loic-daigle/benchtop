import type { FileCategory } from '../../shared/types';

type Props = { size?: number; className?: string };

function Stroke({ size = 16, className, d }: Props & { d: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

export function FolderIcon({ size = 16, open = false, className }: Props & { open?: boolean }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {open ? (
        <path fill="currentColor" d="M3 6a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1H7.4a2 2 0 0 0-1.9 1.4L3 18.5V6Zm2.4 5.2A1 1 0 0 1 6.3 10.5H21a1 1 0 0 1 1 1.3l-2 6.5a1 1 0 0 1-1 .7H4.3a.5.5 0 0 1-.5-.7l1.6-7.1Z" />
      ) : (
        <path fill="currentColor" d="M3 6a2 2 0 0 1 2-2h4.2l2 2H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" />
      )}
    </svg>
  );
}

export function FileIcon({ size = 16, category = 'other', className }: Props & { category?: FileCategory }) {
  return (
    <svg className={`file-icon cat-${category} ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" opacity="0.28" d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" />
      <path fill="currentColor" d="M14 2v4a1 1 0 0 0 1 1h4l-5-5Z" />
      <rect x="7" y="13" width="10" height="2.2" rx="1.1" fill="currentColor" />
      <rect x="7" y="16.8" width="6.5" height="2.2" rx="1.1" fill="currentColor" />
    </svg>
  );
}

export function ChevronIcon({ size = 12, className }: Props) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
    </svg>
  );
}

export const BackIcon = (p: Props) => <Stroke {...p} d="M15 5l-7 7 7 7" />;
export const ForwardIcon = (p: Props) => <Stroke {...p} d="M9 5l7 7-7 7" />;
export const RefreshIcon = (p: Props) => <Stroke {...p} d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4.5h-4.5" />;
export const TerminalIcon = (p: Props) => <Stroke {...p} d="M4 5h16v14H4zM8 10l3 2-3 2M13 15h3" />;
export const FolderOpenIcon = (p: Props) => <Stroke {...p} d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />;
export const CodeIcon = (p: Props) => <Stroke {...p} d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />;
export const PlusIcon = (p: Props) => <Stroke {...p} d="M12 5v14M5 12h14" />;
export const CloseIcon = (p: Props) => <Stroke {...p} d="M6 6l12 12M18 6 6 18" />;
export const LinkIcon = (p: Props) => <Stroke {...p} d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />;
export const BranchIcon = (p: Props) => <Stroke {...p} d="M6 4v12M6 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM18 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 8c0 5-6 4-12 8" />;

export function SearchIcon({ size = 16 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" d="m16 16 4.5 4.5" />
    </svg>
  );
}

export function SearchFilesIcon({ size = 16 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4M13 3l5 5h-5V3Z" />
      <circle cx="16" cy="15" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="m18.2 17.2 2.3 2.3" />
    </svg>
  );
}

export function PinIcon({ size = 16, filled = false }: Props & { filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8L12 3Z"
      />
    </svg>
  );
}

export function GitHubIcon({ size = 16 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5a3.9 3.9 0 0 1 1-2.7 3.6 3.6 0 0 1 .1-2.7s.8-.3 2.8 1a9.6 9.6 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7a3.9 3.9 0 0 1 1 2.7c0 3.9-2.3 4.7-4.6 5 .4.3.7.9.7 1.9V21c0 .3.2.6.7.5A10 10 0 0 0 12 2Z"
      />
    </svg>
  );
}

export const ChipIcon = (p: Props) => (
  <Stroke {...p} d="M8 8h8v8H8zM10 4v4M14 4v4M10 16v4M14 16v4M4 10h4M4 14h4M16 10h4M16 14h4" />
);
