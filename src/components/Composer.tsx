import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MessageSquare, ListTodo, Target, type LucideIcon } from 'lucide-react';
import { clipboard, dialog, win } from '../api';
import { useI18n } from '../lib/i18n';
import { CONTEXT_LABEL } from '../lib/deepseek';
import { prettyModel, type AgentMode, type ModelId } from '../lib/types';
import { approvalModePerms, listWorkspaceFiles, type ApprovalMode } from '../lib/tools';
import { BUILTIN_SKILLS } from '../lib/skills';
import type { ChatController } from '../lib/useChat';

function BarMenu({
  chip,
  heading,
  options,
  currentId,
  onSelect,
  disabled,
  danger,
}: {
  chip: ReactNode;
  heading?: string;
  options: { id: string; label: string; desc?: string }[];
  currentId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="bar-dd" ref={ref}>
      <button className={`bar-chip ${danger ? 'danger' : ''}`} onClick={() => setOpen((o) => !o)} disabled={disabled}>
        {chip}
        <span className="bar-caret">▾</span>
      </button>
      {open && (
        <div className="bar-menu">
          {heading && <div className="bar-menu-head">{heading}</div>}
          {options.map((o) => (
            <button
              key={o.id}
              className={`bar-option ${o.id === currentId ? 'active' : ''}`}
              onClick={() => {
                onSelect(o.id);
                setOpen(false);
              }}
            >
              <div className="bar-option-main">
                <div className="bar-option-label">{o.label}</div>
                {o.desc && <div className="bar-option-desc">{o.desc}</div>}
              </div>
              {o.id === currentId && <span className="bar-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface Suggestion {
  key: string;
  primary: string;
  secondary?: string;
  run: () => void;
}

export function Composer({
  controller,
  generating,
  onSend,
  onStop,
  disabled,
  placeholder,
}: {
  controller: ChatController;
  generating: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const { t } = useI18n();
  const lang = controller.settings.language;
  const [text, setText] = useState('');
  const [sugIdx, setSugIdx] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const filesLoaded = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [text]);

  useEffect(() => {
    return win.onFileDrop(({ files }) => {
      if (!files || !files.length || disabled) return;
      // Prefix with @ so dropped files are inlined as attachments, not plain paths.
      const tokens = files.map((f) => '@' + f).join(' ');
      setText((prev) => (prev && !/\s$/.test(prev) ? prev + ' ' : prev) + tokens + ' ');
      ref.current?.focus();
    });
  }, [disabled]);

  const model = controller.activeConversation?.model ?? controller.settings.model;

  // ── Slash commands & @-file mention suggestions ──────────
  const slashQuery = !dismissed && /^\/(\S*)$/.test(text) ? text.slice(1).toLowerCase() : null;
  const atMatch = !dismissed ? /(?:^|\s)@(\S*)$/.exec(text) : null;

  // @-mention files come from the ACTIVE conversation's working dir (a project chat has
  // its own cwd), matching how mentions are expanded at send time.
  const effectiveCwd = controller.activeConversation?.cwd || controller.settings.workingDir;
  // Reset the @-mention file cache when the project directory changes.
  useEffect(() => {
    filesLoaded.current = false;
    setFiles([]);
  }, [effectiveCwd]);

  useEffect(() => {
    if (!(atMatch && !filesLoaded.current && effectiveCwd)) return;
    filesLoaded.current = true;
    let cancelled = false;
    listWorkspaceFiles(effectiveCwd)
      .then((f) => {
        if (!cancelled) setFiles(f);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [atMatch, effectiveCwd]);

  const curMode = controller.settings.agentMode || 'chat';
  // `run` = execute immediately (and clear the box); `insert` = drop text into the box
  // for the user to complete (e.g. /rename <title>, /mention @file) instead of running.
  const SLASH: { cmd: string; label: string; run?: () => void; insert?: string }[] = [
    { cmd: 'plan', label: t('cmdPlan'), run: () => controller.updateSettings({ agentMode: curMode === 'plan' ? 'chat' : 'plan' }) },
    { cmd: 'goal', label: t('cmdGoal'), run: () => controller.updateSettings({ agentMode: curMode === 'goal' ? 'chat' : 'goal' }) },
    { cmd: 'clear', label: t('cmdClear'), run: () => controller.clearActive() },
    { cmd: 'compact', label: t('cmdCompact'), run: () => controller.compactActive() },
    { cmd: 'diff', label: t('cmdDiff'), run: () => controller.runGitDiff() },
    { cmd: 'status', label: t('cmdStatus'), run: () => controller.showStatus() },
    { cmd: 'new', label: t('cmdNew'), run: () => controller.newConversation() },
    { cmd: 'rename', label: t('cmdRename'), insert: '/rename ' },
    { cmd: 'fork', label: t('cmdFork'), run: () => { if (controller.activeId) controller.duplicateConversation(controller.activeId); } },
    { cmd: 'mention', label: t('cmdMention'), insert: '@' },
    { cmd: 'review', label: t('cmdReview'), run: () => controller.sendMessage(t('reviewPrompt')) },
    {
      cmd: 'copy',
      label: t('cmdCopy'),
      run: () => {
        const msgs = controller.activeConversation?.messages || [];
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].role === 'assistant' && msgs[i].content) {
            clipboard.writeText(msgs[i].content).catch(() => {});
            break;
          }
        }
      },
    },
    { cmd: 'init', label: t('cmdInit'), run: () => controller.sendMessage(t('initPrompt')) },
    {
      cmd: 'model',
      label: t('cmdModel'),
      run: () => {
        const ms = controller.models;
        if (!ms.length) return;
        controller.setModel(ms[(ms.indexOf(model) + 1) % ms.length]);
      },
    },
    {
      cmd: 'cwd',
      label: t('cmdCwd'),
      run: async () => {
        try {
          const d = await dialog.openFolder();
          if (d) controller.updateSettings({ workingDir: d });
        } catch {
          /* ignore */
        }
      },
    },
    ...BUILTIN_SKILLS.map((s) => ({
      cmd: s.id,
      label:
        (controller.settings.language === 'zh' ? s.name.zh : s.name.en) +
        ' · ' +
        (controller.settings.language === 'zh' ? s.desc.zh : s.desc.en),
      insert: '/' + s.id + ' ',
    })),
    ...(controller.settings.customCommands || [])
      .filter((c) => c.name.trim() && c.prompt.trim())
      .map((c) => ({
        cmd: c.name.trim(),
        label: c.prompt.replace(/\s+/g, ' ').slice(0, 48),
        run: () => controller.sendMessage(c.prompt),
      })),
  ];

  const selectFile = (f: string) => {
    const i = text.lastIndexOf('@');
    // Keep the leading @ so the backend expands it into an inlined attachment.
    setText((i >= 0 ? text.slice(0, i) : text) + '@' + f + ' ');
    setDismissed(true);
    ref.current?.focus();
  };

  let suggestions: { kind: 'slash' | 'file'; items: Suggestion[] } | null = null;
  if (slashQuery !== null) {
    const items = SLASH.filter((s) => s.cmd.startsWith(slashQuery)).map((s) => ({
      key: s.cmd,
      primary: '/' + s.cmd,
      secondary: s.label,
      run: () => {
        if (s.insert !== undefined) {
          setText(s.insert);
          setDismissed(false); // let @-mention autocomplete kick in for /mention
          ref.current?.focus();
        } else {
          s.run?.();
          setText('');
          setDismissed(true);
        }
      },
    }));
    if (items.length) suggestions = { kind: 'slash', items };
  } else if (atMatch) {
    const q = atMatch[1].toLowerCase();
    const items = files
      .filter((f) => f.toLowerCase().includes(q))
      .slice(0, 8)
      .map((f) => ({ key: f, primary: f, run: () => selectFile(f) }));
    if (items.length) suggestions = { kind: 'file', items };
  }
  const sugCount = suggestions?.items.length ?? 0;
  const sugClamped = Math.min(sugIdx, Math.max(0, sugCount - 1));

  const submit = () => {
    const tx = text.trim();
    // Note: NOT blocked while generating — sendMessage queues it to run after the turn.
    if (!tx || disabled) return;
    // /rename <title> renames the active conversation instead of sending a message.
    const rn = /^\/rename\s+(.+)$/.exec(tx);
    if (rn) {
      if (controller.activeId) controller.renameConversation(controller.activeId, rn[1].trim());
      setText('');
      return;
    }
    onSend(tx);
    setText('');
  };

  const onChange = (v: string) => {
    setText(v);
    setDismissed(false);
    setSugIdx(0);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (suggestions && !e.nativeEvent.isComposing) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSugIdx((i) => (i + 1) % sugCount);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSugIdx((i) => (i - 1 + sugCount) % sugCount);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        suggestions.items[sugClamped]?.run();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (e.key === 'Escape' && generating) {
      e.preventDefault();
      onStop();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const attach = async () => {
    try {
      const p = await dialog.openFile();
      const path = Array.isArray(p) ? p[0] : p;
      if (path) {
        // Prefix @ so the picked file is inlined as an attachment (like drag/drop).
        setText((prev) => (prev ? prev.replace(/\s*$/, ' ') : '') + '@' + path + ' ');
        ref.current?.focus();
      }
    } catch {
      /* ignore */
    }
  };

  const modelBlurb = (id: string) =>
    /flash/i.test(id)
      ? t('modelBlurbFast')
      : /pro/i.test(id)
        ? t('modelBlurbPro')
        : /reason/i.test(id)
          ? t('modelBlurbReason')
          : t('modelBlurbDefault');
  const modelOptions = controller.models.map((id) => ({ id, label: prettyModel(id), desc: modelBlurb(id) }));

  const permMode = controller.settings.approvalMode || 'read';
  const PERM_LABEL: Record<string, string> = {
    read: t('approvalRead'),
    auto: t('approvalAuto'),
    full: t('approvalFull'),
  };
  const permOptions = [
    { id: 'read', label: t('approvalRead'), desc: t('approvalReadDesc') },
    { id: 'auto', label: t('approvalAuto'), desc: t('approvalAutoDesc') },
    { id: 'full', label: t('approvalFull'), desc: t('approvalFullDesc') },
  ];

  const ctxMsgs = controller.activeConversation?.messages ?? [];
  let ctxTokens = 0;
  for (let i = ctxMsgs.length - 1; i >= 0; i--) {
    if (ctxMsgs[i].inputTokens) {
      ctxTokens = ctxMsgs[i].inputTokens as number;
      break;
    }
  }

  const agentMode = controller.settings.agentMode || 'chat';
  const MODE_LABEL: Record<string, string> = { chat: t('modeChat'), plan: t('modePlan'), goal: t('modeGoal') };
  const MODE_ICON: Record<string, LucideIcon> = { chat: MessageSquare, plan: ListTodo, goal: Target };
  const modeOptions = [
    { id: 'chat', label: t('modeChat'), desc: t('modeChatDesc') },
    { id: 'plan', label: t('modePlan'), desc: t('modePlanDesc') },
    { id: 'goal', label: t('modeGoal'), desc: t('modeGoalDesc') },
  ];

  return (
    <div className="composer">
      <div className="composer-inner">
        {suggestions && (
          <div className="suggest">
            {suggestions.items.map((s, i) => (
              <button
                key={s.key}
                className={`suggest-item ${i === sugClamped ? 'active' : ''}`}
                onMouseEnter={() => setSugIdx(i)}
                onClick={() => s.run()}
              >
                <span className="suggest-primary">{s.primary}</span>
                {s.secondary && <span className="suggest-secondary">{s.secondary}</span>}
              </button>
            ))}
          </div>
        )}
        <div className="composer-box">
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder ?? t('composerPlaceholder')}
            rows={1}
            disabled={disabled}
          />
          <div className="composer-bar">
            <div className="composer-tools">
              <button className="composer-tool" onClick={attach} title={t('attachFile')} disabled={disabled}>
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                  <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M8 3.3v9.4M3.3 8h9.4" />
                </svg>
              </button>
              <BarMenu
                heading={t('approvalHeading')}
                danger={permMode === 'full'}
                chip={
                  <>
                    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden>
                      <path
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinejoin="round"
                        d="M8 1.8 3 3.6v3.9c0 3 2.1 5 5 6.7 2.9-1.7 5-3.7 5-6.7V3.6Z"
                      />
                    </svg>
                    {PERM_LABEL[permMode]}
                  </>
                }
                options={permOptions}
                currentId={permMode}
                onSelect={(id) =>
                  controller.updateSettings({ approvalMode: id as ApprovalMode, toolPermissions: approvalModePerms(id as ApprovalMode) })
                }
                disabled={disabled}
              />
              {agentMode !== 'chat' && (
                <BarMenu
                  heading={t('modeHeading')}
                  danger={agentMode === 'goal'}
                  chip={
                    <>
                      {(() => {
                        const I = MODE_ICON[agentMode];
                        return I ? <I className="bar-chip-ico" size={13} strokeWidth={1.9} /> : null;
                      })()}
                      {MODE_LABEL[agentMode]}
                    </>
                  }
                  options={modeOptions}
                  currentId={agentMode}
                  onSelect={(id) => controller.updateSettings({ agentMode: id as AgentMode })}
                  disabled={disabled}
                />
              )}
            </div>
            <div className="composer-tools">
              <BarMenu
                chip={<span className="bar-chip-label">{prettyModel(model)}</span>}
                options={modelOptions}
                currentId={model}
                onSelect={(id) => controller.setModel(id as ModelId)}
                disabled={disabled}
              />
              {generating ? (
                <button className="send-btn stop" onClick={onStop} title={t('stop')}>
                  <span className="stop-square" />
                </button>
              ) : (
                <button className="send-btn" onClick={submit} disabled={!text.trim() || disabled} title={t('send')}>
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                    <path fill="currentColor" d="M1.7 7.3 14 2.1c.5-.2 1 .3.8.8L9.6 15c-.2.5-.9.5-1.1 0L6.9 9.9a.5.5 0 0 0-.3-.3L1.7 8.4c-.5-.2-.5-.9 0-1.1Z" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="composer-hint">
          <span className="hint-text">{t('disclaimer')}</span>
          {ctxTokens > 0 && (
            <span className="ctx-meter" title="context used">
              {Math.round(ctxTokens / 1000)}k / {CONTEXT_LABEL}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
