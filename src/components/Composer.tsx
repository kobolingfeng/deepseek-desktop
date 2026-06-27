import { useEffect, useRef, useState } from 'react';
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
    el.style.height = Math.min(el.scrollHeight, 220) + 'px';
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
          {generating ? (
            <button className="send-btn stop" onClick={onStop} title={t('stop')}>
              <span className="stop-square" />
            </button>
          ) : (
            <button className="send-btn" onClick={submit} disabled={!text.trim() || disabled} title={t('send')}>
              ↑
            </button>
          )}
        </div>
        <div className="composer-hint">{t('composerHint')}</div>
      </div>
    </div>
  );
}
