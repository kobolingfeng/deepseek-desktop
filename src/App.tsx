import { useEffect, useState } from 'react';
import { ChatView } from './components/ChatView';
import { CommandPalette } from './components/CommandPalette';
import { ContextMenu } from './components/ContextMenu';
import { PreviewPanel } from './components/PreviewPanel';
import { Settings } from './components/Settings';
import { Sidebar } from './components/Sidebar';
import { TitleBar } from './components/TitleBar';
import { ShortcutsPanel } from './components/ShortcutsPanel';
import { useChat } from './lib/useChat';
import { I18nProvider, detectLang } from './lib/i18n';
import { os, win, tray, type ResizeEdge } from './api';

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
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const themePref = controller.settings.theme;

  // Apply colour theme: follow Windows when "system", otherwise force. Also push the
  // resolved background to the native window so the DWM border/caption match the UI
  // (otherwise the window edge keeps the startup colour and looks wrong after theme change).
  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    const apply = (dark: boolean) => {
      if (cancelled) return; // a newer themePref effect superseded this one
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const bg = getComputedStyle(document.body).backgroundColor;
        const m = bg.match(/\d+/g);
        if (m && m.length >= 3) {
          const hex = '#' + m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
          win.setBackgroundColor(hex).catch(() => {});
        }
      });
    };
    if (themePref === 'dark') {
      apply(true);
      return () => { cancelled = true; cancelAnimationFrame(raf); };
    }
    if (themePref === 'light') {
      apply(false);
      return () => { cancelled = true; cancelAnimationFrame(raf); };
    }
    os.theme().then((t) => apply(t.dark)).catch(() => apply(true));
    const off = os.onThemeChanged((t) => apply(t.dark));
    return () => { cancelled = true; cancelAnimationFrame(raf); off?.(); };
  }, [themePref]);

  // Apply persisted left-sidebar width + global UI zoom to the document root.
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', controller.sidebarWidth + 'px');
    document.documentElement.style.setProperty('zoom', String(controller.zoom));
  }, [controller.sidebarWidth, controller.zoom]);

  // System tray: clicking the tray icon restores + shows the window; the native right-click
  // menu (Show / Exit) is labelled in the current UI language.
  useEffect(() => {
    const lbl =
      controller.settings.language === 'zh' ? { show: '显示', exit: '退出' } : { show: 'Show', exit: 'Exit' };
    tray.create('DeepSeek', lbl).catch(() => {});
    const reveal = () => {
      win.restore().catch(() => {});
      win.show().catch(() => {});
    };
    const offClick = tray.onClick(reveal);
    const offDbl = tray.onDoubleClick(reveal);
    return () => {
      offClick?.();
      offDbl?.();
      tray.remove().catch(() => {});
    };
  }, []);

  // First run: pick UI language from the system locale.
  useEffect(() => {
    if (localStorage.getItem('deepseek.langInit')) return;
    localStorage.setItem('deepseek.langInit', '1');
    os.locale()
      .then((loc) => controller.updateSettings({ language: detectLang(loc) }))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global shortcuts: Ctrl/Cmd+K palette, Ctrl ±/0 zoom, Ctrl+/ cheat-sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.altKey) return;
      const k = e.key.toLowerCase();
      if (!e.shiftKey && k === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (!e.shiftKey && (k === '=' || k === '+')) {
        e.preventDefault();
        controller.zoomBy(0.1);
      } else if (!e.shiftKey && (k === '-' || k === '_')) {
        e.preventDefault();
        controller.zoomBy(-0.1);
      } else if (!e.shiftKey && k === '0') {
        e.preventDefault();
        controller.setZoom(1);
      } else if (k === '/') {
        e.preventDefault();
        setShortcutsOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          {settingsOpen ? (
            // Settings takes over the whole body (Codex-style): its own left nav replaces the
            // conversation sidebar, rather than nesting a second sidebar inside the content area.
            <Settings controller={controller} onClose={() => setSettingsOpen(false)} />
          ) : (
            <>
              {controller.sidebarOpen && (
                <Sidebar
                  controller={controller}
                  onOpenSettings={() => setSettingsOpen(true)}
                  onCloseSettings={() => setSettingsOpen(false)}
                  onOpenSearch={() => setPaletteOpen(true)}
                  settingsOpen={settingsOpen}
                />
              )}
              <main className="main">
                <ChatView controller={controller} onOpenSettings={() => setSettingsOpen(true)} />
              </main>
              <PreviewPanel controller={controller} />
            </>
          )}
        </div>
        {paletteOpen && (
          <CommandPalette
            controller={controller}
            onClose={() => setPaletteOpen(false)}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}
        {shortcutsOpen && <ShortcutsPanel onClose={() => setShortcutsOpen(false)} />}
        <ContextMenu />
      </div>
    </I18nProvider>
  );
}
