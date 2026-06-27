// Built-in agent tools, executed against the native fs/shell/http APIs.
import { fs, http, shell } from '../api';
import type { Settings, ToolCall, ToolPerm } from './types';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

/** Tool registry: drives the model schema, the permissions UI, and defaults. */
export const TOOL_LIST: { name: string; defaultPerm: ToolPerm }[] = [
  { name: 'read_file', defaultPerm: 'allow' },
  { name: 'list_dir', defaultPerm: 'allow' },
  { name: 'web_search', defaultPerm: 'allow' },
  { name: 'write_file', defaultPerm: 'ask' },
  { name: 'run_command', defaultPerm: 'ask' },
];

export function defaultToolPermissions(): Record<string, ToolPerm> {
  const out: Record<string, ToolPerm> = {};
  for (const tdef of TOOL_LIST) out[tdef.name] = tdef.defaultPerm;
  return out;
}

export function toolPerm(name: string, settings: Settings): ToolPerm {
  return settings.toolPermissions?.[name] ?? TOOL_LIST.find((t) => t.name === name)?.defaultPerm ?? 'ask';
}

export const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a UTF-8 text file and return its contents.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path, absolute or relative to the working directory.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List the files and folders inside a directory.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path; defaults to the working directory.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the web for up-to-date information. Call this on your own whenever the question may depend on current events, recent data, prices, releases, news, library/API docs, or anything that could have changed after your training or that you are unsure about. Returns the top results with titles, URLs and snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a UTF-8 text file. Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Destination file path.' },
          content: { type: 'string', description: 'Full file contents to write.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        'Run a shell command via cmd.exe in the working directory and return stdout/stderr. Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The command line to execute.' },
        },
        required: ['command'],
      },
    },
  },
];

function isAbsolute(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/');
}

function resolvePath(p: string, base: string): string {
  const t = (p || '').trim();
  if (!base || isAbsolute(t)) return t;
  return base.replace(/[\\/]+$/, '') + '\\' + t.replace(/^[\\/]+/, '');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n… [truncated ${s.length - max} more characters]`;
}

function safeParse(argsJson: string): any {
  try {
    return JSON.parse(argsJson || '{}');
  } catch {
    return {};
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function cleanText(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

function formatResults(query: string, hits: SearchHit[]): string {
  if (!hits.length) {
    return `No results for "${query}". The search backend may be rate-limiting; try again, or set a SearXNG endpoint in Settings.`;
  }
  return (
    `Web search results for "${query}":\n\n` +
    hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}${h.snippet ? '\n   ' + h.snippet : ''}`).join('\n\n')
  );
}

async function webSearch(query: string, settings: Settings): Promise<string> {
  const endpoint = (settings.searchEndpoint || '').trim();

  // SearXNG (e.g. self-hosted browser-search stack) — JSON API.
  if (endpoint) {
    const url = `${endpoint.replace(/\/+$/, '')}/search?format=json&q=${encodeURIComponent(query)}`;
    const r = await http.get(url, { 'User-Agent': UA, Accept: 'application/json' });
    if (r.status >= 400) throw new Error(`Search endpoint returned HTTP ${r.status}`);
    let data: any;
    try {
      data = JSON.parse(r.body);
    } catch {
      throw new Error('Search endpoint did not return JSON (is it SearXNG with JSON enabled?)');
    }
    const hits: SearchHit[] = (data.results || [])
      .slice(0, 6)
      .map((x: any) => ({ title: x.title || x.url, url: x.url, snippet: x.content || '' }));
    return formatResults(query, hits);
  }

  // Keyless default: DuckDuckGo lite.
  const r = await http.request({
    url: 'https://lite.duckduckgo.com/lite/',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: `q=${encodeURIComponent(query)}`,
  });
  if (r.status >= 400) throw new Error(`Web search failed (HTTP ${r.status})`);

  const snippets = [...r.body.matchAll(/result-snippet[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cleanText(m[1]));
  const linkRe = /<a\s+rel="nofollow"[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const hits: SearchHit[] = [];
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = linkRe.exec(r.body)) && hits.length < 6) {
    hits.push({ url: decodeEntities(m[1]), title: cleanText(m[2]), snippet: snippets[i] || '' });
    i++;
  }
  return formatResults(query, hits);
}

/** Short human-readable summary of a tool call for cards / approval prompts. */
export function describeTool(tc: ToolCall): { title: string; detail: string } {
  const a = safeParse(tc.arguments);
  switch (tc.name) {
    case 'read_file':
      return { title: 'Read file', detail: a.path || '' };
    case 'list_dir':
      return { title: 'List directory', detail: a.path || '.' };
    case 'web_search':
      return { title: 'Web search', detail: a.query || '' };
    case 'write_file':
      return { title: 'Write file', detail: a.path || '' };
    case 'run_command':
      return { title: 'Run command', detail: a.command || '' };
    default:
      return { title: tc.name, detail: tc.arguments || '' };
  }
}

export async function executeTool(tc: ToolCall, settings: Settings): Promise<string> {
  const args = safeParse(tc.arguments);
  switch (tc.name) {
    case 'read_file': {
      const p = resolvePath(args.path, settings.workingDir);
      if (!p) throw new Error('path is required');
      const content = await fs.readTextFile(p);
      return content === '' ? '(empty file)' : truncate(content, 60000);
    }
    case 'list_dir': {
      const p = resolvePath(args.path || '.', settings.workingDir);
      const entries = await fs.readDir(p);
      if (!entries.length) return '(empty directory)';
      return entries
        .sort((x, y) => Number(y.isDir) - Number(x.isDir) || x.name.localeCompare(y.name))
        .map((e) => (e.isDir ? '[DIR] ' : '      ') + e.name)
        .join('\n');
    }
    case 'web_search': {
      const q = String(args.query || '').trim();
      if (!q) throw new Error('query is required');
      return truncate(await webSearch(q, settings), 8000);
    }
    case 'write_file': {
      const p = resolvePath(args.path, settings.workingDir);
      if (!p) throw new Error('path is required');
      const content = typeof args.content === 'string' ? args.content : '';
      await fs.writeTextFile(p, content);
      return `Wrote ${content.length} characters to ${p}`;
    }
    case 'run_command': {
      const cmd = String(args.command || '').trim();
      if (!cmd) throw new Error('command is required');
      const full = settings.workingDir ? `cd /d "${settings.workingDir}" && ${cmd}` : cmd;
      const r = await shell.run('cmd.exe', ['/c', full]);
      let out = r.stdout || '';
      if (r.stderr) out += (out ? '\n' : '') + '[stderr]\n' + r.stderr;
      out = out.trim();
      out += `${out ? '\n' : ''}[exit code ${r.exitCode}]`;
      return truncate(out, 30000);
    }
    default:
      throw new Error('Unknown tool: ' + tc.name);
  }
}
