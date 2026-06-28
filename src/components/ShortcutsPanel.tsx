import { useEffect } from 'react';
import { useI18n } from '../lib/i18n';

// Keyboard shortcuts cheat-sheet (Ctrl+/). Static reference — the bindings live in App.tsx
// (palette/zoom/shortcuts) and Composer (new chat / send).
const SHORTCUTS: { keys: string[]; labelKey: string }[] = [
  { keys: ['Ctrl', 'K'], labelKey: 'scPalette' },
  { keys: ['Ctrl', 'N'], labelKey: 'scNew' },
  { keys: ['Ctrl', '+'], labelKey: 'scZoomIn' },
  { keys: ['Ctrl', '−'], labelKey: 'scZoomOut' },
  { keys: ['Ctrl', '0'], labelKey: 'scZoomReset' },
  { keys: ['Ctrl', '/'], labelKey: 'scShortcuts' },
  { keys: ['Enter'], labelKey: 'scSend' },
  { keys: ['Shift', 'Enter'], labelKey: 'scNewline' },
  { keys: ['Esc'], labelKey: 'scClose' },
];

export function ShortcutsPanel({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sc-overlay" onClick={onClose}>
      <div className="sc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sc-title">{t('shortcutsTitle')}</div>
        <div className="sc-list">
          {SHORTCUTS.map((s) => (
            <div className="sc-row" key={s.labelKey}>
              <span className="sc-label">{t(s.labelKey)}</span>
              <span className="sc-keys">
                {s.keys.map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
