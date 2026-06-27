// DeepSeek chat-completions streaming client.
// Uses the native http.stream bridge inside the WebView2 shell (bypasses CORS),
// and falls back to browser fetch streaming when run in a plain browser (dev preview).
import { http, isNativeRuntime, type StreamEvent } from '../api';
import { newStreamId } from './id';
import { modelSupportsTools, type Message, type ModelId, type Settings, type ToolCall } from './types';

/** Fetch the provider's available model ids from the OpenAI-compatible /models endpoint. */
export async function fetchModels(settings: Settings): Promise<string[]> {
  const baseUrl = (settings.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  const url = `${baseUrl}/models`;
  const headers = { Authorization: `Bearer ${settings.apiKey}`, Accept: 'application/json' };
  let body = '';
  try {
    // Prefer the renderer fetch; fall back to the native HTTP bridge.
    body = await fetch(url, { headers }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))));
  } catch {
    try {
      const r = await http.get(url, headers);
      if (r.status >= 400) return [];
      body = r.body;
    } catch {
      return [];
    }
  }
  try {
    const data = JSON.parse(body);
    const ids = (data?.data || []).map((m: any) => m?.id).filter((x: any) => typeof x === 'string');
    return Array.from(new Set(ids));
  } catch {
    return [];
  }
}

export interface ApiMessage {
  role: string;
  content: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export function toApiMessages(messages: Message[], systemPrompt: string): ApiMessage[] {
  const out: ApiMessage[] = [];
  if (systemPrompt.trim()) out.push({ role: 'system', content: systemPrompt });
  for (const m of messages) {
    if (m.role === 'user') {
      let content = m.content;
      if (m.attachments && m.attachments.length) {
        // Plain delimiters (not XML) so file contents can't break the boundary.
        content += m.attachments
          .map((a) => `\n\n===== Attached file: ${a.path} =====\n${a.content}\n===== End of file: ${a.path} =====`)
          .join('');
      }
      out.push({ role: 'user', content });
    } else if (m.role === 'assistant') {
      // Skip empty placeholder assistant turns (no text and no tool calls).
      if (!m.content && !(m.toolCalls && m.toolCalls.length)) continue;
      const msg: ApiMessage = { role: 'assistant', content: m.content || '' };
      if (m.toolCalls && m.toolCalls.length) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments || '{}' },
        }));
      }
      out.push(msg);
    } else if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.toolCallId || '', content: m.content });
    }
  }
  return out;
}

export interface ChatRequest {
  messages: Message[];
  model: ModelId;
  settings: Settings;
  /** OpenAI-format tool schemas; omit/empty to disable tool calling. */
  tools?: unknown[];
}

export interface StreamCallbacks {
  onOpen?: (status: number) => void;
  onContent?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
  onToolCalls?: (toolCalls: ToolCall[]) => void;
}

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface StreamResult {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
  status: number;
  cancelled?: boolean;
  usage?: Usage | null;
}

function parseError(raw: string, status: number): string {
  try {
    const obj = JSON.parse(raw);
    if (obj?.error?.message) return obj.error.message;
    if (typeof obj?.error === 'string') return obj.error;
  } catch {
    /* not json */
  }
  if (raw && raw.length < 300) return raw;
  return `Request failed (HTTP ${status || '?'})`;
}

export interface StreamHandle {
  promise: Promise<StreamResult>;
  cancel: () => void;
}

