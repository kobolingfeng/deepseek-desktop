import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';
import type { ChatController } from '../lib/useChat';

// Codex-style command palette: fuzzy-search chats + run quick commands.
export function CommandPalette({
  controller,
  onClose,
  onOpenSettings,
}: {
  controller: ChatController;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const groupName = (id?: string) => controller.groups.find((g) => g.id === id)?.name;

  const chats = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return controller.conversations
      .filter((c) => !c.archived)
      .filter(
        (c) =>
          !ql ||
          c.title.toLowerCase().includes(ql) ||
          (groupName(c.groupId) || '').toLowerCase().includes(ql),
      )
      .slice(0, 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, controller.conversations, controller.groups]);

  const commands = useMemo(() => {
    const all = [
      { id: 'new', icon: '✎', label: t('newChat'), kbd: 'Ctrl+N', run: () => controller.newConversation() },
      { id: 'folder', icon: '📂', label: t('cmdOpenFolder'), kbd: 'Ctrl+O', run: () => controller.openWorkingDir() },
      { id: 'settings', icon: '⚙', label: t('settings'), kbd: 'Ctrl+,', run: onOpenSettings },
    ];
    const ql = q.trim().toLowerCase();
    return ql ? all.filter((c) => c.label.toLowerCase().includes(ql)) : all;
  }, [q, t, controller, onOpenSettings]);

  const total = chats.length + commands.length;
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, total - 1)));
  }, [total]);

  const choose = (i: number) => {
    if (i < chats.length) {
      const c = chats[i];
      if (c) controller.selectConversation(c.id);
    } else {
      commands[i - chats.length]?.run();
    }
    onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return onClose();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      return setActive((a) => Math.min(a + 1, total - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      return setActive((a) => Math.max(a - 1, 0));
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      return choose(active);
    }
    if (e.ctrlKey || e.metaKey) {
      if (e.key >= '1' && e.key <= '9') {
        const i = Number(e.key) - 1;
        if (chats[i]) {
          e.preventDefault();
          controller.selectConversation(chats[i].id);
          onClose();
        }
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'n') return (e.preventDefault(), controller.newConversation(), onClose());
      if (k === 'o') return (e.preventDefault(), controller.openWorkingDir(), onClose());
      if (e.key === ',') return (e.preventDefault(), onOpenSettings(), onClose());
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <input
          ref={inputRef}
          className="cmd-input"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          placeholder={t('palettePlaceholder')}
          spellCheck={false}
        />
        <div className="cmd-list">
          {chats.length > 0 && <div className="cmd-section">{t('paletteChats')}</div>}
          {chats.map((c, i) => {
            const g = groupName(c.groupId);
            return (
              <button
                key={c.id}
                className={`cmd-row ${active === i ? 'active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
              >
                <span className="cmd-row-label">{c.title}</span>
                {g && <span className="cmd-row-meta">{g}</span>}
                {i < 9 && <kbd className="cmd-kbd">Ctrl+{i + 1}</kbd>}
              </button>
            );
          })}
          {commands.length > 0 && <div className="cmd-section">{t('paletteSuggested')}</div>}
          {commands.map((cmd, i) => {
            const idx = chats.length + i;
            return (
              <button
                key={cmd.id}
                className={`cmd-row ${active === idx ? 'active' : ''}`}
                onMouseEnter={() => setActive(idx)}
                onClick={() => choose(idx)}
              >
                <span className="cmd-row-ico">{cmd.icon}</span>
                <span className="cmd-row-label">{cmd.label}</span>
                <kbd className="cmd-kbd">{cmd.kbd}</kbd>
              </button>
            );
          })}
          {total === 0 && <div className="cmd-empty">{t('noMatches')}</div>}
        </div>
      </div>
    </div>
  );
}
