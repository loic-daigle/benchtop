import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { api, dirname, fileUrl, joinPath } from '../lib/format';
import { highlightFence } from '../lib/highlight';

interface Props {
  markdown: string;
  filePath: string;
  /** Called when a relative link points to another file in the project. */
  onOpenPath: (path: string) => void;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function safeDecode(s: string): string {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}

export function MarkdownView({ markdown, filePath, onOpenPath }: Props) {
  const base = dirname(filePath);

  const resolveLocal = (url: string) => joinPath(base, safeDecode(url.split(/[?#]/)[0]));
  /** An image URL as the app can load it: web images as is, project files through benchtop://. */
  const imageUrl = (url: string) => {
    if (/^https?:/i.test(url) || /^data:image\//i.test(url)) return url;
    if (SCHEME.test(url)) return '';
    return fileUrl(resolveLocal(url));
  };

  return (
    <article className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // READMEs often use HTML (<p align="center">, <picture>, <img width>, <details>): render it,
        // cleaned with GitHub's rules so no scripts or event handlers get through.
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        urlTransform={(url, key) => {
          if (url.startsWith('#')) return url;
          if (SCHEME.test(url)) {
            if (/^(https?|mailto):/i.test(url)) return url;
            if (/^data:image\//i.test(url) && key === 'src') return url;
            return ''; // drop javascript:, file:, etc.
          }
          // Relative path: images load through the app's file protocol.
          return key === 'src' ? fileUrl(resolveLocal(url)) : url;
        }}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (!href || href.startsWith('#')) return;
                if (/^(https?|mailto):/i.test(href)) void api().openExternal(href);
                else onOpenPath(resolveLocal(href));
              }}
            >
              {children}
            </a>
          ),
          // <picture><source srcset="logo-dark.svg" media="(prefers-color-scheme: dark)"> follows the app theme.
          source: ({ srcSet, src, media, type }) => (
            <source
              media={media}
              type={type}
              src={src}
              srcSet={srcSet
                ?.split(',')
                .map((part) => {
                  const [url, ...desc] = part.trim().split(/\s+/);
                  const u = imageUrl(url);
                  return u ? [u, ...desc].join(' ') : '';
                })
                .filter(Boolean)
                .join(', ')}
            />
          ),
          code: ({ className, children }) => {
            const lang = /language-(\w+)/.exec(className ?? '')?.[1];
            const text = String(children ?? '');
            if (!lang) return <code className={className}>{children}</code>;
            const html = highlightFence(text, lang);
            return <code className={`hljs ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: html }} />;
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
