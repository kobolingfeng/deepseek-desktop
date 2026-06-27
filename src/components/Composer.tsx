import { useEffect, useRef, useState, type ReactNode } from 'react';
import { dialog, win } from '../api';
import { useI18n } from '../lib/i18n';
import { MODELS, type AgentMode, type ModelId } from '../lib/types';
import { approvalModePerms, deriveApprovalMode, listWorkspaceFiles, type ApprovalMode } from '../lib/tools';
import type { ChatController } from '../lib/useChat';

const SpeechRec: any =
  typeof window !== 'undefined'
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : undefined;

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
  const [listening, setListening] = useState(false);
  const [sugIdx, setSugIdx] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const filesLoaded = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const recRef = useRef<any>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [text]);

  useEffect(() => {
    return win.onFileDrop(({ files }) => {
      if (!files || !files.length || disabled) return;
      setText((prev) => (prev && !/\s$/.test(prev) ? prev + ' ' : prev) + files.join(' '));
      ref.current?.focus();
    });
  }, [disabled]);

  const model = controller.activeConversation?.model ?? controller.settings.model;

  // ── Slash commands & @-file mention suggestions ──────────
  const slashQuery = !dismissed && /^\/(\S*)$/.test(text) ? text.slice(1).toLowerCase() : null;
  const atMatch = !dismissed ? /(?:^|\s)@(\S*)$/.exec(text) : null;

  useEffect(() => {
    if (atMatch && !filesLoaded.current && controller.settings.workingDir) {
      filesLoaded.current = true;
      listWorkspaceFiles(controller.settings.workingDir).then(setFiles).catch(() => {});
    }
  }, [atMatch, controller.settings.workingDir]);

  const curMode = controller.settings.agentMode || 'chat';
  const SLASH: { cmd: string; label: string; run: () => void }[] = [
    { cmd: 'plan', label: t('cmdPlan'), run: () => controller.updateSettings({ agentMode: curMode === 'plan' ? 'chat' : 'plan' }) },
    { cmd: 'loop', label: t('cmdLoop'), run: () => controller.updateSettings({ agentMode: curMode === 'loop' ? 'chat' : 'loop' }) },
    { cmd: 'clear', label: t('cmdClear'), run: () => controller.clearActive() },
    { cmd: 'compact', label: t('cmdCompact'), run: () => controller.compactActive() },
    { cmd: 'init', label: t('cmdInit'), run: () => controller.sendMessage(t('initPrompt')) },
    {
      cmd: 'model',
      label: t('cmdModel'),
      run: () => controller.setModel(model === 'deepseek-chat' ? 'deepseek-reasoner' : 'deepseek-chat'),
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
  ];

  const selectFile = (f: string) => {
    const i = text.lastIndexOf('@');
    setText((i >= 0 ? text.slice(0, i) : text) + f + ' ');
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
        s.run();
        setText('');
        setDismissed(true);
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
    if (!tx || generating || disabled) return;
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
        setText((prev) => (prev ? prev.replace(/\s*$/, ' ') : '') + path);
        ref.current?.focus();
      }
    } catch {
      /* ignore */
    }
  };

  const toggleVoice = () => {
    if (!SpeechRec) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    try {
      const rec = new SpeechRec();
      rec.lang = lang === 'zh' ? 'zh-CN' : 'en-US';
      rec.interimResults = true;
      rec.continuous = false;
      const base = text;
      rec.onresult = (e: any) => {
        let s = '';
        for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript;
        setText((base ? base.replace(/\s*$/, ' ') : '') + s);
      };
      rec.onend = () => {
        setListening(false);
        recRef.current = null;
      };
      rec.onerror = () => {
        setListening(false);
        recRef.current = null;
      };
      recRef.current = rec;
      setListening(true);
      rec.start();
    } catch {
      setListening(false);
    }
  };

  const currentModel = MODELS.find((m) => m.id === model) ?? MODELS[0];
  const modelOptions = MODELS.map((m) => ({ id: m.id, label: m.label, desc: t(m.blurbKey) }));

  const permMode = deriveApprovalMode(controller.settings.toolPermissions);
  const PERM_LABEL: Record<string, string> = {
    ask: t('approvalAsk'),
    auto: t('approvalAuto'),
    full: t('approvalFull'),
    custom: t('approvalCustom'),
  };
  const permOptions = [
    { id: 'ask', label: t('approvalAsk'), desc: t('approvalAskDesc') },
    { id: 'auto', label: t('approvalAuto'), desc: t('approvalAutoDesc') },
    { id: 'full', label: t('approvalFull'), desc: t('approvalFullDesc') },
  ];

  const agentMode = controller.settings.agentMode || 'chat';
  const MODE_LABEL: Record<string, string> = { chat: t('modeChat'), plan: t('modePlan'), loop: t('modeLoop') };
  const MODE_ICON: Record<string, string> = { chat: '💬', plan: '📋', loop: '🔁' };
  const modeOptions = [
    { id: 'chat', label: t('modeChat'), desc: t('modeChatDesc') },
    { id: 'plan', label: t('modePlan'), desc: t('modePlanDesc') },
    { id: 'loop', label: t('modeLoop'), desc: t('modeLoopDesc') },
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
                onSelect={(id) => controller.updateSettings({ toolPermissions: approvalModePerms(id as ApprovalMode) })}
                disabled={disabled}
              />
              {agentMode !== 'chat' && (
                <BarMenu
                  heading={t('modeHeading')}
                  danger={agentMode === 'loop'}
                  chip={
                    <>
                      <span className="bar-chip-ico">{MODE_ICON[agentMode]}</span>
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
                chip={<span className="bar-chip-label">{currentModel.label}</span>}
                options={modelOptions}
                currentId={model}
                onSelect={(id) => controller.setModel(id as ModelId)}
                disabled={disabled}
              />
              <button
                className={`composer-tool ${listening ? 'listening' : ''}`}
                onClick={toggleVoice}
                title={SpeechRec ? t('voiceInput') : t('voiceUnsupported')}
                disabled={disabled || !SpeechRec}
              >
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                  <rect x="6" y="2" width="4" height="7" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    d="M4 7.6a4 4 0 0 0 8 0M8 11.6V14M6 14h4"
                  />
                </svg>
              </button>
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
        <div className="composer-hint">{t('disclaimer')}</div>
      </div>
    </div>
  );
}
