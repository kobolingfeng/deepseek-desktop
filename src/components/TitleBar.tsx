import { useEffect, useState } from 'react';
import { PanelLeft } from 'lucide-react';
import { win } from '../api';
import { useI18n } from '../lib/i18n';
import type { ChatController } from '../lib/useChat';

export function TitleBar({ controller }: { controller: ChatController }) {
  const { t } = useI18n();
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

  return (
    <div className="titlebar">
      <div className="titlebar-left">
        <button
          className="titlebar-toggle"
          onClick={controller.toggleSidebar}
          title={t('toggleSidebar')}
          aria-label={t('toggleSidebar')}
        >
          <PanelLeft size={17} strokeWidth={1.9} />
        </button>
      </div>

      <div className="titlebar-center" />

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
