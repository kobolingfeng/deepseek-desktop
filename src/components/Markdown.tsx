import { memo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { clipboard, shell } from '../api';
import { useI18n } from '../lib/i18n';

function CodeBlock({ children, ...props }: { children?: ReactNode }) {
  const { t } = useI18n();
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const text = ref.current?.innerText ?? '';
    try {
      await clipboard.writeText(text);
    } catch {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        /* ignore */
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="code-block">
      <button className="code-copy" onClick={copy} title={t('copy')}>
        {copied ? '✓ ' + t('copied') : t('copy')}
      </button>
      <pre ref={ref} {...props}>
        {children}
      </pre>
    </div>
  );
}

function ExternalLink({ href, children }: { href?: string; children?: ReactNode }) {
  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (href) shell.open(href).catch(() => {});
  };
  return (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  );
}

export const Markdown = memo(function Markdown({ text, highlight = true }: { text: string; highlight?: boolean }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={highlight ? [[rehypeHighlight, { detect: true, ignoreMissing: true }]] : []}
        components={{ pre: CodeBlock as any, a: ExternalLink as any }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
