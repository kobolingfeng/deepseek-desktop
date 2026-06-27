import { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n';

export function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);

  // Auto-collapse once the answer starts arriving.
  useEffect(() => {
    if (!streaming) setOpen(false);
  }, [streaming]);

  if (!text) return null;

  return (
    <div className={`thinking ${open ? 'open' : ''}`}>
      <button className="thinking-head" onClick={() => setOpen((o) => !o)}>
        <span className="thinking-icon">✦</span>
        <span>{streaming ? t('thinking') : t('thoughtProcess')}</span>
        <span className="thinking-chevron">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="thinking-body">{text}</div>}
    </div>
  );
}
