import { useMemo, useState } from 'react';
import { useI18n, type Lang, type TFn } from '../lib/i18n';
import type { Conversation, ThemePref } from '../lib/types';
import type { ChatController } from '../lib/useChat';

const THEME_CYCLE: ThemePref[] = ['system', 'light', 'dark'];
const THEME_ICON: Record<ThemePref, string> = { system: '🖥', light: '☀', dark: '🌙' };
const DAY = 86400000;
const MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function startOfDayTs(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Sidebar timestamp: today → clock, yesterday → label, older → date. */
function convTime(ts: number, lang: Lang): string {
  const today = startOfDayTs(Date.now());
  const ds = startOfDayTs(ts);
  const d = new Date(ts);
  if (ds >= today) {
    const h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    if (lang === 'zh') return `${String(h).padStart(2, '0')}:${m}`;
    const ap = h < 12 ? 'AM' : 'PM';
    return `${h % 12 || 12}:${m} ${ap}`;
  }
  if (ds >= today - DAY) return lang === 'zh' ? '昨天' : 'Yesterday';
  return lang === 'zh' ? `${d.getMonth() + 1}月${d.getDate()}日` : `${MON_EN[d.getMonth()]} ${d.getDate()}`;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function groupConversations(convs: Conversation[], t: TFn): { label: string; items: Conversation[] }[] {
  const today = startOfDay(Date.now());
  const buckets: Record<string, Conversation[]> = { today: [], yesterday: [], week: [], older: [] };
  const sorted = [...convs].sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  for (const c of sorted) {
    const d = startOfDay(c.updatedAt || c.createdAt);
    if (d >= today) buckets.today.push(c);
    else if (d >= today - DAY) buckets.yesterday.push(c);
    else if (d >= today - 6 * DAY) buckets.week.push(c);
    else buckets.older.push(c);
  }
  const order: [string, string][] = [
    ['today', 'groupToday'],
    ['yesterday', 'groupYesterday'],
    ['week', 'groupWeek'],
    ['older', 'groupOlder'],
  ];
  return order
    .filter(([k]) => buckets[k].length)
    .map(([k, key]) => ({ label: t(key), items: buckets[k] }));
}

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
  const { t, lang } = useI18n();
  const { conversations, activeId, settings } = controller;
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations;
    return groupConversations(filtered, t);
  }, [conversations, query, t]);

  const cycleTheme = () => {
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(settings.theme) + 1) % THEME_CYCLE.length];
    controller.updateSettings({ theme: next });
  };

  const renderItem = (c: Conversation) => (
    <div
      key={c.id}
      className={`conv-item ${c.id === activeId && !settingsOpen ? 'active' : ''}`}
      onClick={() => {
        controller.selectConversation(c.id);
        onCloseSettings();
      }}
      title={c.title}
    >
      <svg className="conv-ico" viewBox="0 0 16 16" width="14" height="14" aria-hidden>
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
          d="M2.5 3.5h11v7h-6l-3 2.2v-2.2h-2z"
        />
      </svg>
      <span className="conv-title">{c.title}</span>
      <span className="conv-time">{convTime(c.updatedAt || c.createdAt, lang)}</span>
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
  );

  return (
    <aside className="sidebar">
      <button
        className="new-chat"
        onClick={() => {
          controller.newConversation();
          setQuery('');
          onCloseSettings();
        }}
      >
        <span className="plus">＋</span> {t('newChat')}
      </button>

      <div className="sidebar-search">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
          <path
            fill="currentColor"
            d="M7 2a5 5 0 0 1 3.94 8.06l3 3-1.06 1.06-3-3A5 5 0 1 1 7 2m0 1.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7"
          />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          spellCheck={false}
        />
        {query && (
          <button className="search-clear" onClick={() => setQuery('')} title="Clear">
            ✕
          </button>
        )}
      </div>

      <div className="conv-list">
        {conversations.length === 0 && <div className="conv-empty">{t('noConversations')}</div>}
        {conversations.length > 0 && groups.length === 0 && (
          <div className="conv-empty">{t('noMatches')}</div>
        )}
        {groups.map((g) => (
          <div key={g.label} className="conv-group">
            <div className="conv-section-label">{g.label}</div>
            {g.items.map(renderItem)}
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
