import { lazy, Suspense, useEffect, useState } from 'react';
import { CATEGORY_LABEL, categorize, extOf, isLikelyText, isMarkdown, isPreviewableImage } from '../../shared/fileKinds';
import type { DirEntry, TextResult, ZipInfo } from '../../shared/types';
import { api, fileUrl, formatBytes, formatDate, relativePath, thumbUrl } from '../lib/format';
import { CodeView } from './CodeView';
import { CsvView } from './CsvView';
import { CodeIcon, FileIcon, FolderIcon } from './Icons';
import { MarkdownView } from './MarkdownView';
import { GerberView } from './GerberView';

// three.js and the STEP reader are big: load them the first time a model is opened.
const ModelView = lazy(() => import('./ModelView').then((m) => ({ default: m.ModelView })));
const MODEL_EXTS = new Set(['stl', 'obj', '3mf', 'step', 'stp', 'iges', 'igs', 'brep']);
const isModel = (name: string) => MODEL_EXTS.has(extOf(name));

/** Gerber zips as EasyEDA, KiCad (via plugins) and JLC name them. */
export const isGerberZip = (name: string) => /\.zip$/i.test(name) && /gerber|gbr/i.test(name);

interface Props {
  entry: DirEntry;
  projectPath: string;
  revealLine?: number;
  isCover?: boolean;
  onSelect: (entry: DirEntry) => void;
  onOpenPath: (path: string) => void;
  onSetCover?: (relPath: string) => void;
  onError: (message: string) => void;
}

/** Unknown extensions this small are worth sniffing for text. */
const SNIFF_LIMIT = 256 * 1024;

export function Preview({ entry, projectPath, revealLine, isCover, onSelect, onOpenPath, onSetCover, onError }: Props) {
  const rel = relativePath(projectPath, entry.path) || entry.name;
  const category = entry.isDir ? null : categorize(entry.name);
  const isImage = !entry.isDir && isPreviewableImage(entry.name);
  const run = (p: Promise<unknown>) => p.catch((err: unknown) => onError(err instanceof Error ? err.message : String(err)));

  return (
    <section className="preview">
      <header className="preview-header">
        <div className="preview-title">
          {entry.isDir ? <FolderIcon className="folder-icon" size={18} /> : <FileIcon size={18} category={category ?? 'other'} />}
          <div>
            <div className="preview-name">{entry.name}</div>
            <div className="preview-path">{rel}</div>
          </div>
        </div>
        <div className="preview-meta">
          {!entry.isDir && <span>{formatBytes(entry.size)}</span>}
          <span>{formatDate(entry.modified)}</span>
        </div>
        <div className="preview-actions">
          {isImage && onSetCover && (
            <button className="button ghost" disabled={isCover} onClick={() => onSetCover(relativePath(projectPath, entry.path))}>
              {isCover ? 'Cover image' : 'Set as cover'}
            </button>
          )}
          {!entry.isDir && (
            <button className="button" onClick={() => void run(api().openPath(entry.path))}>
              Open
            </button>
          )}
          <button className="button ghost" title="Open in VS Code" onClick={() => void run(api().openInEditor(entry.path))}>
            <CodeIcon size={15} />
          </button>
          <button className="button ghost" onClick={() => void run(api().showInFolder(entry.path))}>
            {api().platform === 'darwin' ? 'Finder' : 'Explorer'}
          </button>
        </div>
      </header>
      <div className="preview-body">
        {entry.isDir ? (
          <FolderView entry={entry} onSelect={onSelect} />
        ) : isGerberZip(entry.name) ? (
          <GerberView path={entry.path} modified={entry.modified} />
        ) : extOf(entry.name) === 'zip' ? (
          <ZipPreview entry={entry} />
        ) : isModel(entry.name) ? (
          <Suspense fallback={<div className="preview-note">Loading the 3D viewer…</div>}>
            <ModelView path={entry.path} name={entry.name} modified={entry.modified} />
          </Suspense>
        ) : extOf(entry.name) === 'pdf' ? (
          <iframe className="pdf-view" src={`${fileUrl(entry.path)}#navpanes=0&view=FitH`} title={entry.name} />
        ) : isImage ? (
          <div className="image-view">
            <img src={fileUrl(entry.path)} alt={entry.name} />
          </div>
        ) : isLikelyText(entry.name) || (category === 'other' && entry.size <= SNIFF_LIMIT) ? (
          <TextPreview entry={entry} revealLine={revealLine} onOpenPath={onOpenPath} />
        ) : (
          <NoPreview entry={entry} />
        )}
      </div>
    </section>
  );
}

