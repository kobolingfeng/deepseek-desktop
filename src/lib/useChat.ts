import { useReducer, useRef, useState } from 'react';
import { streamChat } from './deepseek';
import { newId } from './id';
import { loadConversations, loadSettings, saveConversations, saveSettings } from './storage';
import { describeTool, executeTool, isKnownTool, TOOL_SCHEMAS, toolPerm } from './tools';
import type { Conversation, Message, ModelId, Settings, ToolCall } from './types';

const MAX_TOOL_ITERS = 12;
// Codex-style context compaction: when a conversation grows past this many
// characters, summarize the older messages and keep only the recent ones.
const COMPACT_CHAR_THRESHOLD = 90000;
const KEEP_RECENT_MSGS = 6;
const COMPACT_PROMPT =
  "Summarize the conversation so far into a concise but complete brief that preserves the user's goals, key facts, decisions, file paths, important code, and any open tasks, so the assistant can continue seamlessly. Write in the same language as the conversation. Output only the summary.";

function totalChars(messages: Message[], systemPrompt: string): number {
  let n = systemPrompt.length;
  for (const m of messages) {
    n += (m.content?.length || 0) + (m.reasoning?.length || 0);
    if (m.toolCalls) n += JSON.stringify(m.toolCalls).length;
  }
  return n;
}

function renderTranscript(messages: Message[]): string {
  return messages
    .map((m) => {
      if (m.role === 'user') return 'User: ' + m.content;
      if (m.role === 'assistant') {
        if (m.content) return 'Assistant: ' + m.content;
        if (m.toolCalls?.length) return 'Assistant called tools: ' + m.toolCalls.map((t) => t.name).join(', ');
        return '';
      }
      if (m.role === 'tool') return `Tool(${m.toolName}): ` + (m.content || '').slice(0, 1200);
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

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
  const generatingRef = useRef(false);
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

  // Summarize older messages when the conversation gets long, to stay within
  // the model's context window (codex/Claude-Code-style auto-compaction).
  async function maybeCompact(conv: Conversation, cfg: Settings) {
    const msgs = conv.messages;
    if (msgs.length <= KEEP_RECENT_MSGS + 2) return;
    if (totalChars(msgs, cfg.systemPrompt) < COMPACT_CHAR_THRESHOLD) return;

    let splitAt = msgs.length - KEEP_RECENT_MSGS;
    // Don't let the recent slice start with orphan tool results.
    while (splitAt < msgs.length && msgs[splitAt].role === 'tool') splitAt++;
    const older = msgs.slice(0, splitAt);
    const recent = msgs.slice(splitAt);
    if (older.length < 3) return;

    const { promise } = streamChat(
      {
        messages: [
          { id: newId('c'), role: 'user', content: COMPACT_PROMPT + '\n\n---\n' + renderTranscript(older), createdAt: Date.now() },
        ],
        model: 'deepseek-chat',
        settings: cfg,
      },
      {},
    );
    let summary = '';
    try {
      summary = (await promise).content;
    } catch {
      return; // compaction failed — keep the full history rather than lose it
    }
    if (!summary.trim()) return;

    const label = cfg.language === 'zh' ? '（以下为早前对话的摘要）\n' : '(Summary of the earlier conversation)\n';
    const summaryMsg: Message = {
      id: newId('s'),
      role: 'user',
      content: label + summary.trim(),
      compacted: true,
      createdAt: Date.now(),
    };
    conv.messages = [summaryMsg, ...recent];
    bumpNow();
    persist();
  }

  async function runTurn(conv: Conversation) {
    setGenerating(true);
    stoppedRef.current = false;
    const startedAt = Date.now();
    const cfg = settingsRef.current;
    let hitToolLimit = false;

    try {
      await maybeCompact(conv, cfg);

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
        const activeTools = TOOL_SCHEMAS.filter(
          (s) => toolPerm((s.function as { name: string }).name, settingsRef.current) !== 'off',
        );
        const handle = streamChat(
          {
            messages: conv.messages.slice(0, -1),
            model: conv.model,
            settings: cfg,
            tools: useTools && activeTools.length ? activeTools : undefined,
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

        // Cancelled/stopped before executing tools: drop unexecuted tool calls so
        // we never persist assistant tool_calls without matching tool results
        // (which would make the next API request invalid).
        if (result.cancelled || stoppedRef.current) {
          asst.toolCalls = undefined;
          bumpNow();
          persist();
          break;
        }
        if (!asst.toolCalls || result.finishReason !== 'tool_calls') {
          if (asst.toolCalls) {
            asst.toolCalls = undefined; // stray tool calls without a tool_calls finish — discard
            bumpNow();
            persist();
          }
          break;
        }

        // Execute each requested tool, gating by permission.
        for (const tc of asst.toolCalls) {
          if (stoppedRef.current) break;
          let out = '';
          let isErr = false;
          if (!isKnownTool(tc.name)) {
            out = `Unknown tool: ${tc.name}`;
            isErr = true;
          } else {
            const perm = toolPerm(tc.name, settingsRef.current);
            let approved = true;
            if (perm === 'ask') approved = await requestApproval(tc);
            if (perm === 'off') {
              out = 'This tool is disabled by the user.';
              isErr = true;
            } else if (!approved) {
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

        // Backfill results for any tool call left unhandled (e.g. Stop mid-loop)
        // so assistant tool_calls always have matching tool results.
        for (const tc of asst.toolCalls) {
          if (!conv.messages.some((mm) => mm.role === 'tool' && mm.toolCallId === tc.id)) {
            conv.messages.push({
              id: newId('t'),
              role: 'tool',
              toolCallId: tc.id,
              toolName: tc.name,
              content: 'Cancelled.',
              isError: true,
              createdAt: Date.now(),
            });
          }
        }
        bumpNow();
        persist();

        if (stoppedRef.current) break;
        if (iter === MAX_TOOL_ITERS - 1) hitToolLimit = true;
      }

      if (hitToolLimit && !stoppedRef.current) {
        conv.messages.push({
          id: newId('e'),
          role: 'assistant',
          content: '',
          error: `Reached the tool-call limit (${MAX_TOOL_ITERS} steps).`,
          createdAt: Date.now(),
        });
        bumpNow();
        persist();
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
      generatingRef.current = false;
      setGenerating(false);
      cancelRef.current = null;
      approvalResolver.current = null;
      setPendingApproval(null);
    }
  }

  function sendMessage(text: string) {
    const trimmed = text.trim();
    if (generatingRef.current || !trimmed) return;
    generatingRef.current = true;
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
