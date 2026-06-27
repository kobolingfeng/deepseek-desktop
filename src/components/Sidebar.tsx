import { useEffect, useMemo, useState } from 'react';
import { useI18n, type Lang, type TFn } from '../lib/i18n';
import type { Conversation, Group, ThemePref } from '../lib/types';
import type { ChatController } from '../lib/useChat';
import { ConfirmDialog } from './ConfirmDialog';
import { MoveToGroupDialog } from './MoveToGroupDialog';

type Section =
  | { kind: 'list'; key: string; label: string; items: Conversation[] }
  | { kind: 'group'; key: string; group: Group; items: Conversation[] };

const THEME_CYCLE: ThemePref[] = ['system', 'light', 'dark'];
const THEME_ICON: Record<ThemePref, string> = { system: '🖥', light: '☀', dark: '🌙' };
const DAY = 86400000;
const MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function startOfDayTs(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

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

const byRecent = (a: Conversation, b: Conversation) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt);

function dateGroups(convs: Conversation[], t: TFn): { label: string; items: Conversation[] }[] {
  const today = startOfDayTs(Date.now());
  const buckets: Record<string, Conversation[]> = { today: [], yesterday: [], week: [], older: [] };
  for (const c of [...convs].sort(byRecent)) {
    const d = startOfDayTs(c.updatedAt || c.createdAt);
    if (d >= today) buckets.today.push(c);
    else if (d >= today - DAY) buckets.yesterday.push(c);
    else if (d >= today - 6 * DAY) buckets.week.push(c);
    else buckets.older.push(c);
  }
  return (
    [
      ['today', 'groupToday'],
      ['yesterday', 'groupYesterday'],
      ['week', 'groupWeek'],
      ['older', 'groupOlder'],
    ] as [string, string][]
  )
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
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);
  const [groupMenuId, setGroupMenuId] = useState<string | null>(null);
  const [groupRenameId, setGroupRenameId] = useState<string | null>(null);
  const [groupRenameText, setGroupRenameText] = useState('');
  const userGroups = controller.groups;

  useEffect(() => {
    if (!menuId && !groupMenuId) return;
    const h = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.conv-menu, .conv-kebab')) {
        setMenuId(null);
        setGroupMenuId(null);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuId, groupMenuId]);

  const sections = useMemo<Section[]>(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations;
    const groupIds = new Set(userGroups.map((g) => g.id));
    const pinned = filtered.filter((c) => c.pinned).sort(byRecent);
    const rest = filtered.filter((c) => !c.pinned);

    const out: Section[] = [];
    if (pinned.length) out.push({ kind: 'list', key: 'pinned', label: t('groupPinned'), items: pinned });

    for (const g of userGroups) {
      const items = rest.filter((c) => c.groupId === g.id).sort(byRecent);
      // While searching, hide groups with no matches; otherwise show all (even empty).
      if (q && !items.length) continue;
      out.push({ kind: 'group', key: 'g-' + g.id, group: g, items });
    }

    const ungrouped = rest.filter((c) => !c.groupId || !groupIds.has(c.groupId));
    for (const d of dateGroups(ungrouped, t)) out.push({ kind: 'list', key: 'd-' + d.label, label: d.label, items: d.items });
    return out;
  }, [conversations, userGroups, query, t]);

  const cycleTheme = () => {
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(settings.theme) + 1) % THEME_CYCLE.length];
    controller.updateSettings({ theme: next });
  };

  const commitRename = () => {
    if (renameId) controller.renameConversation(renameId, renameText);
    setRenameId(null);
  };

  const commitGroupRename = () => {
    if (groupRenameId) controller.renameGroup(groupRenameId, groupRenameText);
    setGroupRenameId(null);
  };

  const renderGroupHeader = (g: Group, count: number) => {
    if (groupRenameId === g.id) {
      return (
        <div className="conv-group-head renaming">
          <input
            className="conv-rename"
            value={groupRenameText}
            autoFocus
            onChange={(e) => setGroupRenameText(e.target.value)}
            onBlur={commitGroupRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitGroupRename();
              if (e.key === 'Escape') setGroupRenameId(null);
            }}
          />
        </div>
      );
    }
    return (
      <div
        className={`conv-group-head ${groupMenuId === g.id ? 'menu-open' : ''}`}
        onClick={() => controller.toggleGroupCollapsed(g.id)}
      >
        <span className={`group-caret ${g.collapsed ? 'collapsed' : ''}`} aria-hidden>
          ▾
        </span>
        <span className="group-name">📁 {g.name}</span>
        <span className="group-count">{count}</span>
        <button
          className="conv-kebab"
          title="More"
          onClick={(e) => {
            e.stopPropagation();
            setGroupMenuId(groupMenuId === g.id ? null : g.id);
          }}
        >
          ⋮
        </button>
        {groupMenuId === g.id && (
          <div className="conv-menu" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => {
                setGroupRenameId(g.id);
                setGroupRenameText(g.name);
                setGroupMenuId(null);
              }}
            >
              {t('rename')}
            </button>
            <button
              className="danger"
              onClick={() => {
                controller.deleteGroup(g.id);
                setGroupMenuId(null);
              }}
            >
              {t('deleteGroup')}
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderItem = (c: Conversation) => {
    if (renameId === c.id) {
      return (
        <div key={c.id} className="conv-item renaming">
          <input
            className="conv-rename"
            value={renameText}
            autoFocus
            onChange={(e) => setRenameText(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setRenameId(null);
            }}
          />
        </div>
      );
    }
    return (
      <div
        key={c.id}
        className={`conv-item ${c.id === activeId && !settingsOpen ? 'active' : ''} ${menuId === c.id ? 'menu-open' : ''}`}
        onClick={() => {
          controller.selectConversation(c.id);
          onCloseSettings();
        }}
        title={c.title}
      >
        {c.pinned ? (
          <span className="conv-ico pin" aria-hidden>
            ★
          </span>
        ) : (
          <svg className="conv-ico" viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
              d="M2.5 3.5h11v7h-6l-3 2.2v-2.2h-2z"
            />
          </svg>
        )}
        <span className="conv-title">{c.title}</span>
        <span className="conv-time">{convTime(c.updatedAt || c.createdAt, lang)}</span>
        <button
          className="conv-kebab"
          title="More"
          onClick={(e) => {
            e.stopPropagation();
            setMenuId(menuId === c.id ? null : c.id);
          }}
        >
          ⋮
        </button>
        {menuId === c.id && (
          <div className="conv-menu" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => {
                setRenameId(c.id);
                setRenameText(c.title);
                setMenuId(null);
              }}
            >
              {t('rename')}
            </button>
            <button
              onClick={() => {
                controller.togglePin(c.id);
                setMenuId(null);
              }}
            >
              {c.pinned ? t('unpin') : t('pin')}
            </button>
            <button
              onClick={() => {
                controller.duplicateConversation(c.id);
                setMenuId(null);
                onCloseSettings();
              }}
            >
              {t('duplicate')}
            </button>
            <button
              onClick={() => {
                controller.exportConversation(c.id);
                setMenuId(null);
              }}
            >
              {t('exportChat')}
            </button>
            <button
              onClick={() => {
                setMoveId(c.id);
                setMenuId(null);
              }}
            >
              {t('moveToGroup')}
            </button>
            <button
              className="danger"
              onClick={() => {
                setConfirmId(c.id);
                setMenuId(null);
              }}
            >
              {t('delete')}
            </button>
          </div>
        )}
      </div>
    );
  };

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
        {conversations.length > 0 && sections.length === 0 && <div className="conv-empty">{t('noMatches')}</div>}
        {sections.map((s) =>
          s.kind === 'list' ? (
            <div key={s.key} className="conv-group">
              <div className="conv-section-label">{s.label}</div>
              {s.items.map(renderItem)}
            </div>
          ) : (
            <div key={s.key} className="conv-group">
              {renderGroupHeader(s.group, s.items.length)}
              {!s.group.collapsed && s.items.map(renderItem)}
              {!s.group.collapsed && s.items.length === 0 && <div className="conv-group-empty">{t('groupEmpty')}</div>}
            </div>
          ),
        )}
      </div>

      <div className="sidebar-footer">
        <button className={`settings-btn ${settingsOpen ? 'active' : ''}`} onClick={onOpenSettings}>
          ⚙ {t('settings')}
        </button>
        <button className="icon-btn" onClick={cycleTheme} title={t('themeLabel')}>
          {THEME_ICON[settings.theme]}
        </button>
      </div>

      {confirmId && (
        <ConfirmDialog
          title={t('deleteChatTitle')}
          message={t('deleteChatMsg')}
          confirmLabel={t('delete')}
          danger
          onConfirm={() => {
            controller.deleteConversation(confirmId);
            setConfirmId(null);
          }}
          onCancel={() => setConfirmId(null)}
        />
      )}
      {moveId &&
        (() => {
          const conv = conversations.find((c) => c.id === moveId);
          return conv ? (
            <MoveToGroupDialog controller={controller} conv={conv} onClose={() => setMoveId(null)} />
          ) : null;
        })()}
    </aside>
  );
}
