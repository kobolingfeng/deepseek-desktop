import { useEffect, useState } from 'react';
import { ChatView } from './components/ChatView';
import { ContextMenu } from './components/ContextMenu';
import { Settings } from './components/Settings';
import { Sidebar } from './components/Sidebar';
import { TitleBar } from './components/TitleBar';
import { useChat } from './lib/useChat';
import { I18nProvider, detectLang } from './lib/i18n';
import { os } from './api';

export function App() {
  const controller = useChat();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const themePref = controller.settings.theme;

  // Apply colour theme: follow Windows when "system", otherwise force.
  useEffect(() => {
    if (themePref !== 'system') {
      document.documentElement.dataset.theme = themePref;
      return;
    }
    const apply = (t: { dark: boolean }) => {
      document.documentElement.dataset.theme = t.dark ? 'dark' : 'light';
    };
    os.theme().then(apply).catch(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    return os.onThemeChanged(apply);
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

  return (
    <I18nProvider
      lang={controller.settings.language}
      setLang={(l) => controller.updateSettings({ language: l })}
    >
      <div className="app">
        <TitleBar controller={controller} />
        <div className="body">
          <Sidebar
            controller={controller}
            onOpenSettings={() => setSettingsOpen(true)}
            onCloseSettings={() => setSettingsOpen(false)}
            settingsOpen={settingsOpen}
          />
          <main className="main">
            {settingsOpen ? (
              <Settings controller={controller} onClose={() => setSettingsOpen(false)} />
            ) : (
              <ChatView controller={controller} onOpenSettings={() => setSettingsOpen(true)} />
            )}
          </main>
        </div>
        <ContextMenu />
      </div>
    </I18nProvider>
  );
}
