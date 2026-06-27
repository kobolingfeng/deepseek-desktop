import { useEffect, useState } from 'react';
import { win } from '../api';
import type { ChatController } from '../lib/useChat';

export function TitleBar(_props: { controller: ChatController }) {
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
        <span className="app-mark">🐋</span>
        <span className="app-name">DeepSeek</span>
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