/** Zips named anything (KiCad's mother.zip…): show the board if it holds Gerbers, else the file list. */
function ZipPreview({ entry }: { entry: DirEntry }) {
  const [info, setInfo] = useState<ZipInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    setError(null);
    api()
      .zipInfo(entry.path)
      .then((i) => !cancelled && setInfo(i))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [entry.path, entry.modified]);

  if (error) return <NoPreview entry={entry} />;
  if (!info) return <div className="preview-note">Reading the zip…</div>;
  if (info.gerber) return <GerberView path={entry.path} modified={entry.modified} />;
  if (info.tooLarge || !info.entries.length) return <NoPreview entry={entry} />;
  return (
    <div className="zip-list">
      <div className="muted small">
        {info.entries.length >= 500 ? 'First 500 files' : `${info.entries.length} file${info.entries.length > 1 ? 's' : ''}`} in this zip
      </div>
      <table>
        <tbody>
          {info.entries.map((e) => (
            <tr key={e.name}>
              <td>
                <FileIcon size={14} category={categorize(e.name)} /> {e.name}
              </td>
              <td className="muted">{e.size ? formatBytes(e.size) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Mode = 'rendered' | 'source';

function TextPreview({ entry, revealLine, onOpenPath }: { entry: DirEntry; revealLine?: number; onOpenPath: (p: string) => void }) {
  const [result, setResult] = useState<TextResult | null>(null);
  const ext = extOf(entry.name);
  const md = isMarkdown(entry.name);
  const table = ext === 'csv' || ext === 'tsv';
  const [mode, setMode] = useState<Mode>(revealLine ? 'source' : 'rendered');

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    api()
      .readText(entry.path)
      .then((r) => !cancelled && setResult(r))
      .catch((err: unknown) => !cancelled && setResult({ kind: 'error', message: String(err) }));
    return () => {
      cancelled = true;
    };
  }, [entry.path, entry.modified]);

  useEffect(() => {
    if (revealLine) setMode('source');
  }, [revealLine]);

  if (!result) return <div className="preview-note">Loading…</div>;
  if (result.kind === 'error') return <div className="preview-note error">Couldn’t read this file: {result.message}</div>;
  if (result.kind === 'binary') return <NoPreview entry={entry} />;

  const switchable = md || table;
  return (
    <div className="text-view">
      {(switchable || result.truncated || result.encoding !== 'UTF-8') && (
        <div className="text-toolbar">
          {switchable && (
            <div className="segmented">
              <button className={mode === 'rendered' ? 'active' : ''} onClick={() => setMode('rendered')}>
                {table ? 'Table' : 'Preview'}
              </button>
              <button className={mode === 'source' ? 'active' : ''} onClick={() => setMode('source')}>
                Source
              </button>
            </div>
          )}
          {result.truncated && <span className="muted">Showing the first 2 MB</span>}
          {result.encoding !== 'UTF-8' && <span className="muted">{result.encoding}</span>}
        </div>
      )}
      {md && mode === 'rendered' ? (
        <MarkdownView markdown={result.content} filePath={entry.path} onOpenPath={onOpenPath} />
      ) : table && mode === 'rendered' ? (
        <CsvView text={result.content} />
      ) : (
        <CodeView code={result.content} name={entry.name} revealLine={revealLine} />
      )}
    </div>
  );
}

function NoPreview({ entry }: { entry: DirEntry }) {
  const ext = extOf(entry.name);
  const category = categorize(entry.name);
  return (
    <div className="no-preview">
      <FileIcon size={56} category={category} />
      <div className="no-preview-title">{ext ? `.${ext} file` : 'File'}</div>
      <div className="muted">
        {CATEGORY_LABEL[category]} · {formatBytes(entry.size)}
      </div>
      <p className="muted">No preview for this file type yet.</p>
      <button className="button" onClick={() => void api().openPath(entry.path)}>
        Open with default app
      </button>
    </div>
  );
}

function FolderView({ entry, onSelect }: { entry: DirEntry; onSelect: (e: DirEntry) => void }) {
  const [items, setItems] = useState<DirEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api()
      .listDir(entry.path)
      .then((list) => !cancelled && setItems(list))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [entry.path, entry.modified]);

  if (error) return <div className="preview-note error">{error}</div>;
  if (!items) return <div className="preview-note">Loading…</div>;
  if (!items.length) return <div className="preview-note">This folder is empty.</div>;

  return (
    <div className="folder-grid">
      {items.map((item) => (
        <button
          key={item.path}
          className={`folder-item${item.heavy ? ' heavy' : ''}`}
          onClick={() => onSelect(item)}
          onDoubleClick={() => !item.isDir && void api().openPath(item.path)}
          title={item.name}
        >
          {item.isDir ? (
            <FolderIcon className="folder-icon" size={36} />
          ) : isPreviewableImage(item.name) ? (
            <img className="folder-thumb" src={thumbUrl(item.path, 160)} alt="" loading="lazy" />
          ) : (
            <FileIcon size={36} category={categorize(item.name)} />
          )}
          <span className="folder-item-name">{item.name}</span>
          <span className="folder-item-meta">{item.isDir ? 'Folder' : formatBytes(item.size)}</span>
        </button>
      ))}
    </div>
  );
}
