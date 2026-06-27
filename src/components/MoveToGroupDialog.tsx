import { useState } from 'react';
import { Folder, FolderMinus } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import type { Conversation } from '../lib/types';
import type { ChatController } from '../lib/useChat';

export function MoveToGroupDialog({
  controller,
  conv,
  onClose,
}: {
  controller: ChatController;
  conv: Conversation;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [newName, setNewName] = useState('');

  const move = (gid: string | null) => {
    controller.moveToGroup(conv.id, gid);
    onClose();
  };
  const createAndMove = () => {
    const name = newName.trim();
    if (!name) return;
    const id = controller.createGroup(name);
    controller.moveToGroup(conv.id, id);
    onClose();
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">{t('moveToGroup')}</div>
        <div className="dialog-list">
          {conv.groupId && (
            <button className="dialog-list-btn" onClick={() => move(null)}>
              <FolderMinus size={14} strokeWidth={1.9} /> {t('removeFromGroup')}
            </button>
          )}
          {controller.groups.map((g) => (
            <button
              key={g.id}
              className={`dialog-list-btn ${conv.groupId === g.id ? 'active' : ''}`}
              onClick={() => move(g.id)}
            >
              <Folder size={14} strokeWidth={1.9} /> {g.name}
            </button>
          ))}
          {controller.groups.length === 0 && <div className="dialog-msg">{t('noGroups')}</div>}
        </div>
        <div className="dialog-newgroup">
          <input
            value={newName}
            placeholder={t('groupNamePh')}
            autoFocus
            spellCheck={false}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createAndMove();
              if (e.key === 'Escape') onClose();
            }}
          />
          <button className="btn-approve" disabled={!newName.trim()} onClick={createAndMove}>
            {t('newGroup')}
          </button>
        </div>
      </div>
    </div>
  );
}
