import { useEffect, useRef, useState, type ReactNode } from 'react';
import { dialog, win } from '../api';
import { useI18n } from '../lib/i18n';
import { MODELS, type ModelId } from '../lib/types';
import { approvalModePerms, deriveApprovalMode, type ApprovalMode } from '../lib/tools';
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

  const submit = () => {
    const tx = text.trim();
    if (!tx || generating || disabled) return;
    onSend(tx);
    setText('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
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

  const insertCode = () => {
    setText((prev) => (prev.trimEnd() ? prev.trimEnd() + '\n\n' : '') + '```\n\n```\n');
    ref.current?.focus();
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

  // Model chip
  const model = controller.activeConversation?.model ?? controller.settings.model;
  const currentModel = MODELS.find((m) => m.id === model) ?? MODELS[0];
  const modelOptions = MODELS.map((m) => ({ id: m.id, label: m.label, desc: t(m.blurbKey) }));

  // Permission chip
  const mode = deriveApprovalMode(controller.settings.toolPermissions);
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

  return (
    <div className="composer">
      <div className="composer-inner">
        <div className="composer-box">
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder ?? t('composerPlaceholder')}
            rows={1}
            disabled={disabled}
          />
          <div className="composer-bar">
            <div className="composer-tools">
              <button className="composer-tool" onClick={attach} title={t('attachFile')} disabled={disabled}>
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M10.5 5.2 6 9.7a1.6 1.6 0 0 0 2.3 2.3l4.6-4.6a3 3 0 0 0-4.3-4.3L4 7.8a4.4 4.4 0 0 0 6.2 6.2l3.8-3.8"
                  />
                </svg>
              </button>
              <button className="composer-tool" onClick={insertCode} title={t('insertCode')} disabled={disabled}>
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6.4 3.3c-1.2 0-1.7.5-1.7 1.7v1c0 .9-.4 1.3-1.2 1.3.8 0 1.2.4 1.2 1.3v1c0 1.2.5 1.7 1.7 1.7M9.6 3.3c1.2 0 1.7.5 1.7 1.7v1c0 .9.4 1.3 1.2 1.3-.8 0-1.2.4-1.2 1.3v1c0 1.2-.5 1.7-1.7 1.7"
                  />
                </svg>
              </button>
              <BarMenu
                heading={t('approvalHeading')}
                danger={mode === 'full'}
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
                    {PERM_LABEL[mode]}
                  </>
                }
                options={permOptions}
                currentId={mode}
                onSelect={(id) => controller.updateSettings({ toolPermissions: approvalModePerms(id as ApprovalMode) })}
                disabled={disabled}
              />
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
