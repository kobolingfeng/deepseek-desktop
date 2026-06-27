import { useEffect, useRef, useState } from 'react';
import { Monitor, Sun, Moon, Folder, Archive, Settings, Pin, FolderMinus, type LucideIcon } from 'lucide-react';
import { useI18n, type Lang, type TFn } from '../lib/i18n';
import { isAgentConv, type Conversation, type Group, type ThemePref } from '../lib/types';
import type { ChatController } from '../lib/useChat';
import { ConfirmDialog } from './ConfirmDialog';
import { MoveToGroupDialog } from './MoveToGroupDialog';

type Section =
  | { kind: 'list'; key: string; label: string; items: Conversation[] }
  | { kind: 'group'; key: string; group: Group; items: Conversation[] };

const THEME_CYCLE: ThemePref[] = ['system', 'light', 'dark'];
const THEME_ICON: Record<ThemePref, LucideIcon> = { system: Monitor, light: Sun, dark: Moon };
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
  onOpenSearch,
  settingsOpen,
}: {
  controller: ChatController;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onOpenSearch: () => void;
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
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [submenuLeft, setSubmenuLeft] = useState(false);
  const userGroups = controller.groups;

  const handleNewChat = () => {
    controller.newConversation(); // reuses an existing empty chat instead of duplicating
    setQuery('');
    onCloseSettings();
  };
  // Ctrl/Cmd+N → new chat (latest handler via ref so the listener mounts once).
  const newChatRef = useRef(handleNewChat);
  newChatRef.current = handleNewChat;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        newChatRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Position the kebab menu with fixed coords so it escapes the sidebar's scroll
  // clipping (lets the submenu fly out to the right like Claude/Codex Desktop).
  const computeMenuPos = (el: HTMLElement) => {
    const W = 200;
    const H = 380;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.right - W, window.innerWidth - W - 8));
    const top = r.bottom + H > window.innerHeight ? Math.max(8, r.top - H) : r.bottom + 4;
    setMenuPos({ top, left });
    // Flip the move-to-group submenu to the left if it would overflow the right edge.
    setSubmenuLeft(left + W + 170 > window.innerWidth);
  };

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

  // Computed every render (the controller re-renders in place via forceRender, so
  // memoizing on the stable conversations array would go stale after in-place edits).
  const sections: Section[] = (() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations;
    // Empty/unsent chats don't appear in the sidebar until the first message (Codex-style).
    const live = filtered.filter((c) => !c.archived && c.messages.length > 0);
    const groupIds = new Set(userGroups.map((g) => g.id));
    const pinned = live.filter((c) => c.pinned).sort(byRecent);
    const rest = live.filter((c) => !c.pinned);

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
  })();

  const q = query.trim().toLowerCase();
  const archivedConvs = conversations
    .filter((c) => c.archived && (!q || c.title.toLowerCase().includes(q)))
    .sort(byRecent);

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
        <span className="group-name"><Folder size={13} strokeWidth={1.9} /> {g.name}</span>
        <span className="group-count">{count}</span>
        <button
          className="conv-kebab"
          title="More"
          onClick={(e) => {
            e.stopPropagation();
            if (groupMenuId === g.id) {
              setGroupMenuId(null);
              return;
            }
            computeMenuPos(e.currentTarget as HTMLElement);
            setGroupMenuId(g.id);
          }}
        >
          ⋮
        </button>
        {groupMenuId === g.id && (
          <div
            className="conv-menu"
            style={menuPos ? { position: 'fixed', top: menuPos.top, left: menuPos.left, right: 'auto' } : undefined}
            onClick={(e) => e.stopPropagation()}
          >
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
        className={`conv-item ${c.id === activeId && !settingsOpen ? 'active' : ''} ${menuId === c.id ? 'menu-open' : ''} ${dragId === c.id ? 'dragging' : ''}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/conv', c.id);
          e.dataTransfer.effectAllowed = 'move';
          // Custom drag label that follows the cursor (instead of the row snapshot).
          const ghost = document.createElement('div');
          ghost.className = 'drag-ghost';
          ghost.textContent = c.title;
          document.body.appendChild(ghost);
          try {
            e.dataTransfer.setDragImage(ghost, 14, 14);
          } catch {
            /* ignore */
          }
          setTimeout(() => ghost.remove(), 0);
          setDragId(c.id);
        }}
        onDragEnd={() => {
          setDragId(null);
          setDropKey(null);
        }}
        onClick={() => {
          controller.selectConversation(c.id);
          onCloseSettings();
        }}
        title={c.title}
      >
        {c.pinned && (
          <span className="conv-ico pin" aria-hidden>
            <Pin size={13} strokeWidth={2} fill="currentColor" />
          </span>
        )}
        <span className="conv-title">{c.title}</span>
        {controller.runningIds.has(c.id) ? (
          <span className="conv-spin" title="Running…" aria-label="running" />
        ) : controller.unreadIds.has(c.id) ? (
          <span className="conv-dot" title="Done — unread" aria-label="unread" />
        ) : null}
        <span className="conv-time">{convTime(c.updatedAt || c.createdAt, lang)}</span>
        <button
          className="conv-kebab"
          title="More"
          onClick={(e) => {
            e.stopPropagation();
            if (menuId === c.id) {
              setMenuId(null);
              return;
            }
            computeMenuPos(e.currentTarget as HTMLElement);
            setMenuId(c.id);
          }}
        >
          ⋮
        </button>
        {menuId === c.id && (
          <div
            className="conv-menu"
            style={menuPos ? { position: 'fixed', top: menuPos.top, left: menuPos.left, right: 'auto' } : undefined}
            onClick={(e) => e.stopPropagation()}
          >
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
                controller.toggleArchive(c.id);
                setMenuId(null);
              }}
            >
              {c.archived ? t('unarchive') : t('archive')}
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
            {isAgentConv(c) && (
              <>
                <button
                  onClick={() => {
                    controller.setConvCwd(c.id);
                    setMenuId(null);
                  }}
                >
                  {t('convSetCwd')}
                </button>
                <button
                  onClick={() => {
                    controller.copyWorkingDir(c.id);
                    setMenuId(null);
                  }}
                >
                  {t('convCopyCwd')}
                </button>
                <button
                  onClick={() => {
                    controller.openWorkingDir(c.id);
                    setMenuId(null);
                  }}
                >
                  {t('convOpenDir')}
                </button>
              </>
            )}
            <div className="conv-subitem">
              <button className="conv-sub-parent">
                <span>{t('moveToGroup')}</span>
                <span className="sub-caret" aria-hidden>
                  {submenuLeft ? '◂' : '▸'}
                </span>
              </button>
              <div className={`conv-submenu ${submenuLeft ? 'flip-left' : ''}`}>
                {controller.groups.map((g) => (
                  <button
                    key={g.id}
                    className={c.groupId === g.id ? 'active' : ''}
                    onClick={() => {
                      controller.moveToGroup(c.id, g.id);
                      setMenuId(null);
                    }}
                  >
                    <Folder size={14} strokeWidth={1.9} /> {g.name}
                  </button>
                ))}
                {c.groupId && (
                  <button
                    onClick={() => {
                      controller.moveToGroup(c.id, null);
                      setMenuId(null);
                    }}
                  >
                    <FolderMinus size={14} strokeWidth={1.9} /> {t('removeFromGroup')}
                  </button>
                )}
                <button
                  className="conv-submenu-new"
                  onClick={() => {
                    setMoveId(c.id);
                    setMenuId(null);
                  }}
                >
                  ＋ {t('newGroup')}…
                </button>
              </div>
            </div>
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
      <nav className="sidebar-menu">
        <button className="sidebar-menu-item" onClick={handleNewChat}>
          <svg className="smi-ico" viewBox="0 0 24 24" width="16" height="16" aria-hidden>
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"
            />
          </svg>
          <span className="smi-label">{t('newChat')}</span>
          <kbd className="smi-kbd">Ctrl+N</kbd>
        </button>
        <button className="sidebar-menu-item" onClick={onOpenSearch}>
          <svg className="smi-ico" viewBox="0 0 24 24" width="16" height="16" aria-hidden>
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M20 20l-3.6-3.6"
            />
          </svg>
          <span className="smi-label">{t('search')}</span>
          <kbd className="smi-kbd">Ctrl+K</kbd>
        </button>
      </nav>

      <div className="conv-list">
        {conversations.length === 0 && <div className="conv-empty">{t('noConversations')}</div>}
        {conversations.length > 0 && sections.length === 0 && <div className="conv-empty">{t('noMatches')}</div>}
        {sections.map((s) => {
          // group → move into it; date section → ungroup (null); pinned → not a target.
          const target: string | null | undefined =
            s.kind === 'group' ? s.group.id : s.key.startsWith('d-') ? null : undefined;
          const droppable = target !== undefined && !!dragId;
          const handlers = droppable
            ? {
                onDragOver: (e: React.DragEvent) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dropKey !== s.key) setDropKey(s.key);
                },
                onDrop: (e: React.DragEvent) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData('text/conv') || dragId;
                  setDropKey(null);
                  setDragId(null);
                  if (id) controller.moveToGroup(id, target as string | null);
                },
              }
            : {};
          const cls = `conv-group ${droppable && dropKey === s.key ? 'drop-target' : ''}`;
          return s.kind === 'list' ? (
            <div key={s.key} className={cls} {...handlers}>
              <div className="conv-section-label">{s.label}</div>
              {s.items.map(renderItem)}
            </div>
          ) : (
            <div key={s.key} className={cls} {...handlers}>
              {renderGroupHeader(s.group, s.items.length)}
              {!s.group.collapsed && s.items.map(renderItem)}
              {!s.group.collapsed && s.items.length === 0 && <div className="conv-group-empty">{t('groupEmpty')}</div>}
            </div>
          );
        })}

        {archivedConvs.length > 0 && (
          <div className="conv-group">
            <div className="conv-group-head" onClick={() => setArchivedOpen((o) => !o)}>
              <span className={`group-caret ${archivedOpen ? '' : 'collapsed'}`} aria-hidden>
                ▾
              </span>
              <span className="group-name"><Archive size={13} strokeWidth={1.9} /> {t('groupArchived')}</span>
              <span className="group-count">{archivedConvs.length}</span>
            </div>
            {archivedOpen && archivedConvs.map(renderItem)}
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <button className={`settings-btn ${settingsOpen ? 'active' : ''}`} onClick={onOpenSettings}>
          <Settings size={15} strokeWidth={1.9} /> {t('settings')}
        </button>
        <button className="icon-btn" onClick={cycleTheme} title={t('themeLabel')}>
          {(() => {
            const I = THEME_ICON[settings.theme];
            return <I size={16} strokeWidth={1.9} />;
          })()}
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
