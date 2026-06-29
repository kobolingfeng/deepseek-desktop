import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import { KeyRound, ListTodo, MessageSquare, Target } from 'lucide-react';
import { Composer } from './Composer';
import { Message } from './Message';
import { StatusCard } from './StatusCard';
import { TodoPanel } from './TodoPanel';
import { useI18n } from '../lib/i18n';
import type { ChatController } from '../lib/useChat';
import type { Message as Msg } from '../lib/types';

// Slow tools that get a continuous status line (no ticking timer) instead of letting the
// per-message "Thinking…" meter blink out while they run. Maps tool name → i18n key.
const TOOL_STATUS: Record<string, string> = {
  web_search: 'statusSearching',
  read_url: 'statusReading',
  run_command: 'statusRunningTool',
  start_process: 'statusRunningTool',
  read_process: 'statusRunningTool',
  write_process: 'statusRunningTool',
  run_subagent: 'statusSubagent',
};

// Single continuous status indicator for a turn: same element throughout, only the label
// text changes (Thinking ↔ Searching…) and the seconds keep counting from `since`.
function TurnStatus({ since, label }: { since: number; label: string }) {
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.round((Date.now() - since) / 1000));
  return (
    <div className="stream-meter">
      <span className="stream-dot" />
      {label} · {s}s
    </div>
  );
}

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

  // Keep the visible BOTTOM line fixed when the plan panel (just above the composer) expands or
  // collapses: it grows/shrinks the messages viewport by dh, so shift scrollTop by the same dh —
  // wherever the scrollbar currently is, the last line you saw stays the last line you see.
  // A callback ref wires the observer up only while the plan is mounted.
  const todoRoRef = useRef<ResizeObserver | null>(null);
  const todoPrevHRef = useRef(0);
  const setTodoRef = useCallback((node: HTMLDivElement | null) => {
    todoRoRef.current?.disconnect();
    todoRoRef.current = null;
    if (!node) return;
    todoPrevHRef.current = node.offsetHeight;
    const ro = new ResizeObserver(() => {
      const h = node.offsetHeight;
      const dh = h - todoPrevHRef.current;
      todoPrevHRef.current = h;
      const sc = scrollerRef.current;
      if (dh !== 0 && sc) {
        // .messages has scroll-behavior:smooth — force an INSTANT adjustment so the per-frame
        // compensation actually tracks the plan's height instead of lagging behind an animation.
        const prev = sc.style.scrollBehavior;
        sc.style.scrollBehavior = 'auto';
        sc.scrollTop += dh;
        sc.style.scrollBehavior = prev;
      }
    });
    ro.observe(node);
    todoRoRef.current = ro;
  }, []);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  });

  // When switching conversations, jump to the newest message.
  useEffect(() => {
    stickRef.current = true;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeConversation?.id]);

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

  const executePlan = (target: 'chat' | 'goal') => {
    controller.updateSettings({ agentMode: target });
    controller.sendMessage(t('executePlanPrompt'));
  };

  // Empty-state "Choose project": picking a working dir makes this an agent
  // session (locked on the first message); leaving it unset makes it a chat.
  const activeCwd = activeConversation?.cwd;
  const projName = activeCwd ? activeCwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : '';
  const chooseProject = async () => {
    const id = activeConversation?.id ?? controller.newConversation().id;
    await controller.setConvCwd(id);
  };
  const clearProject = () => {
    if (activeConversation?.id) controller.clearConvCwd(activeConversation.id);
  };

  return (
    <div className="chat">
      <button
        className={`panel-toggle ${controller.panelOpen ? 'active' : ''}`}
        onClick={controller.togglePanel}
        title={t('panelToggle')}
        aria-label={t('panelToggle')}
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <line x1="10" y1="2.5" x2="10" y2="13.5" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>
      {!settings.apiKey && (
        <div className="apikey-banner" onClick={onOpenSettings}>
          <KeyRound size={15} strokeWidth={1.9} /> {t('apiKeyBanner')}
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
            {dayLabel && (
              <div className="day-divider">
                <span>{dayLabel}</span>
              </div>
            )}
            {visible.map((m) => (
              <Message key={m.id} message={m} toolResults={toolResults} />
            ))}
            {/* ONE continuous status line for the whole turn: only the label text swaps
                (Thinking ↔ Searching ↔ Running) and the timer keeps counting, so the
                height never changes. Hidden while the model is streaming visible text. */}
            {(() => {
              if (!generating || !activeConversation) return null;
              const at = activeConversation.activeTool;
              const last = activeConversation.messages[activeConversation.messages.length - 1];
              const writing = !!(last && last.role === 'assistant' && last.content);
              if (!at && writing) return null;
              const key = at ? TOOL_STATUS[at] || 'statusRunningTool' : 'thinking';
              return <TurnStatus since={activeConversation.turnStartedAt ?? Date.now()} label={t(key)} />;
            })()}
            {activeConversation?.queued?.map((q) => (
              <div key={q.id} className="queued-msg" title={t('queuedHint')}>
                <span className="queued-tag">{t('queued')}</span>
                <span className="queued-text">{q.text}</span>
                <button
                  className="queued-cancel"
                  onClick={() => activeConversation && controller.cancelQueued(activeConversation.id, q.id)}
                  aria-label={t('cancel')}
                  title={t('cancel')}
                >
                  ✕
                </button>
              </div>
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
          <span className="plan-bar-text"><ListTodo size={14} strokeWidth={1.9} /> {t('planReady')}</span>
          <div className="plan-bar-actions">
            <span className="plan-bar-label">{t('executeIn')}</span>
            <button className="btn-deny" onClick={() => executePlan('chat')}>
              <MessageSquare size={14} strokeWidth={1.9} /> {t('modeChat')}
            </button>
            <button className="btn-approve" onClick={() => executePlan('goal')}>
              <Target size={14} strokeWidth={1.9} /> {t('modeGoal')}
            </button>
          </div>
        </div>
      )}


      {isEmpty && (
        <div className="project-chooser">
          <button
            className={`proj-pick ${activeCwd ? 'set' : ''}`}
            onClick={chooseProject}
            title={activeCwd || t('chooseProjectHint')}
          >
            <svg className="proj-ico" viewBox="0 0 24 24" width="15" height="15" aria-hidden>
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"
              />
            </svg>
            <span>{activeCwd ? projName : t('chooseProject')}</span>
          </button>
          {activeCwd && (
            <button className="proj-clear" onClick={clearProject} title={t('dontWorkInProject')}>
              ✕
            </button>
          )}
        </div>
      )}

      {activeConversation?.todos && activeConversation.todos.length > 0 && (
        <TodoPanel todos={activeConversation.todos} panelRef={setTodoRef} />
      )}

      <Composer
        controller={controller}
        generating={generating}
        onSend={controller.sendMessage}
        onStop={controller.stop}
        placeholder={settings.apiKey ? t('composerPlaceholder') : t('composerPlaceholderNoKey')}
      />

      {controller.statusOpen && <StatusCard controller={controller} />}
    </div>
  );
}
