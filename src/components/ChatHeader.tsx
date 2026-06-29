import { useState, type MouseEvent } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { showContextMenu } from '../lib/contextMenu';
import type { ChatController } from '../lib/useChat';

// The content-area top bar. It spans the whole content region (chat + right panel) so the
// sidebar/panel toggles and the ⋯ menu do NOT drift when the right panel opens/closes — they
// only shift with the left sidebar, which is expected.
export function ChatHeader({ controller }: { controller: ChatController }) {
  const { t } = useI18n();
  const c = controller.activeConversation;
  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState('');

  const startRename = () => {
    if (!c) return;
    setRenameText(c.title);
    setRenaming(true);
  };
  const commitRename = () => {
    if (c && renameText.trim()) controller.renameConversation(c.id, renameText.trim());
    setRenaming(false);
  };
  const openMenu = (e: MouseEvent<HTMLButtonElement>) => {
    if (!c) return;
    const r = e.currentTarget.getBoundingClientRect();
    showContextMenu(r.right, r.bottom + 4, [
      { label: t('rename'), onClick: startRename },
      { label: c.pinned ? t('unpin') : t('pin'), onClick: () => controller.togglePin(c.id) },
      { label: c.archived ? t('unarchive') : t('archive'), onClick: () => controller.toggleArchive(c.id) },
      { label: t('duplicate'), onClick: () => controller.duplicateConversation(c.id) },
      ...(c.cwd ? [{ label: t('ctxOpenFolder'), onClick: () => controller.openWorkingDir(c.id) }] : []),
      { label: t('delete'), danger: true, onClick: () => controller.deleteConversation(c.id) },
    ]);
  };

  return (
    <div className="chat-header">
      {renaming ? (
        <input
          className="chat-htitle-input"
          autoFocus
          value={renameText}
          onChange={(e) => setRenameText(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            else if (e.key === 'Escape') setRenaming(false);
          }}
        />
      ) : (
        <span className="chat-htitle" title={c?.title || ''} onDoubleClick={startRename}>
          {c?.title || t('newChat')}
        </span>
      )}
      {c && (
        <button className="chat-hbtn" onClick={openMenu} title={t('more')} aria-label={t('more')}>
          <MoreHorizontal size={17} strokeWidth={1.9} />
        </button>
      )}
      <button
        className={`chat-hbtn ${controller.panelOpen ? 'active' : ''}`}
        onClick={controller.togglePanel}
        title={t('panelToggle')}
        aria-label={t('panelToggle')}
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <line x1="10" y1="2.5" x2="10" y2="13.5" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>
    </div>
  );
}
