import { useEffect, useReducer, useRef, useState } from 'react';
import { Markdown } from './Markdown';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCallCard } from './ToolCallCard';
import { clipboard } from '../api';
import { useI18n, type Lang } from '../lib/i18n';
import type { Message as Msg } from '../lib/types';

function clockTime(ts: number, lang: Lang): string {
  const d = new Date(ts);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  if (lang === 'zh') return `${String(h).padStart(2, '0')}:${m}`;
  return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

function metaLine(m: Msg, lang: Lang): string | undefined {
  const parts: string[] = [];
  if (m.model) parts.push(m.model);
  if (m.elapsedMs != null) parts.push((m.elapsedMs / 1000).toFixed(1) + 's');
  if (m.tokens) parts.push(`${m.tokens} ${lang === 'zh' ? 'tokens' : 'tok'}`);
  return parts.length ? parts.join(' · ') : undefined;
}

function StreamingMeter({ since, label }: { since: number; label: string }) {
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.round((Date.now() - since) / 1000));
  return (
    <span className="stream-meter">
      <span className="stream-dot" />
      {label} · {s}s
    </span>
  );
}

function CompactedNote({ text }: { text: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="compacted">
      <button className="compacted-head" onClick={() => setOpen((o) => !o)}>
        <span>🗜 {t('compacted')}</span>
        <span className="compacted-chevron">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="compacted-body">{text}</div>}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
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
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1200);
  };
  return (
    <button className="msg-action icon-only" onClick={onCopy} title={copied ? t('copied') : t('copy')}>
      {copied ? '✓' : '⧉'}
    </button>
  );
}

function MessageActions({ content, meta }: { content: string; meta?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await clipboard.writeText(content);
    } catch {
      try {
        await navigator.clipboard.writeText(content);
      } catch {
        /* ignore */
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="msg-actions">
      <button className="msg-action" onClick={copy} title={t('copy')}>
        {copied ? '✓ ' + t('copied') : '⧉ ' + t('copy')}
      </button>
      {meta && <span className="msg-meta">{meta}</span>}
    </div>
  );
}

export function Message({
  message,
  toolResults,
}: {
  message: Msg;
  toolResults: Map<string, Msg>;
}) {
  const { t, lang } = useI18n();

  if (message.compacted) {
    return <CompactedNote text={message.content} />;
  }

  if (message.role === 'user') {
    return (
      <div className="msg user">
        <div className="user-col">
          <div className="bubble user-bubble">{message.content}</div>
          <div className="msg-underbar">
            <CopyButton text={message.content} />
            <span className="msg-time">{clockTime(message.createdAt, lang)}</span>
          </div>
        </div>
      </div>
    );
  }

  // assistant
  const streaming = !!message.pending;
  const empty = !message.content && !message.reasoning && !(message.toolCalls && message.toolCalls.length);

  return (
    <div className="msg assistant">
      <div className="avatar" aria-hidden>
        🐋
      </div>
      <div className="assistant-body">
        {message.reasoning && <ThinkingBlock text={message.reasoning} streaming={streaming && !message.content} />}

        {message.toolCalls?.map((tc, i) => (
          <ToolCallCard key={tc.id || `${tc.name}:${i}`} call={tc} result={tc.id ? toolResults.get(tc.id) : undefined} />
        ))}

        {message.content && <Markdown text={message.content} highlight={!streaming} />}

        {streaming && empty && <StreamingMeter since={message.createdAt} label={t('thinking')} />}
        {streaming && !empty && message.content && <span className="caret" />}

        {message.error && <div className="msg-error">⚠ {message.error}</div>}

        {!streaming && message.content && (
          <MessageActions content={message.content} meta={metaLine(message, lang)} />
        )}
      </div>
    </div>
  );
}
