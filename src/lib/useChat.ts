import { useEffect, useReducer, useRef, useState } from 'react';
import { dialog, fs, notification, shell, win } from '../api';
import { streamChat } from './deepseek';
import { newId } from './id';
import { loadConversations, loadSettings, saveConversations, saveSettings } from './storage';
import { DANGEROUS_TOOLS, describeTool, executeTool, isKnownTool, TOOL_SCHEMAS, toolPerm } from './tools';
import type { Conversation, Message, ModelId, Settings, ToolCall } from './types';

const MAX_TOOL_ITERS = 12;
const LOOP_MAX_ITERS = 25;
const PLAN_SYSTEM =
  'You are in PLAN MODE. Investigate with read-only tools if needed, then reply with a concise numbered plan of the steps you would take. Do NOT create or edit files or run commands — make no changes. Stop after presenting the plan.';
const LOOP_SYSTEM =
  'You are in AUTONOMOUS LOOP MODE. Keep working toward the goal across as many steps and tool calls as needed without waiting for confirmation. When the entire task is fully complete, end your message with the marker <DONE> on its own line.';
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

// Auto-load project instructions (AGENTS.md / CLAUDE.md) from the working dir,
// the way codex / Claude Code do, and fold them into the system context.
async function loadProjectContext(dir: string): Promise<string> {
  if (!dir) return '';
  for (const name of ['AGENTS.md', 'CLAUDE.md', '.deepseek.md']) {
    try {
      const p = dir.replace(/[\\/]+$/, '') + '\\' + name;
      if (await fs.exists(p)) {
        const c = await fs.readTextFile(p);
        if (c.trim()) return `Project instructions (${name}):\n\n` + c.slice(0, 8000);
      }
    } catch {
      /* ignore */
    }
  }
  return '';
}

