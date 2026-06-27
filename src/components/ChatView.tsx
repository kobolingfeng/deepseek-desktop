import { useLayoutEffect, useRef } from 'react';
import { Composer } from './Composer';
import { Message } from './Message';
import { TodoPanel } from './TodoPanel';
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
  const { t, lang } = useI18n();
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

  const visible = messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.auto);
  const isEmpty = visible.length === 0;
  const suggestions = ['suggestion1', 'suggestion2', 'suggestion3', 'suggestion4'].map((k) => t(k));

  const dayLabel = (() => {
    if (!visible.length) return '';
    const ts = visible[0].createdAt;
    const d0 = new Date();
    d0.setHours(0, 0, 0, 0);
    const ds = new Date(ts);
    ds.setHours(0, 0, 0, 0);
    if (ds.getTime() >= d0.getTime()) return t('groupToday');
    if (ds.getTime() >= d0.getTime() - 86400000) return t('groupYesterday');
    const d = new Date(ts);
    return lang === 'zh'
      ? `${d.getMonth() + 1}月${d.getDate()}日`
      : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  })();
  const approvalAction = pendingApproval ? t('tool_' + pendingApproval.toolCall.name) : '';

  const lastVisible = visible[visible.length - 1];
  const planReady =
    settings.agentMode === 'plan' &&
    !generating &&
    !pendingApproval &&
    !!lastVisible &&
    lastVisible.role === 'assistant' &&
    !!lastVisible.content;

  const executePlan = () => {
    controller.updateSettings({ agentMode: 'chat' });
    controller.sendMessage(t('executePlanPrompt'));
  };

  return (
    <div className="chat">
      {!settings.apiKey && (
        <div className="apikey-banner" onClick={onOpenSettings}>
          🔑 {t('apiKeyBanner')}
        </div>
      )}

      {activeConversation?.todos && activeConversation.todos.length > 0 && (
        <TodoPanel todos={activeConversation.todos} />
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
            {dayLabel && (
              <div className="day-divider">
                <span>{dayLabel}</span>
              </div>
            )}
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

      {planReady && (
        <div className="plan-bar">
          <span className="plan-bar-text">📋 {t('planReady')}</span>
          <button className="btn-approve" onClick={executePlan}>
            {t('executePlan')} ▶
          </button>
        </div>
      )}

      <Composer
        controller={controller}
        generating={generating}
        onSend={controller.sendMessage}
        onStop={controller.stop}
        placeholder={settings.apiKey ? t('composerPlaceholder') : t('composerPlaceholderNoKey')}
      />
    </div>
  );
}
