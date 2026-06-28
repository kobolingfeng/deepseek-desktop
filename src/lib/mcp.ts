// Minimal MCP client over HTTP (Streamable HTTP transport). Runs in the WebView2
// renderer via fetch (web-security is disabled, so cross-origin works). Only
// HTTP/SSE MCP servers are supported — not stdio (the shell can't keep a pipe open).

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: any;
}

export interface McpServerState {
  name: string;
  url: string;
  sessionId?: string;
  tools: McpTool[];
  ok: boolean;
  error?: string;
}

let nextId = 1;

async function rpc(
  url: string,
  sessionId: string | undefined,
  method: string,
  params: any,
  signal?: AbortSignal,
): Promise<{ result?: any; error?: any; sessionId?: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const reqId = nextId++;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  // Let an external signal (turn Stop / conversation delete) abort this request too.
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: reqId, method, params }),
      signal: ctrl.signal,
    });
    const newSession = resp.headers.get('Mcp-Session-Id') || undefined;
    const ct = resp.headers.get('Content-Type') || '';
    const text = await resp.text();
    let json: any;
    if (ct.includes('text/event-stream')) {
      for (const line of text.split('\n')) {
        const l = line.trim();
        if (l.startsWith('data:')) {
          try {
            const o = JSON.parse(l.slice(5).trim());
            if (o && o.id === reqId) json = o; // only accept the response to THIS request
          } catch {
            /* ignore */
          }
        }
      }
    } else {
      try {
        const o = JSON.parse(text);
        if (o && (o.id === reqId || o.id === undefined || o.id === null)) json = o;
      } catch {
        /* ignore */
      }
    }
    if (!json || typeof json !== 'object') {
      return { error: { message: resp.ok ? 'invalid JSON-RPC response' : `HTTP ${resp.status}` }, sessionId: newSession };
    }
    return { result: json.result, error: json.error, sessionId: newSession };
  } finally {
    clearTimeout(timer);
  }
}

async function notify(url: string, sessionId: string | undefined, method: string): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method }), signal: ctrl.signal });
  } catch {
    /* ignore */
  } finally {
    clearTimeout(timer);
  }
}

export async function connectMcp(name: string, url: string): Promise<McpServerState> {
  try {
    const init = await rpc(url, undefined, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'DeepSeek Desktop', version: '0.1.0' },
    });
    if (init.error) return { name, url, tools: [], ok: false, error: init.error.message || 'initialize failed' };
    const sessionId = init.sessionId;
    await notify(url, sessionId, 'notifications/initialized');
    const list = await rpc(url, sessionId, 'tools/list', {});
    if (list.error) return { name, url, sessionId, tools: [], ok: false, error: list.error.message || 'tools/list failed' };
    // Validate the server's tool list; keep only safely-named tools, capped.
    const raw = Array.isArray(list.result?.tools) ? (list.result.tools as any[]) : [];
    const tools: McpTool[] = raw
      .filter((tooly) => tooly && typeof tooly.name === 'string' && /^[a-zA-Z0-9_-]+$/.test(tooly.name))
      .slice(0, 200)
      .map((tooly) => ({ name: tooly.name, description: tooly.description, inputSchema: tooly.inputSchema }));
    return { name, url, sessionId, tools, ok: true };
  } catch (e: any) {
    return { name, url, tools: [], ok: false, error: e?.message || String(e) };
  }
}

export async function callMcpTool(server: McpServerState, toolName: string, args: any, signal?: AbortSignal): Promise<string> {
  const r = await rpc(server.url, server.sessionId, 'tools/call', { name: toolName, arguments: args }, signal);
  if (r.error) throw new Error(r.error.message || 'tool call failed');
  const content = r.result?.content;
  const out = Array.isArray(content)
    ? content.map((c: any) => (c?.type === 'text' ? c.text : JSON.stringify(c))).join('\n')
    : typeof r.result === 'string'
      ? r.result
      : JSON.stringify(r.result ?? {});
  return out.length > 60000 ? out.slice(0, 60000) + '\n… [truncated]' : out;
}

/** OpenAI-format tool schemas for all connected MCP tools, namespaced mcp__server__tool. */
export function mcpToolSchemas(servers: McpServerState[]): any[] {
  const out: any[] = [];
  for (const s of servers) {
    if (!s.ok) continue;
    for (const tool of s.tools) {
      out.push({
        type: 'function',
        function: {
          name: `mcp__${s.name}__${tool.name}`,
          description: tool.description || '',
          parameters:
            tool.inputSchema && typeof tool.inputSchema === 'object' && !Array.isArray(tool.inputSchema)
              ? tool.inputSchema
              : { type: 'object', properties: {} },
        },
      });
    }
  }
  return out;
}

export function findMcpServer(servers: McpServerState[], fullToolName: string): { server?: McpServerState; tool: string } {
  // mcp__<server>__<tool>
  const m = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(fullToolName);
  if (!m) return { tool: fullToolName };
  return { server: servers.find((s) => s.name === m[1]), tool: m[2] };
}
