import { useReducer, useRef, useState } from 'react';
import { streamChat } from './deepseek';
import { newId } from './id';
import { loadConversations, loadSettings, saveConversations, saveSettings } from './storage';
import { describeTool, executeTool, TOOL_SCHEMAS, toolNeedsApproval } from './tools';
import type { Conversation, Message, ModelId, Settings, ToolCall } from './types';

const MAX_TOOL_ITERS = 12;

function makeConversation(model: ModelId): Conversation {
  const now = Date.now();
  return { id: newId('c'), title: 'New chat', model, messages: [], createdAt: now, updatedAt: now };
}

function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > 42 ? t.slice(0, 42) + '…' : t || 'New chat';
}

export interface PendingApproval {
  toolCall: ToolCall;
  title: string;
  detail: string;
}

export function useChat() {
  const convsRef = useRef<Conversation[]>(loadConversations());
  const [activeId, setActiveId] = useState<string | null>(convsRef.current[0]?.id ?? null);
  const [settings, setSettings] = useState<Settings>(loadSettings());
  const [generating, setGenerating] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);

  const [, forceRender] = useReducer((x: number) => x + 1, 0);
  const rafRef = useRef<number | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const approvalResolver = useRef<((decision: boolean) => void) | null>(null);
  const stoppedRef = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const bumpNow = () => forceRender();
  const bumpSoon = () => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      forceRender();
    });
  };
  const persist = () => saveConversations(convsRef.current);

  const getActive = (): Conversation | null =>
    convsRef.current.find((c) => c.id === activeId) ?? null;

  // ── Conversation management ──────────────────────────
  function newConversation(): Conversation {
    const conv = makeConversation(settingsRef.current.model);
    convsRef.current = [conv, ...convsRef.current];
    setActiveId(conv.id);
    persist();
    bumpNow();
    return conv;
  }

  function selectConversation(id: string) {
    setActiveId(id);
  }

  function deleteConversation(id: string) {
    convsRef.current = convsRef.current.filter((c) => c.id !== id);
    if (activeId === id) setActiveId(convsRef.current[0]?.id ?? null);
    persist();
    bumpNow();
  }

  function setModel(model: ModelId) {
    const conv = getActive();
    if (conv) {
      conv.model = model;
      conv.updatedAt = Date.now();
      persist();
      bumpNow();
    }
    updateSettings({ model });
  }

  function updateSettings(patch: Partial<Settings>) {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    saveSettings(next);
  }

  // ── Approval gate ────────────────────────────────────
  function requestApproval(tc: ToolCall): Promise<boolean> {
    const { title, detail } = describeTool(tc);
    return new Promise((resolve) => {
      approvalResolver.current = resolve;
      setPendingApproval({ toolCall: tc, title, detail });
    });
  }

  function resolveApproval(decision: boolean) {
    const r = approvalResolver.current;
    approvalResolver.current = null;
    setPendingApproval(null);
    r?.(decision);
  }

  // ── Generation control ───────────────────────────────
  function stop() {
    stoppedRef.current = true;
    cancelRef.current?.();
    if (approvalResolver.current) resolveApproval(false);
  }

  async function runTurn(conv: Conversation) {
    setGenerating(true);
    stoppedRef.current = false;
    const startedAt = Date.now();
    const cfg = settingsRef.current;

    try {
      for (let iter = 0; iter < MAX_TOOL_ITERS; iter++) {
        if (stoppedRef.current) break;

        const asst: Message = {
          id: newId('a'),
          role: 'assistant',
          content: '',
          reasoning: '',
          model: conv.model,
          createdAt: Date.now(),
          pending: true,
        };
        conv.messages.push(asst);
        conv.updatedAt = Date.now();
        bumpNow();

        const useTools = conv.model !== 'deepseek-reasoner';
        const handle = streamChat(
          {
            messages: conv.messages.slice(0, -1),
            model: conv.model,
            settings: cfg,
            tools: useTools ? TOOL_SCHEMAS : undefined,
          },
          {
            onContent: (d) => {
              asst.content += d;
              bumpSoon();
            },
            onReasoning: (d) => {
              asst.reasoning = (asst.reasoning || '') + d;
              bumpSoon();
            },
            onToolCalls: (tcs) => {
              asst.toolCalls = tcs;
              bumpSoon();
            },
          },
        );
        cancelRef.current = handle.cancel;

        let result;
        try {
          result = await handle.promise;
        } finally {
          cancelRef.current = null;
        }

        asst.pending = false;
        asst.content = result.content;
        asst.reasoning = result.reasoning || undefined;
        asst.toolCalls = result.toolCalls.length ? result.toolCalls : undefined;
        asst.elapsedMs = Date.now() - startedAt;
        bumpNow();
        persist();

        if (result.cancelled || stoppedRef.current) break;
        if (!asst.toolCalls || result.finishReason !== 'tool_calls') break;

        // Execute each requested tool, gating dangerous ones behind approval.
        for (const tc of asst.toolCalls) {
          if (stoppedRef.current) break;
          const need = toolNeedsApproval(tc.name) && !cfg.autoApprove;
          let approved = true;
          if (need) approved = await requestApproval(tc);

          let out = '';
          let isErr = false;
          if (!approved) {
            out = 'User denied this action.';
            isErr = true;
          } else {
            try {
              out = await executeTool(tc, settingsRef.current);
            } catch (e: any) {
              out = 'Error: ' + (e?.message || String(e));
              isErr = true;
            }
          }
          conv.messages.push({
            id: newId('t'),
            role: 'tool',
            toolCallId: tc.id,
            toolName: tc.name,
            content: out,
            isError: isErr,
            createdAt: Date.now(),
          });
          bumpNow();
          persist();
        }
        if (stoppedRef.current) break;
      }
    } catch (e: any) {
      const last = conv.messages[conv.messages.length - 1];
      const msg = e?.message || String(e);
      if (last && last.role === 'assistant') {
        last.pending = false;
        last.error = msg;
      } else {
        conv.messages.push({
          id: newId('e'),
          role: 'assistant',
          content: '',
          error: msg,
          createdAt: Date.now(),
        });
      }
      bumpNow();
      persist();
    } finally {
      setGenerating(false);
      cancelRef.current = null;
      approvalResolver.current = null;
      setPendingApproval(null);
    }
  }

  function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || generating) return;
    let conv = getActive();
    if (!conv) conv = newConversation();

    conv.messages.push({ id: newId('u'), role: 'user', content: trimmed, createdAt: Date.now() });
    if (!conv.title || conv.title === 'New chat') conv.title = titleFrom(trimmed);
    conv.updatedAt = Date.now();
    persist();
    bumpNow();

    void runTurn(conv);
  }

  return {
    conversations: convsRef.current,
    activeConversation: getActive(),
    activeId,
    settings,
    generating,
    pendingApproval,
    // actions
    sendMessage,
    stop,
    newConversation,
    selectConversation,
    deleteConversation,
    setModel,
    updateSettings,
    approve: () => resolveApproval(true),
    deny: () => resolveApproval(false),
  };
}

export type ChatController = ReturnType<typeof useChat>;