export function streamChat(req: ChatRequest, cb: StreamCallbacks = {}): StreamHandle {
  const baseUrl = (req.settings.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;
  const useTools = !!(req.tools && req.tools.length) && modelSupportsTools(req.model);

  const body: Record<string, unknown> = {
    model: req.model,
    messages: toApiMessages(req.messages, req.settings.systemPrompt),
    stream: true,
    stream_options: { include_usage: true },
  };
  if (modelSupportsTools(req.model)) body.temperature = req.settings.temperature;
  if (useTools) {
    body.tools = req.tools;
    body.tool_choice = 'auto';
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${req.settings.apiKey}`,
    Accept: 'text/event-stream',
  };

  // ── Accumulator + SSE parser shared by both transports ──
  let content = '';
  let reasoning = '';
  let finishReason: string | null = null;
  let status = 0;
  let isErrorStatus = false;
  let sseBuf = '';
  let rawErrBuf = '';
  let usage: Usage | null = null;
  const toolCalls: ToolCall[] = [];

  function handleLine(line: string) {
    const t = line.trimStart();
    if (!t.startsWith('data:')) return;
    const payload = t.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let obj: any;
    try {
      obj = JSON.parse(payload);
    } catch {
      return;
    }
    if (obj.usage) usage = obj.usage; // the final usage chunk has an empty choices array
    const choice = obj?.choices?.[0];
    if (!choice) return;
    const d = choice.delta || {};
    if (typeof d.content === 'string' && d.content) {
      content += d.content;
      cb.onContent?.(d.content);
    }
    if (typeof d.reasoning_content === 'string' && d.reasoning_content) {
      reasoning += d.reasoning_content;
      cb.onReasoning?.(d.reasoning_content);
    }
    if (Array.isArray(d.tool_calls)) {
      for (const tcd of d.tool_calls) {
        const idx = typeof tcd.index === 'number' ? tcd.index : 0;
        let slot = toolCalls[idx];
        if (!slot) {
          slot = { id: tcd.id || '', name: '', arguments: '' };
          toolCalls[idx] = slot;
        }
        if (tcd.id) slot.id = tcd.id;
        if (tcd.function?.name) slot.name = tcd.function.name;
        if (typeof tcd.function?.arguments === 'string') slot.arguments += tcd.function.arguments;
      }
      cb.onToolCalls?.(toolCalls.filter(Boolean).map((tc) => ({ ...tc })));
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
  }

  function feed(text: string) {
    if (isErrorStatus) {
      rawErrBuf += text;
      return;
    }
    sseBuf += text;
    let nl: number;
    while ((nl = sseBuf.indexOf('\n')) >= 0) {
      const line = sseBuf.slice(0, nl);
      sseBuf = sseBuf.slice(nl + 1);
      handleLine(line);
    }
  }

  function flushSse() {
    if (!sseBuf) return;
    handleLine(sseBuf);
    sseBuf = '';
  }

  function finalResult(cancelled = false): StreamResult {
    return {
      content,
      reasoning,
      toolCalls: toolCalls.filter(Boolean),
      finishReason: cancelled ? finishReason ?? 'stop' : finishReason,
      status,
      cancelled,
      usage,
    };
  }

  let settled = false;
  let resolveFn!: (r: StreamResult) => void;
  let rejectFn!: (e: Error) => void;
  const promise = new Promise<StreamResult>((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });

  let cancel: () => void;

  if (isNativeRuntime) {
    const id = newStreamId();
    const unsub = http.onStream((e: StreamEvent) => {
      if (e.id !== id || settled) return;
      if (e.type === 'open') {
        status = e.status ?? 0;
        cb.onOpen?.(status);
        if (status >= 400) isErrorStatus = true;
      } else if (e.type === 'chunk') {
        feed(e.data || '');
      } else if (e.type === 'done') {
        settled = true;
        unsub();
        if (isErrorStatus) rejectFn(new Error(parseError(rawErrBuf, status)));
        else {
          flushSse();
          resolveFn(finalResult());
        }
      } else if (e.type === 'error') {
        settled = true;
        unsub();
        rejectFn(new Error(e.error || 'Streaming connection failed'));
      }
    });

    http.stream({ id, url, method: 'POST', headers, body: JSON.stringify(body) }).catch((err: unknown) => {
      if (settled) return;
      settled = true;
      unsub();
      rejectFn(err instanceof Error ? err : new Error(String(err)));
    });

    cancel = () => {
      if (settled) return;
      settled = true;
      unsub();
      http.streamCancel(id).catch(() => {});
      resolveFn(finalResult(true));
    };
  } else {
    // Browser fallback (dev preview). Subject to CORS — may fail against the real API.
    const ctrl = new AbortController();
    (async () => {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        status = resp.status;
        cb.onOpen?.(status);
        if (status >= 400) {
          const txt = await resp.text();
          throw new Error(parseError(txt, status));
        }
        const reader = resp.body?.getReader();
        if (!reader) throw new Error('No response body');
        const dec = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          feed(dec.decode(value, { stream: true }));
        }
        feed(dec.decode());
        flushSse();
        if (!settled) {
          settled = true;
          resolveFn(finalResult());
        }
      } catch (err) {
        if (settled) return;
        if ((err as Error)?.name === 'AbortError') {
          settled = true;
          resolveFn(finalResult(true));
          return;
        }
        settled = true;
        rejectFn(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    cancel = () => {
      if (settled) return;
      ctrl.abort();
    };
  }

  return { promise, cancel };
}
