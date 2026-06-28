import { useEffect, useRef, useState } from 'react';
import { Monitor, Sun, Moon, Folder, Archive, Settings, Pin, FolderMinus, ChevronRight, SquarePen, type LucideIcon } from 'lucide-react';
import { clipboard, shell } from '../api';
import { useI18n, type Lang, type TFn } from '../lib/i18n';
import { isAgentConv, type Conversation, type Group, type ThemePref } from '../lib/types';
import type { ChatController } from '../lib/useChat';
import { ConfirmDialog } from './ConfirmDialog';
import { MoveToGroupDialog } from './MoveToGroupDialog';

type Section =
  | { kind: 'list'; key: string; label: string; items: Conversation[] }
  | { kind: 'group'; key: string; group: Group; items: Conversation[] }
  | { kind: 'projects'; key: string; projects: { cwd: string; name: string; items: Conversation[] }[] };

// Folder name from a working-directory path (basename), for the Projects grouping.
function projName(cwd: string): string {
  return cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || cwd;
}

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
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [submenuLeft, setSubmenuLeft] = useState(false);
  const userGroups = controller.groups;
  // Per-project (working-dir) collapse state, persisted across restarts.
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem('deepseek.projectCollapsed') || '[]'));
    } catch {
      return new Set<string>();
    }
  });
  const [projMenuCwd, setProjMenuCwd] = useState<string | null>(null);
  // Top-level section collapse (Projects / Chats / Pinned), persisted.
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem('deepseek.sectionCollapsed') || '[]'));
    } catch {
      return new Set<string>();
    }
  });
  const toggleSection = (key: string) =>
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem('deepseek.sectionCollapsed', JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  const toggleProject = (cwd: string) =>
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(cwd)) next.delete(cwd);
      else next.add(cwd);
      try {
        localStorage.setItem('deepseek.projectCollapsed', JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });

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
    const H = 380;
    const r = el.getBoundingClientRect();
    // Right-align the menu to the kebab button (its top-right sits at the dots) regardless
    // of menu width, instead of guessing a width and drifting left.
    const right = Math.max(8, window.innerWidth - r.right);
    const top = r.bottom + H > window.innerHeight ? Math.max(8, r.top - H) : r.bottom + 4;
    setMenuPos({ top, right });
  };

  useEffect(() => {
    if (!menuId && !groupMenuId && !projMenuCwd) return;
    const h = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.conv-menu, .conv-kebab, .proj-act')) {
        setMenuId(null);
        setGroupMenuId(null);
        setProjMenuCwd(null);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuId, groupMenuId, projMenuCwd]);

  // Computed every render (the controller re-renders in place via forceRender, so
  // memoizing on the stable conversations array would go stale after in-place edits).
  const sections: Section[] = (() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations;
    // Empty/unsent chats don't appear in the sidebar until the first message (Codex-style).
    const live = filtered.filter((c) => !c.archived && c.messages.length > 0);
    const pinned = live.filter((c) => c.pinned).sort(byRecent);
    const rest = live.filter((c) => !c.pinned);

    const out: Section[] = [];
    if (pinned.length) out.push({ kind: 'list', key: 'pinned', label: t('groupPinned'), items: pinned });

    // Codex-style auto-grouping: conversations WITH a working directory become "Projects"
    // (grouped by that directory); conversations WITHOUT one are flat "Chats".
    const byCwd = new Map<string, Conversation[]>();
    for (const c of rest) {
      if (!c.cwd) continue;
      const arr = byCwd.get(c.cwd) ?? [];
      arr.push(c);
      byCwd.set(c.cwd, arr);
    }
    const projects = [...byCwd.entries()]
      .map(([cwd, items]) => ({ cwd, name: projName(cwd), items: items.sort(byRecent) }))
      .sort((a, b) => (b.items[0]?.updatedAt || 0) - (a.items[0]?.updatedAt || 0));
    if (projects.length) out.push({ kind: 'projects', key: 'projects', projects });

    const chats = rest.filter((c) => !c.cwd).sort(byRecent);
    if (chats.length) out.push({ kind: 'list', key: 'chats', label: t('groupChats'), items: chats });
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
            style={menuPos ? { position: 'fixed', top: menuPos.top, right: menuPos.right, left: 'auto' } : undefined}
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
        className={`conv-item ${c.id === activeId && !settingsOpen ? 'active' : ''} ${menuId === c.id ? 'menu-open' : ''}`}
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
        <span
          className="conv-title"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setRenameId(c.id);
            setRenameText(c.title);
          }}
        >
          {c.title}
        </span>
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
            style={menuPos ? { position: 'fixed', top: menuPos.top, right: menuPos.right, left: 'auto' } : undefined}
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
          const secCollapsed = collapsedSections.has(s.key);
          const label = s.kind === 'projects' ? t('groupProjects') : s.kind === 'list' ? s.label : '';
          return (
            <div key={s.key} className="conv-group">
              <div className="conv-section-label sec-head" onClick={() => toggleSection(s.key)}>
                <span>{label}</span>
                <span className={`proj-caret ${secCollapsed ? '' : 'open'}`} aria-hidden>
                  <ChevronRight size={12} strokeWidth={2.2} />
                </span>
              </div>
              {!secCollapsed &&
                (s.kind === 'projects'
                  ? s.projects.map((p) => {
                const collapsed = collapsedProjects.has(p.cwd);
                return (
                  <div key={p.cwd} className="conv-project">
                    <div
                      className={`conv-project-head ${projMenuCwd === p.cwd ? 'menu-open' : ''}`}
                      title={p.cwd}
                      onClick={() => toggleProject(p.cwd)}
                    >
                      <Folder size={13} strokeWidth={1.9} />
                      <span className="conv-project-name">{p.name}</span>
                      <span className={`proj-caret ${collapsed ? '' : 'open'}`} aria-hidden>
                        <ChevronRight size={13} strokeWidth={2} />
                      </span>
                      <button
                        className="proj-act proj-act-lead"
                        title={t('newChatHere')}
                        aria-label={t('newChatHere')}
                        onClick={(e) => {
                          e.stopPropagation();
                          controller.newConversationInDir(p.cwd);
                          onCloseSettings();
                        }}
                      >
                        <SquarePen size={14} strokeWidth={1.8} />
                      </button>
                      <button
                        className="proj-act"
                        title="More"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (projMenuCwd === p.cwd) {
                            setProjMenuCwd(null);
                            return;
                          }
                          computeMenuPos(e.currentTarget as HTMLElement);
                          setProjMenuCwd(p.cwd);
                        }}
                      >
                        ⋮
                      </button>
                      {projMenuCwd === p.cwd && (
                        <div
                          className="conv-menu"
                          style={menuPos ? { position: 'fixed', top: menuPos.top, right: menuPos.right, left: 'auto' } : undefined}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => {
                              controller.newConversationInDir(p.cwd);
                              setProjMenuCwd(null);
                              onCloseSettings();
                            }}
                          >
                            <SquarePen size={14} strokeWidth={1.8} /> {t('newChatHere')}
                          </button>
                          <button
                            onClick={() => {
                              shell.open(p.cwd).catch(() => {});
                              setProjMenuCwd(null);
                            }}
                          >
                            <Folder size={14} strokeWidth={1.9} /> {t('convOpenDir')}
                          </button>
                          <button
                            onClick={() => {
                              clipboard.writeText(p.cwd).catch(() => {});
                              setProjMenuCwd(null);
                            }}
                          >
                            {t('convCopyCwd')}
                          </button>
                        </div>
                      )}
                    </div>
                    {!collapsed && p.items.map(renderItem)}
                  </div>
                );
                    })
                  : s.items.map(renderItem))}
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
