import { useI18n } from '../lib/i18n';
import type { ThemePref } from '../lib/types';
import type { ChatController } from '../lib/useChat';

const THEME_CYCLE: ThemePref[] = ['system', 'light', 'dark'];
const THEME_ICON: Record<ThemePref, string> = { system: '🖥', light: '☀', dark: '🌙' };

export function Sidebar({
  controller,
  onOpenSettings,
  onCloseSettings,
  settingsOpen,
}: {
  controller: ChatController;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  settingsOpen: boolean;
}) {
  const { t } = useI18n();
  const { conversations, activeId, settings } = controller;

  const cycleTheme = () => {
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(settings.theme) + 1) % THEME_CYCLE.length];
    controller.updateSettings({ theme: next });
  };

  return (
    <aside className="sidebar">
      <button
        className="new-chat"
        onClick={() => {
          controller.newConversation();
          onCloseSettings();
        }}
      >
        <span className="plus">＋</span> {t('newChat')}
      </button>

      <div className="conv-section-label">{t('conversations')}</div>

      <div className="conv-list">
        {conversations.length === 0 && <div className="conv-empty">{t('noConversations')}</div>}
        {conversations.map((c) => (
          <div
            key={c.id}
            className={`conv-item ${c.id === activeId && !settingsOpen ? 'active' : ''}`}
            onClick={() => {
              controller.selectConversation(c.id);
              onCloseSettings();
            }}
            title={c.title}
          >
            <span className="conv-title">{c.title}</span>
            <button
              className="conv-del"
              title={t('delete')}
              onClick={(e) => {
                e.stopPropagation();
                controller.deleteConversation(c.id);
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <button className={`settings-btn ${settingsOpen ? 'active' : ''}`} onClick={onOpenSettings}>
          ⚙ {t('settings')}
        </button>
        <button className="icon-btn" onClick={cycleTheme} title={t('themeLabel')}>
          {THEME_ICON[settings.theme]}
        </button>
      </div>
    </aside>
  );
}
