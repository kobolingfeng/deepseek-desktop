import { useEffect, useRef, useState } from 'react';
import { win } from '../api';
import { MODELS, type ModelId } from '../lib/types';
import { useI18n } from '../lib/i18n';
import type { ChatController } from '../lib/useChat';

function ModelPicker({ value, onChange }: { value: ModelId; onChange: (m: ModelId) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = MODELS.find((m) => m.id === value) ?? MODELS[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="model-picker" ref={ref}>
      <button className="model-btn" onClick={() => setOpen((o) => !o)}>
        <span className="model-name">{current.label}</span>
        <span className="model-caret">▾</span>
      </button>
      {open && (
        <div className="model-menu">
          {MODELS.map((m) => (
            <button
              key={m.id}
              className="model-option"
              onClick={() => {
                onChange(m.id);
                setOpen(false);
              }}
            >
              <div className="model-option-main">
                <div className="model-option-label">{m.label}</div>
                <div className="model-option-blurb">{t(m.blurbKey)}</div>
              </div>
              <span className="model-badge">{t(m.tools ? 'toolsBadge' : 'reasoningBadge')}</span>
              {m.id === value && <span className="model-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TitleBar({ controller }: { controller: ChatController }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    win.isMaximized().then(setMaximized).catch(() => {});
    const offMax = win.onMaximized(() => setMaximized(true));
    const offRes = win.onRestored(() => setMaximized(false));
    return () => {
      offMax();
      offRes();
    };
  }, []);

  const model = controller.activeConversation?.model ?? controller.settings.model;

  return (
    <div className="titlebar">
      <div className="titlebar-left">
        <span className="app-mark">🐋</span>
        <span className="app-name">DeepSeek</span>
      </div>

      <div className="titlebar-center">
        <ModelPicker value={model} onChange={controller.setModel} />
      </div>

      <div className="titlebar-right">
        <button className="win-btn" onClick={() => win.minimize()} title="Minimize">
          ─
        </button>
        <button
          className="win-btn"
          onClick={() => (maximized ? win.restore() : win.maximize())}
          title={maximized ? 'Restore' : 'Maximize'}
        >
          {maximized ? '❐' : '▢'}
        </button>
        <button className="win-btn close" onClick={() => win.close()} title="Close">
          ✕
        </button>
      </div>
    </div>
  );
}
