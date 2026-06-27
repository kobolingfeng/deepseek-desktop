import { useEffect, useRef, useState } from 'react';
import { dialog } from '../api';
import { useI18n } from '../lib/i18n';

export function Composer({
  generating,
  onSend,
  onStop,
  disabled,
  placeholder,
}: {
  generating: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [text]);

  const submit = () => {
    const tx = text.trim();
    if (!tx || generating || disabled) return;
    onSend(tx);
    setText('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const attach = async () => {
    try {
      const p = await dialog.openFile();
      const path = Array.isArray(p) ? p[0] : p;
      if (path) {
        setText((prev) => (prev ? prev.replace(/\s*$/, ' ') : '') + path);
        ref.current?.focus();
      }
    } catch {
      /* ignore */
    }
  };

  const insertCode = () => {
    setText((prev) => (prev.trimEnd() ? prev.trimEnd() + '\n\n' : '') + '```\n\n```\n');
    ref.current?.focus();
  };

  return (
    <div className="composer">
      <div className="composer-inner">
        <div className="composer-box">
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder ?? t('composerPlaceholder')}
            rows={1}
            disabled={disabled}
          />
          <div className="composer-bar">
            <div className="composer-tools">
              <button className="composer-tool" onClick={attach} title={t('attachFile')} disabled={disabled}>
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M10.5 5.2 6 9.7a1.6 1.6 0 0 0 2.3 2.3l4.6-4.6a3 3 0 0 0-4.3-4.3L4 7.8a4.4 4.4 0 0 0 6.2 6.2l3.8-3.8"
                  />
                </svg>
              </button>
              <button className="composer-tool mono" onClick={insertCode} title={t('insertCode')} disabled={disabled}>
                {'{ }'}
              </button>
            </div>
            {generating ? (
              <button className="send-btn stop" onClick={onStop} title={t('stop')}>
                <span className="stop-square" />
              </button>
            ) : (
              <button
                className="send-btn"
                onClick={submit}
                disabled={!text.trim() || disabled}
                title={t('send')}
              >
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                  <path fill="currentColor" d="M1.7 7.3 14 2.1c.5-.2 1 .3.8.8L9.6 15c-.2.5-.9.5-1.1 0L6.9 9.9a.5.5 0 0 0-.3-.3L1.7 8.4c-.5-.2-.5-.9 0-1.1Z" />
                </svg>
              </button>
            )}
          </div>
        </div>
        <div className="composer-hint">{t('disclaimer')}</div>
      </div>
    </div>
  );
}
