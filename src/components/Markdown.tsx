import { Children, isValidElement, memo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { Copy, Check } from 'lucide-react';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { clipboard, fs, notification, shell } from '../api';
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
        <button className="code-copy" onClick={copy} title={copied ? t('copied') : t('copy')} aria-label={t('copy')}>
          {copied ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={1.9} />}
        </button>
      </div>
      <pre ref={ref} {...props}>
        {children}
      </pre>
    </div>
  );
}

function isHttp(h: string): boolean {
  return /^https?:\/\//i.test(h);
}
// File extensions the agent commonly creates/links, so a BARE filename like "Deck.pptx"
// (no directory separator) is still treated as a file rather than an opaque URL.
const FILE_EXT = new Set([
  'pptx', 'ppt', 'docx', 'doc', 'xlsx', 'xls', 'xlsm', 'csv', 'pdf',
  'md', 'txt', 'json', 'yaml', 'yml', 'xml', 'html', 'htm', 'css',
  'js', 'ts', 'tsx', 'jsx', 'py', 'sh', 'bat', 'ps1', 'c', 'cpp', 'h', 'rs', 'go', 'java', 'sql', 'log', 'ini', 'toml',
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'zip',
]);
function isFileish(h: string): boolean {
  if (/^[a-zA-Z]:[\\/]/.test(h) || h.startsWith('\\\\') || /^file:/i.test(h)) return true;
  if (/[\\/]/.test(h) && !h.includes('://') && !h.startsWith('#') && !/^mailto:/i.test(h)) return true;
  // bare "name.ext" with a known file extension — the common case for a file the agent just
  // created and linked by name (no path), which otherwise fell through to the URL branch.
  const m = /^[^\s/\\?#:]+\.([A-Za-z0-9]{1,9})$/.exec(h);
  return !!m && FILE_EXT.has(m[1].toLowerCase());
}
function resolveAbs(p: string, cwd?: string): string {
  if (/^file:/i.test(p)) p = decodeURIComponent(p.replace(/^file:\/*/i, ''));
  if (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\')) return p.replace(/\//g, '\\');
  const wd = cwd || loadSettings().workingDir; // prefer the conversation's working dir
  return (wd ? wd.replace(/[\\/]+$/, '') + '\\' + p.replace(/^[\\/]+/, '') : p).replace(/\//g, '\\');
}

// Render links to local files / local servers as clickable blue links: left-click
// opens them; right-click shows a context menu (open / reveal / copy).
function ExternalLink({ href, children, cwd }: { href?: string; children?: ReactNode; cwd?: string }) {
  const { t } = useI18n();
  if (!href) return <>{children}</>;
  // Markdown link destinations are percent-encoded by the parser (\ → %5C, CJK → %..),
  // which hid file paths behind the URL classifier — decode before classifying/opening.
  const safeDecode = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  const target = href.includes('%') ? safeDecode(href) : href;
  const file = !isHttp(target) && isFileish(target);
  const abs = file ? resolveAbs(target, cwd) : href;
  const parent = file ? abs.replace(/[\\/][^\\/]*$/, '') || abs : '';

  const openFile = async () => {
    // Never auto-run an executable from a link (the model could mislabel it) — reveal it instead.
    if (/\.(exe|bat|cmd|com|scr|msi|ps1|psm1|vbs|vbe|wsf|jar|reg|hta|cpl|lnk|msc|pif)$/i.test(abs)) {
      shell.execute('explorer.exe', ['/select,', abs]).catch(() => {});
      notification.show(t('linkExecReveal'), abs).catch(() => {});
      return;
    }
    try {
      await shell.open(abs); // default double-click behaviour (open with the registered app)
    } catch {
      // Not silent: tell the user (e.g. the file no longer exists).
      notification.show(t('ctxOpenFailed'), abs).catch(() => {});
    }
  };
  const openUrl = () => shell.open(href).catch(() => {});

  const onContext = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const items = file
      ? [
          { label: t('ctxOpen'), onClick: openFile },
          { label: t('ctxOpenFolder'), onClick: () => shell.open(parent).catch(() => {}) },
          { label: t('ctxReveal'), onClick: () => shell.execute('explorer.exe', ['/select,', abs]).catch(() => {}) },
          { label: t('ctxCopyPath'), onClick: () => clipboard.writeText(abs).catch(() => {}) },
          {
            label: t('ctxCopyContents'),
            onClick: async () => {
              try {
                await clipboard.writeText(await fs.readTextFile(abs));
              } catch {
                /* unreadable */
              }
            },
          },
        ]
      : [
          { label: t('ctxOpenBrowser'), onClick: openUrl },
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
        if (file) openFile();
        else openUrl();
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
  /(?:[A-Za-z]:[\\/]|\\\\|\.{0,2}[\\/])?[\p{L}\p{N}_.+-]+(?:[\\/][\p{L}\p{N}_.+-]+)+\.[A-Za-z][\w]{0,9}/gu;

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
    // Coalesce consecutive text nodes first — micromark splits a backslash path
    // like C:\Users\x into several text nodes, so per-node matching would miss it.
    let buf = '';
    const flush = () => {
      if (!buf) return;
      if (stop) next.push({ type: 'text', value: buf });
      else next.push(...splitPathText(buf));
      buf = '';
    };
    for (const child of node.children) {
      if (child.type === 'text') {
        buf += child.value;
      } else {
        flush();
        walk(child, stop);
        next.push(child);
      }
    }
    flush();
    node.children = next;
  };
  return (tree: any) => walk(tree, false);
}

export const Markdown = memo(function Markdown({
  text,
  highlight = true,
  cwd,
}: {
  text: string;
  highlight?: boolean;
  cwd?: string;
}) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[...(highlight ? [[rehypeHighlight, { detect: true, ignoreMissing: true }]] : []), rehypeFilePaths] as any}
        // Default urlTransform drops "C:\..." (looks like an unknown protocol); allow
        // file paths through, block only dangerous schemes (we open via shell, not navigate).
        urlTransform={(url) => (/^\s*(javascript|data|vbscript):/i.test(url) ? '' : url)}
        components={{ pre: CodeBlock as any, a: ((props: any) => <ExternalLink {...props} cwd={cwd} />) as any }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
