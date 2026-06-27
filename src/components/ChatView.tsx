import { useLayoutEffect, useRef } from 'react';
import { Composer } from './Composer';
import { Message } from './Message';
import { useI18n } from '../lib/i18n';
import type { ChatController } from '../lib/useChat';
import type { Message as Msg } from '../lib/types';

export function ChatView({
  controller,
  onOpenSettings,
}: {
  controller: ChatController;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  const { activeConversation, generating, pendingApproval, settings } = controller;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  });

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const messages = activeConversation?.messages ?? [];
  const toolResults = new Map<string, Msg>();
  for (const m of messages) if (m.role === 'tool' && m.toolCallId) toolResults.set(m.toolCallId, m);

  const visible = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  const isEmpty = visible.length === 0;
  const suggestions = ['suggestion1', 'suggestion2', 'suggestion3', 'suggestion4'].map((k) => t(k));
  const approvalAction = pendingApproval ? t('tool_' + pendingApproval.toolCall.name) : '';

  return (
    <div className="chat">
      {!settings.apiKey && (
        <div className="apikey-banner" onClick={onOpenSettings}>
          🔑 {t('apiKeyBanner')}
        </div>
      )}

      <div className="messages" ref={scrollerRef} onScroll={onScroll}>
        {isEmpty ? (
          <div className="welcome">
            <div className="welcome-logo">🐋</div>
            <h1>{t('welcomeGreeting')}</h1>
            <p>{t('welcomeSubtitle')}</p>
            <div className="suggestions">
              {suggestions.map((s) => (
                <button key={s} className="suggestion" onClick={() => controller.sendMessage(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="message-list">
            {visible.map((m) => (
              <Message key={m.id} message={m} toolResults={toolResults} />
            ))}
          </div>
        )}
      </div>

      {pendingApproval && (
        <div className="approval-bar">
          <div className="approval-info">
            <span className="approval-title">{t('allowActionTitle', { action: approvalAction })}</span>
            <code>{pendingApproval.detail}</code>
          </div>
          <div className="approval-actions">
            <button className="btn-deny" onClick={controller.deny}>
              {t('deny')}
            </button>
            <button className="btn-approve" onClick={controller.approve}>
              {t('allow')}
            </button>
          </div>
        </div>
      )}

      <Composer
        generating={generating}
        onSend={controller.sendMessage}
        onStop={controller.stop}
        placeholder={settings.apiKey ? t('composerPlaceholder') : t('composerPlaceholderNoKey')}
      />
    </div>
  );
}