function conversationToMarkdown(conv: Conversation): string {
  const out: string[] = [`# ${conv.title}`, ''];
  for (const m of conv.messages) {
    if (m.auto || m.compacted) continue;
    if (m.role === 'user') out.push('## User', '', m.content, '');
    else if (m.role === 'assistant') {
      if (m.content) out.push('## Assistant', '', m.content, '');
      if (m.toolCalls?.length) out.push('> tools: ' + m.toolCalls.map((t) => t.name).join(', '), '');
    }
  }
  return out.join('\n');
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
  const focusedRef = useRef(true);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const offF = win.onFocus(() => (focusedRef.current = true));
    const offB = win.onBlur(() => (focusedRef.current = false));
    return () => {
      offF();
      offB();
    };
  }, []);

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

  function renameConversation(id: string, title: string) {
    const conv = convsRef.current.find((c) => c.id === id);
    if (conv) {
      conv.title = title.trim() || conv.title;
      persist();
      bumpNow();
    }
  }

  function togglePin(id: string) {
    const conv = convsRef.current.find((c) => c.id === id);
    if (conv) {
      conv.pinned = !conv.pinned;
      persist();
      bumpNow();
    }
  }

  function duplicateConversation(id: string) {
    const conv = convsRef.current.find((c) => c.id === id);
    if (!conv) return;
    const now = Date.now();
    const copy: Conversation = {
      ...conv,
      id: newId('c'),
      title: conv.title + ' (copy)',
      pinned: false,
      messages: conv.messages.map((m) => ({ ...m })),
      createdAt: now,
      updatedAt: now,
    };
    convsRef.current = [copy, ...convsRef.current];
    setActiveId(copy.id);
    persist();
    bumpNow();
  }

  async function exportConversation(id: string) {
    const conv = convsRef.current.find((c) => c.id === id);
    if (!conv) return;
    try {
      const path = await dialog.saveFile({ defaultName: conv.title.replace(/[\\/:*?"<>|]/g, '_') + '.md' });
      if (path) await fs.writeTextFile(path, conversationToMarkdown(conv));
    } catch {
      /* ignore */
    }
  }

  function clearActive() {
    const conv = getActive();
    if (conv) {
      conv.messages = [];
      conv.todos = undefined;
      conv.updatedAt = Date.now();
      persist();
      bumpNow();
    }
  }

  async function runGitDiff() {
    const conv = getActive() ?? newConversation();
    const cwd = settingsRef.current.workingDir;
    const push = (content: string) => {
      conv.messages.push({ id: newId('a'), role: 'assistant', content, createdAt: Date.now() });
      conv.updatedAt = Date.now();
      bumpNow();
      persist();
    };
    if (!cwd) {
      push('No working directory set — set one in Settings or with /cwd.');
      return;
    }
    try {
      const r = await shell.run('cmd.exe', ['/c', `cd /d "${cwd}" && git --no-pager diff`]);
      const out = (r.stdout || '').trim();
      if (out) push('```diff\n' + out.slice(0, 20000) + '\n```');
      else push((r.stderr || '').trim() || 'No changes (clean working tree, or not a git repository).');
    } catch (e: any) {
      push('git diff failed: ' + (e?.message || String(e)));
    }
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
  async function maybeCompact(conv: Conversation, cfg: Settings, force = false) {
    const msgs = conv.messages;
    if (msgs.length <= KEEP_RECENT_MSGS + 2) return;
    if (!force && totalChars(msgs, cfg.systemPrompt) < COMPACT_CHAR_THRESHOLD) return;

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

  async function compactActive() {
    const conv = getActive();
    if (!conv || generating) return;
    setGenerating(true);
    try {
      await maybeCompact(conv, settingsRef.current, true);
    } finally {
      setGenerating(false);
    }
  }

  async function runTurn(conv: Conversation) {
    setGenerating(true);
    stoppedRef.current = false;
    const startedAt = Date.now();
    const cfg = settingsRef.current;
    let hitToolLimit = false;

    try {
      await maybeCompact(conv, cfg);
      const projectCtx = await loadProjectContext(cfg.workingDir);
      const mode = cfg.agentMode || 'chat';
      const modeText = mode === 'plan' ? PLAN_SYSTEM : mode === 'loop' ? LOOP_SYSTEM : '';
      const turnCfg: Settings = {
        ...cfg,
        systemPrompt: [modeText, projectCtx, cfg.systemPrompt].filter((s) => s && s.trim()).join('\n\n'),
      };
      const maxIters = mode === 'loop' ? LOOP_MAX_ITERS : MAX_TOOL_ITERS;

      for (let iter = 0; iter < maxIters; iter++) {
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
        let activeTools = TOOL_SCHEMAS.filter(
          (s) => toolPerm((s.function as { name: string }).name, settingsRef.current) !== 'off',
        );
        if (mode === 'plan') {
          activeTools = activeTools.filter((s) => !DANGEROUS_TOOLS.includes((s.function as { name: string }).name));
        }
        const handle = streamChat(
          {
            messages: conv.messages.slice(0, -1),
            model: conv.model,
            settings: turnCfg,
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
        if (result.usage?.total_tokens) asst.tokens = result.usage.total_tokens;
        if (result.usage?.prompt_tokens) asst.inputTokens = result.usage.prompt_tokens;
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
          // Loop mode: keep going until the model emits <DONE> or we hit the cap.
          if (mode === 'loop' && !result.cancelled && !stoppedRef.current) {
            if (/<DONE>/i.test(asst.content)) {
              asst.content = asst.content.replace(/<DONE>/gi, '').trim();
              bumpNow();
              persist();
              break;
            }
            if (iter < maxIters - 1) {
              conv.messages.push({
                id: newId('u'),
                role: 'user',
                content: 'Continue.',
                auto: true,
                createdAt: Date.now(),
              });
              bumpNow();
              persist();
              continue;
            }
          }
          break;
        }

        // Execute each requested tool, gating by permission.
        for (const tc of asst.toolCalls) {
          if (stoppedRef.current) break;
          let out = '';
          let isErr = false;
          if (tc.name === 'update_plan') {
            try {
              const a = JSON.parse(tc.arguments || '{}');
              conv.todos = (Array.isArray(a.todos) ? a.todos : [])
                .map((it: any) => ({
                  text: String(it?.text ?? it?.step ?? '').trim(),
                  status: it?.status === 'done' || it?.status === 'doing' ? it.status : 'pending',
                }))
                .filter((it: { text: string }) => it.text);
              out = `Plan updated (${conv.todos?.length ?? 0} steps).`;
            } catch {
              out = 'Invalid plan payload.';
              isErr = true;
            }
          } else if (!isKnownTool(tc.name)) {
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
        if (iter === maxIters - 1) hitToolLimit = true;
      }

      if (hitToolLimit && !stoppedRef.current) {
        conv.messages.push({
          id: newId('e'),
          role: 'assistant',
          content: '',
          error: `Reached the step limit (${maxIters} steps).`,
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
      if (settingsRef.current.notifyOnDone && !focusedRef.current && !stoppedRef.current) {
        const last = [...conv.messages].reverse().find((m) => m.role === 'assistant' && m.content);
        const body = last?.content ? last.content.replace(/\s+/g, ' ').slice(0, 120) : 'Response ready';
        notification.show('DeepSeek', body).catch(() => {});
      }
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
    renameConversation,
    togglePin,
    duplicateConversation,
    exportConversation,
    clearActive,
    compactActive,
    runGitDiff,
    setModel,
    updateSettings,
    approve: () => resolveApproval(true),
    deny: () => resolveApproval(false),
  };
}

export type ChatController = ReturnType<typeof useChat>;
