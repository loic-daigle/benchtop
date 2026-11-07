import type { ReactNode } from 'react';
import { CloseIcon } from './Icons';

/** Errors from the main process arrive as "Error invoking remote method 'x': Error: message". */
export function errMsg(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '');
}

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Prevent closing (e.g. while publishing). */
  busy?: boolean;
}

export function Dialog({ title, onClose, children, footer, wide, busy }: Props) {
  const close = () => !busy && onClose();
  return (
    <div className="overlay dialog-overlay" onMouseDown={close} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className={`dialog${wide ? ' wide' : ''}`} role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <header className="dialog-head">
          <h2>{title}</h2>
          <button className="icon-button" onClick={close} disabled={busy} title="Close">
            <CloseIcon />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-foot">{footer}</footer>}
      </div>
    </div>
  );
}
