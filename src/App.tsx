import { useEffect, useState } from 'react';
import { ChatView } from './components/ChatView';
import { CommandPalette } from './components/CommandPalette';
import { ContextMenu } from './components/ContextMenu';
import { PreviewPanel } from './components/PreviewPanel';
import { Settings } from './components/Settings';
import { Sidebar } from './components/Sidebar';
import { TitleBar } from './components/TitleBar';
import { useChat } from './lib/useChat';
import { I18nProvider, detectLang } from './lib/i18n';
import { os, win, type ResizeEdge } from './api';

// Frameless-window resize handles: the WebView covers the native resize border, so we
// overlay thin edge/corner zones that ask the shell to start a native resize-drag.
const RESIZE_EDGES: ResizeEdge[] = ['top', 'right', 'bottom', 'left', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
function ResizeLayer() {
  return (
    <div className="resize-layer" aria-hidden>
      {RESIZE_EDGES.map((edge) => (
        <div
          key={edge}
          className={`resize-zone resize-${edge}`}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            win.startResize(edge).catch(() => {});
          }}
        />
      ))}
    </div>
  );
}

export function App() {
  const controller = useChat();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const themePref = controller.settings.theme;

  // Apply colour theme: follow Windows when "system", otherwise force. Also push the
  // resolved background to the native window so the DWM border/caption match the UI
  // (otherwise the window edge keeps the startup colour and looks wrong after theme change).
  useEffect(() => {
    const syncNativeBg = () => {
      requestAnimationFrame(() => {
        const bg = getComputedStyle(document.body).backgroundColor;
        const m = bg.match(/\d+/g);
        if (m && m.length >= 3) {
          const hex = '#' + m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
          win.setBackgroundColor(hex).catch(() => {});
        }
      });
    };
    const apply = (dark: boolean) => {
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      syncNativeBg();
    };
    if (themePref === 'dark') return apply(true), undefined;
    if (themePref === 'light') return apply(false), undefined;
    os.theme().then((t) => apply(t.dark)).catch(() => apply(true));
    return os.onThemeChanged((t) => apply(t.dark));
  }, [themePref]);

  // First run: pick UI language from the system locale.
  useEffect(() => {
    if (localStorage.getItem('deepseek.langInit')) return;
    localStorage.setItem('deepseek.langInit', '1');
    os.locale()
      .then((loc) => controller.updateSettings({ language: detectLang(loc) }))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ctrl/Cmd+K → command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <I18nProvider
      lang={controller.settings.language}
      setLang={(l) => controller.updateSettings({ language: l })}
    >
      <div className="app">
        <ResizeLayer />
        <TitleBar controller={controller} />
        <div className="body">
          <Sidebar
            controller={controller}
            onOpenSettings={() => setSettingsOpen(true)}
            onCloseSettings={() => setSettingsOpen(false)}
            onOpenSearch={() => setPaletteOpen(true)}
            settingsOpen={settingsOpen}
          />
          <main className="main">
            {settingsOpen ? (
              <Settings controller={controller} onClose={() => setSettingsOpen(false)} />
            ) : (
              <ChatView controller={controller} onOpenSettings={() => setSettingsOpen(true)} />
            )}
          </main>
          {controller.panelOpen && <PreviewPanel controller={controller} />}
        </div>
        {paletteOpen && (
          <CommandPalette
            controller={controller}
            onClose={() => setPaletteOpen(false)}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}
        <ContextMenu />
      </div>
    </I18nProvider>
  );
}
