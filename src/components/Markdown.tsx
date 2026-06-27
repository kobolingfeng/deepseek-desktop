import { Children, isValidElement, memo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { clipboard, shell } from '../api';
import { showContextMenu } from '../lib/contextMenu';
import { useI18n } from '../lib/i18n';
import { loadSettings } from '../lib/storage';

function extractText(node: ReactNode): string {
  if (node == null || node === false) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (isValidElement(node)) return extractText((node.props as { children?: ReactNode }).children);
  return '';
}

function CodeBlock({ children, ...props }: { children?: ReactNode }) {
  const { t } = useI18n();
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  // Language label from the inner <code class="language-xxx">.
  let lang = '';
  const child = Children.toArray(children)[0];
  if (isValidElement(child)) {
    const cls = (child.props as { className?: string })?.className || '';
    const m = /language-([\w-]+)/.exec(cls);
    if (m) lang = m[1];
  }

  const raw = extractText(children).replace(/\n+$/, '');
  const lineCount = raw ? raw.split('\n').length : 1;

  const copy = async () => {
    try {
      await clipboard.writeText(raw);
    } catch {
      try {
        await navigator.clipboard.writeText(raw);
      } catch {
        /* ignore */
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="code-block">
      <div className="code-head">
        <span className="code-lang">{lang || 'code'}</span>
        <button className="code-copy" onClick={copy} title={t('copy')}>
          {copied ? '✓ ' + t('copied') : '⧉ ' + t('copy')}
        </button>
      </div>
      <div className="code-body">
        <div className="code-gutter" aria-hidden>
          {Array.from({ length: lineCount }, (_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
        <pre ref={ref} {...props}>
          {children}
        </pre>
      </div>
    </div>
  );
}

function isHttp(h: string): boolean {
  return /^https?:\/\//i.test(h);
}
function isFileish(h: string): boolean {
  return (
    /^[a-zA-Z]:[\\/]/.test(h) ||
    h.startsWith('\\\\') ||
    /^file:/i.test(h) ||
    (/[\\/]/.test(h) && !h.includes('://') && !h.startsWith('#') && !/^mailto:/i.test(h))
  );
}
function resolveAbs(p: string): string {
  if (/^file:/i.test(p)) p = decodeURIComponent(p.replace(/^file:\/*/i, ''));
  if (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\')) return p.replace(/\//g, '\\');
  const wd = loadSettings().workingDir;
  return (wd ? wd.replace(/[\\/]+$/, '') + '\\' + p.replace(/^[\\/]+/, '') : p).replace(/\//g, '\\');
}

// Render links to local files / local servers as clickable blue links: left-click
// opens them; right-click shows a context menu (open / reveal / copy).
function ExternalLink({ href, children }: { href?: string; children?: ReactNode }) {
  const { t } = useI18n();
  if (!href) return <>{children}</>;
  const file = !isHttp(href) && isFileish(href);
  const open = () => {
    shell.open(file ? resolveAbs(href) : href).catch(() => {});
  };
  const onContext = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const items = file
      ? [
          { label: t('ctxOpen'), onClick: open },
          {
            label: t('ctxReveal'),
            onClick: () => {
              const abs = resolveAbs(href);
              shell.execute('explorer.exe', ['/select,', abs]).catch(() => shell.open(abs).catch(() => {}));
            },
          },
          { label: t('ctxCopyPath'), onClick: () => clipboard.writeText(resolveAbs(href)).catch(() => {}) },
        ]
      : [
          { label: t('ctxOpen'), onClick: open },
          { label: t('ctxCopyLink'), onClick: () => clipboard.writeText(href).catch(() => {}) },
        ];
    showContextMenu(e.clientX, e.clientY, items);
  };
  return (
    <a
      href={href}
      className={file ? 'md-link file' : 'md-link url'}
      onClick={(e) => {
        e.preventDefault();
        open();
      }}
      onContextMenu={onContext}
    >
      {children}
    </a>
  );
}

// Auto-linkify bare file paths in rendered text (remark-gfm already links URLs).
// A path = optional drive/UNC/relative prefix + ≥1 separator + a final .ext.
const PATH_RE =
  /(?:[A-Za-z]:[\\/]|\\\\|\.{0,2}[\\/])?[\w.+-]+(?:[\\/][\w.+-]+)+\.[A-Za-z][\w]{0,9}/g;

function splitPathText(value: string): any[] {
  const out: any[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  PATH_RE.lastIndex = 0;
  while ((m = PATH_RE.exec(value))) {
    const start = m.index;
    // Skip if preceded by a char that means it's part of a URL/email/word.
    if (start > 0 && /[\w@:/\\]/.test(value[start - 1])) continue;
    if (start > last) out.push({ type: 'text', value: value.slice(last, start) });
    out.push({
      type: 'element',
      tagName: 'a',
      properties: { href: m[0] },
      children: [{ type: 'text', value: m[0] }],
    });
    last = start + m[0].length;
  }
  if (!out.length) return [{ type: 'text', value }];
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

function rehypeFilePaths() {
  const walk = (node: any, skip: boolean) => {
    if (!node || !node.children) return;
    const stop = skip || node.tagName === 'a' || node.tagName === 'code' || node.tagName === 'pre';
    const next: any[] = [];
    for (const child of node.children) {
      if (child.type === 'text' && !stop) {
        next.push(...splitPathText(child.value));
      } else {
        walk(child, stop);
        next.push(child);
      }
    }
    node.children = next;
  };
  return (tree: any) => walk(tree, false);
}

export const Markdown = memo(function Markdown({
  text,
  highlight = true,
}: {
  text: string;
  highlight?: boolean;
}) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[...(highlight ? [[rehypeHighlight, { detect: true, ignoreMissing: true }]] : []), rehypeFilePaths] as any}
        components={{ pre: CodeBlock as any, a: ExternalLink as any }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
