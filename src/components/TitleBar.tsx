import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, PanelLeft } from 'lucide-react';
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

  // Title-bar drag is JS-driven (app-region is off, see native NCR note): a left-press on empty
  // title-bar area starts a native window move; double-click toggles maximize. Presses on buttons are
  // ignored so they keep working. The resize overlay sits above this (z-index) for the edges/corners.
  const dragGuard = (e: { target: EventTarget | null }) =>
    !!(e.target as HTMLElement)?.closest?.('button, input, a, [data-no-drag]');
  const onDragDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || dragGuard(e)) return;
    win.startDrag().catch(() => {});
  };
  const onTitleDouble = (e: React.MouseEvent) => {
    if (dragGuard(e)) return;
    (maximized ? win.restore() : win.maximize()).catch(() => {});
  };

  return (
    <div className="titlebar" onPointerDown={onDragDown} onDoubleClick={onTitleDouble}>
      <div className="titlebar-left">
        <button
          className="titlebar-toggle"
          onClick={controller.toggleSidebar}
          title={t('toggleSidebar')}
          aria-label={t('toggleSidebar')}
        >
          <PanelLeft size={17} strokeWidth={1.9} />
        </button>
        <button
          className="titlebar-toggle"
          onClick={controller.goBack}
          disabled={!controller.canGoBack}
          title={t('navBack')}
          aria-label={t('navBack')}
        >
          <ArrowLeft size={17} strokeWidth={1.9} />
        </button>
        <button
          className="titlebar-toggle"
          onClick={controller.goForward}
          disabled={!controller.canGoForward}
          title={t('navForward')}
          aria-label={t('navForward')}
        >
          <ArrowRight size={17} strokeWidth={1.9} />
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
