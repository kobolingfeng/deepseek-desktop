// Built-in agent tools, executed against the native fs/shell/http APIs.
import { fs, http, shell } from '../api';
import { readOffice, writeExcel } from './office';
import { applySections, parsePatch, patchChanges } from './applyPatch';
import type { Settings, ToolCall, ToolPerm } from './types';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

/** Tool registry: drives the model schema, the permissions UI, and defaults. */
export const TOOL_LIST: { name: string; defaultPerm: ToolPerm }[] = [
  { name: 'read_file', defaultPerm: 'allow' },
  { name: 'list_dir', defaultPerm: 'allow' },
  { name: 'find_files', defaultPerm: 'allow' },
  { name: 'search_files', defaultPerm: 'allow' },
  { name: 'web_search', defaultPerm: 'allow' },
  { name: 'read_url', defaultPerm: 'allow' },
  { name: 'read_office', defaultPerm: 'allow' },
  { name: 'update_plan', defaultPerm: 'allow' },
  { name: 'edit_file', defaultPerm: 'allow' },
  { name: 'write_file', defaultPerm: 'allow' },
  { name: 'apply_patch', defaultPerm: 'allow' },
  { name: 'write_excel', defaultPerm: 'allow' },
  { name: 'run_command', defaultPerm: 'ask' },
  { name: 'start_process', defaultPerm: 'ask' },
  { name: 'read_process', defaultPerm: 'allow' },
  { name: 'write_process', defaultPerm: 'ask' },
  { name: 'stop_process', defaultPerm: 'allow' },
];

export function defaultToolPermissions(): Record<string, ToolPerm> {
  const out: Record<string, ToolPerm> = {};
  for (const tdef of TOOL_LIST) out[tdef.name] = tdef.defaultPerm;
  return out;
}

export function toolPerm(name: string, settings: Settings): ToolPerm {
  return settings.toolPermissions?.[name] ?? TOOL_LIST.find((t) => t.name === name)?.defaultPerm ?? 'ask';
}

export function isKnownTool(name: string): boolean {
  return TOOL_LIST.some((t) => t.name === name);
}

// ── Quick approval modes (composer chip) ──────────────
// Map a single mode onto per-tool permissions; Settings can still fine-tune,
// which makes the composer show "Custom".
// Codex-style presets: Read Only / Auto (default) / Full Access.
export type ApprovalMode = 'read' | 'auto' | 'full';
export const DANGEROUS_TOOLS = ['write_file', 'edit_file', 'write_excel', 'run_command', 'start_process', 'write_process'];
const READONLY_TOOLS = ['read_file', 'list_dir', 'find_files', 'search_files', 'read_office', 'update_plan', 'read_process'];
// Commands that execute/inject shell work — confirmed even in Auto (we have no sandbox).
const CONFIRM_IN_AUTO = ['run_command', 'start_process', 'write_process'];

export function approvalModePerms(mode: ApprovalMode): Record<string, ToolPerm> {
  const out: Record<string, ToolPerm> = {};
  for (const t of TOOL_LIST) {
    if (mode === 'full') out[t.name] = 'allow';
    // Read Only: only reading is free; edits, commands, and web access need approval.
    else if (mode === 'read') out[t.name] = READONLY_TOOLS.includes(t.name) ? 'allow' : 'ask';
    // Auto (default): read + edit files + web freely; shell commands still confirm —
    // unlike Codex we have no command sandbox, so command tools stay gated for safety.
    else out[t.name] = CONFIRM_IN_AUTO.includes(t.name) ? 'ask' : 'allow';
  }
  return out;
}

export function deriveApprovalMode(perms: Record<string, ToolPerm> | undefined): ApprovalMode | 'custom' {
  const p = perms || {};
  for (const mode of ['read', 'auto', 'full'] as ApprovalMode[]) {
    const preset = approvalModePerms(mode);
    if (TOOL_LIST.every((t) => (p[t.name] ?? t.defaultPerm) === preset[t.name])) return mode;
  }
  return 'custom';
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
      name: 'find_files',
      description:
        'Find files by name/glob pattern under the working directory (like glob). Use to locate files. Skips node_modules/.git/dist.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob, e.g. "**/*.ts", "src/*.tsx", "*.json".' },
          path: { type: 'string', description: 'Root to search; defaults to the working directory.' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description:
        'Search file contents for a regular expression under the working directory (like grep). Returns matching file:line lines. Skips node_modules/.git/dist and binary files.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Regular expression to search for.' },
          glob: { type: 'string', description: 'Optional file glob to limit the search, e.g. "**/*.ts".' },
          path: { type: 'string', description: 'Root to search; defaults to the working directory.' },
        },
        required: ['query'],
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
      name: 'read_url',
      description:
        'Open a web page and return its main text content. Use this after web_search to actually read a promising result, or whenever the user gives a URL. Returns readable text with markup stripped.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The full http(s) URL to open.' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_office',
      description:
        'Read the contents of a Microsoft Office document: Excel (.xlsx/.xlsm/.xls/.csv) returns each sheet as CSV; Word (.docx) returns the document text; PowerPoint (.pptx) returns per-slide text. Use this instead of read_file for these formats.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the .xlsx/.docx/.pptx/.csv file, absolute or relative to the working dir.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_plan',
      description:
        'Maintain a visible TODO checklist for a multi-step task. Call it to create or update the plan as you work: list every step with a status. Mark a step "doing" when you start it and "done" when finished. Keep it short.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: 'The full current checklist.',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: 'Step description.' },
                status: { type: 'string', enum: ['pending', 'doing', 'done'] },
              },
              required: ['text', 'status'],
            },
          },
        },
        required: ['todos'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Edit a file by replacing an exact string. Read the file first, then give old_string copied EXACTLY from it (including whitespace/indentation) plus enough surrounding lines to be unique, and new_string to replace it with. This is the primary tool for changing existing files. Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File to edit.' },
          old_string: { type: 'string', description: 'Exact text to replace (copy from the file; include enough surrounding context to be unique).' },
          new_string: { type: 'string', description: 'Replacement text.' },
          replace_all: { type: 'boolean', description: 'Replace every occurrence instead of requiring a unique match.' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create a new file, or overwrite an existing one, with the given full contents. Use for new files; for edits to an existing file prefer edit_file. Requires user approval.',
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
      name: 'write_excel',
      description:
        'Create or overwrite an Excel .xlsx workbook. Provide one or more sheets; each sheet has rows, where each row is an array of cell values (strings or numbers); the first row is typically headers. Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Destination .xlsx file path.' },
          sheets: {
            type: 'array',
            description: 'Sheets to write.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Sheet name.' },
                rows: {
                  type: 'array',
                  description: 'Array of rows; each row is an array of cell values.',
                  items: { type: 'array', items: {} },
                },
              },
              required: ['rows'],
            },
          },
        },
        required: ['path', 'sheets'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        'Run a shell command via PowerShell in the working directory and return its output. Use PowerShell syntax (e.g. Get-ChildItem, Test-Path, Select-String) or just invoke programs (npm, git, node, python). Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The command line to execute.' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_process',
      description:
        'Start a LONG-RUNNING or INTERACTIVE command (a dev server, file watcher, REPL, or anything that keeps running or prompts for input) in a background session via PowerShell. Returns a session_id and the initial output. Use read_process to get more output, write_process to send input to it, and stop_process to terminate it. For commands that finish on their own, use run_command instead. Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The command line to start.' },
          wait_ms: { type: 'number', description: 'How long to wait for initial output before returning (default 1500).' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_process',
      description: 'Read any new output from a background process started with start_process. Optionally wait first for more output to arrive.',
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'number', description: 'The session id returned by start_process.' },
          wait_ms: { type: 'number', description: 'Wait this long for more output before reading (default 0).' },
        },
        required: ['session_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_process',
      description: "Send a line of input to a background process's stdin (answer a prompt, type into a REPL). Returns any new output. Requires user approval.",
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'number', description: 'The session id returned by start_process.' },
          input: { type: 'string', description: 'The text to send.' },
          newline: { type: 'boolean', description: 'Append a newline (Enter). Default true.' },
          wait_ms: { type: 'number', description: 'Wait this long for output after sending (default 1000).' },
        },
        required: ['session_id', 'input'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stop_process',
      description: 'Terminate a background process (and its child processes) started with start_process.',
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'number', description: 'The session id returned by start_process.' },
        },
        required: ['session_id'],
      },
    },
  },
];

function isAbsolute(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/');
}

// Block model-driven fetches of loopback / private-network addresses (SSRF guard);
// web-security is disabled in the WebView, so read_url could otherwise reach internal services.
export function isPrivateUrl(u: string): boolean {
  try {
    const h = new URL(u).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (h === 'localhost' || h === '0.0.0.0' || h === '::1' || h.endsWith('.local') || h.endsWith('.internal')) return true;
    if (h.includes('::ffff:')) return true; // IPv4-mapped IPv6 (evasion)
    if (/^\d+$/.test(h) || /^0x[0-9a-f]+$/i.test(h)) return true; // integer / hex IP form
    const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (m) {
      const a = +m[1], b = +m[2];
      if (a === 0 || a === 127 || a === 10) return true;
      if (a === 192 && b === 168) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 169 && b === 254) return true;
    }
    if (h.includes(':') && (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80'))) return true;
    return false;
  } catch {
    return false;
  }
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Encode a script as base64 of its UTF-16LE bytes for `powershell -EncodedCommand`
// (sidesteps all shell quoting). btoa over a Latin-1 byte string; handles BMP + astral.
function psEncode(script: string): string {
  let bin = '';
  for (let i = 0; i < script.length; i++) {
    const c = script.charCodeAt(i);
    bin += String.fromCharCode(c & 0xff, (c >> 8) & 0xff);
  }
  return btoa(bin);
}

// PowerShell serializes its error stream to a redirected pipe as CLIXML:
// "#< CLIXML\r\n<Objs ...>…</Objs>". Strip only that exact shape so real program output
// that merely contains the text isn't deleted. (A block split across reads may leak —
// acceptable; better than eating genuine output.)
function stripClixml(s: string): string {
  return s.replace(/#< CLIXML\s*<Objs\b[\s\S]*?<\/Objs>/g, '');
}

// Format a session read for the model: output + a status line with the next-step hint.
function formatSession(id: number, r: { output?: string; exited?: boolean; exitCode?: number }): string {
  const out = stripClixml(r.output || '').replace(/\s+$/, '');
  const status = r.exited
    ? `[process exited, code ${r.exitCode ?? 0}; session ${id} closed]`
    : `[process still running — session ${id}; use read_process for more output, write_process to send input, stop_process to terminate]`;
  return truncate((out ? out + '\n' : '') + status, 30000);
}

function safeParse(argsJson: string): any {
  try {
    return JSON.parse(argsJson || '{}');
  } catch {
    return {};
  }
}

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.cache', 'deps', 'target', 'out', '.svn', 'release', '.idea', '.vscode',
]);
const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|ico|bmp|pdf|zip|gz|tar|rar|7z|exe|dll|so|dylib|bin|obj|pdb|lib|exp|woff2?|ttf|otf|eot|mp3|mp4|mov|avi|webm|wasm|class|jar|node|lock)$/i;

/** Breadth-first file walk under root, skipping heavy/vendored dirs. */
async function walkFiles(root: string, max = 4000): Promise<string[]> {
  const out: string[] = [];
  const queue: string[] = [root];
  while (queue.length && out.length < max) {
    const dir = queue.shift() as string;
    let entries;
    try {
      entries = await fs.readDir(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = dir.replace(/[\\/]+$/, '') + '\\' + e.name;
      if (e.isDir) {
        if (!IGNORE_DIRS.has(e.name)) queue.push(full);
      } else {
        out.push(full);
        if (out.length >= max) break;
      }
    }
  }
  return out;
}

function globToRegExp(glob: string): RegExp {
  const g = glob.replace(/\\/g, '/').trim();
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        re += '.*';
        i++;
        if (g[i + 1] === '/') i++;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if ('.+^${}()|[]\\'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp('(^|/)' + re + '$', 'i');
}

function toRel(full: string, rootNorm: string): string {
  const f = full.replace(/\\/g, '/');
  return f.startsWith(rootNorm + '/') ? f.slice(rootNorm.length + 1) : f;
}

/** Relative file paths under the working dir, for @-mention autocomplete. */
export async function listWorkspaceFiles(dir: string): Promise<string[]> {
  if (!dir) return [];
  const rootNorm = dir.replace(/\\/g, '/').replace(/\/+$/, '');
  const files = await walkFiles(dir, 3000);
  return files.map((f) => toRel(f.replace(/\\/g, '/'), rootNorm)).sort();
}

let _entityDecoder: HTMLTextAreaElement | null = null;

// Decode HTML entities. In the renderer we use a <textarea> (handles every named
// + numeric entity); inputs are always tag-stripped first so there is no markup
// to parse. Falls back to a regex map when no DOM is available.
function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  if (typeof document !== 'undefined') {
    if (!_entityDecoder) _entityDecoder = document.createElement('textarea');
    _entityDecoder.innerHTML = s;
    return _entityDecoder.value;
  }
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

function cleanText(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

/** Strip a web page down to readable main text (Readability-lite). */
function htmlToText(html: string): string {
  let s = html;
  s = s
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '');
  // Preserve some structure as newlines.
  s = s.replace(/<\/(p|div|section|article|h[1-6]|li|tr|blockquote)>/gi, '\n').replace(/<br\s*\/?>(?=)/gi, '\n');
  s = decodeEntities(s.replace(/<[^>]+>/g, ' '));
  return s
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

// Prefer the WebView2 renderer's own fetch (real Chromium fingerprint, and with
// web-security disabled it can read cross-origin) so search engines don't serve
// the bot-challenge they give raw WinHttp. Fall back to native WinHttp.
async function timedFetch(url: string, init: RequestInit, ms = 20000, extSignal?: AbortSignal): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const onAbort = () => ctrl.abort();
  if (extSignal) {
    if (extSignal.aborted) ctrl.abort();
    else extSignal.addEventListener('abort', onAbort);
  }
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    extSignal?.removeEventListener('abort', onAbort);
  }
}

async function browserGet(url: string, signal?: AbortSignal): Promise<{ status: number; body: string; finalUrl: string }> {
  try {
    const r = await timedFetch(url, { headers: { Accept: 'application/json, text/html' } }, 20000, signal);
    return { status: r.status, body: await r.text(), finalUrl: r.url || url };
  } catch (e) {
    if (signal?.aborted) throw e; // Stop pressed — don't continue via the uncancellable native path
    const r = await http.get(url, { 'User-Agent': UA });
    return { status: r.status, body: r.body, finalUrl: url };
  }
}

async function browserPostForm(url: string, body: string, signal?: AbortSignal): Promise<{ status: number; body: string }> {
  try {
    const r = await timedFetch(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      },
      20000,
      signal,
    );
    return { status: r.status, body: await r.text() };
  } catch (e) {
    if (signal?.aborted) throw e; // Stop pressed — don't continue via the uncancellable native path
    const r = await http.request({
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
      body,
    });
    return { status: r.status, body: r.body };
  }
}

function normalizeDdgUrl(href: string): string {
  let u = href.trim();
  const mm = u.match(/[?&]uddg=([^&]+)/);
  if (mm) {
    try {
      return decodeURIComponent(mm[1]);
    } catch {
      /* fall through */
    }
  }
  if (u.startsWith('//')) u = 'https:' + u;
  return u;
}

function parseDdgLite(body: string): SearchHit[] {
  const snippets = [...body.matchAll(/result-snippet[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cleanText(m[1]));
  const hits: SearchHit[] = [];
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = anchorRe.exec(body)) && hits.length < 6) {
    if (!/result-link/.test(m[1])) continue; // only DDG result anchors
    const hrefM = m[1].match(/href="([^"]+)"/);
    if (!hrefM) continue;
    const url = normalizeDdgUrl(decodeEntities(hrefM[1]));
    if (!/^https?:\/\//i.test(url)) continue;
    hits.push({ url, title: cleanText(m[2]), snippet: snippets[i] || '' });
    i++;
  }
  return hits;
}

async function webSearch(query: string, settings: Settings, signal?: AbortSignal): Promise<string> {
  const endpoint = (settings.searchEndpoint || '').trim();

  // SearXNG (e.g. self-hosted browser-search stack) — JSON API.
  if (endpoint) {
    const url = `${endpoint.replace(/\/+$/, '')}/search?format=json&q=${encodeURIComponent(query)}`;
    const r = await browserGet(url, signal);
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

  // Keyless default: DuckDuckGo lite. Retry once — it occasionally returns an
  // empty/challenge page that succeeds on a second try.
  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await browserPostForm('https://lite.duckduckgo.com/lite/', `q=${encodeURIComponent(query)}`, signal);
    lastStatus = r.status;
    if (r.status < 400) {
      const hits = parseDdgLite(r.body);
      if (hits.length) return formatResults(query, hits);
    }
    if (attempt === 0) await new Promise((res) => setTimeout(res, 900));
  }
  if (lastStatus >= 400) throw new Error(`Web search failed (HTTP ${lastStatus})`);
  return formatResults(query, []);
}

/** Short human-readable summary of a tool call for cards / approval prompts. */
export function describeTool(tc: ToolCall): { title: string; detail: string } {
  const a = safeParse(tc.arguments);
  switch (tc.name) {
    case 'read_file':
      return { title: 'Read file', detail: a.path || '' };
    case 'list_dir':
      return { title: 'List directory', detail: a.path || '.' };
    case 'find_files':
      return { title: 'Find files', detail: a.pattern || '' };
    case 'search_files':
      return { title: 'Search files', detail: a.query || '' };
    case 'edit_file':
      return { title: 'Edit file', detail: a.path || '' };
    case 'web_search':
      return { title: 'Web search', detail: a.query || '' };
    case 'read_url':
      return { title: 'Read page', detail: a.url || '' };
    case 'read_office':
      return { title: 'Read document', detail: a.path || '' };
    case 'write_excel':
      return { title: 'Write Excel', detail: a.path || '' };
    case 'update_plan':
      return { title: 'Update plan', detail: `${(a.todos || []).length} steps` };
    case 'write_file':
      return { title: 'Write file', detail: a.path || '' };
    case 'apply_patch':
      return { title: 'Apply patch', detail: patchChanges(String(a.patch || '')).map((c) => c.path).join(', ') };
    case 'run_command':
      return { title: 'Run command', detail: a.command || '' };
    case 'start_process':
      return { title: 'Start process', detail: a.command || '' };
    case 'read_process':
      return { title: 'Read process', detail: a.session_id != null ? `session ${a.session_id}` : '' };
    case 'write_process':
      return { title: 'Send input', detail: a.input || '' };
    case 'stop_process':
      return { title: 'Stop process', detail: a.session_id != null ? `session ${a.session_id}` : '' };
    default:
      return { title: tc.name, detail: tc.arguments || '' };
  }
}

export interface ToolCtx {
  cancelId?: number;
  signal?: AbortSignal;
}

export async function executeTool(tc: ToolCall, settings: Settings, ctx: ToolCtx = {}): Promise<string> {
  const args = safeParse(tc.arguments);
  switch (tc.name) {
    case 'read_file': {
      const p = resolvePath(args.path, settings.workingDir);
      if (!p) throw new Error('path is required');
      try {
        const st = await fs.stat(p);
        if (st && st.size > 5_000_000)
          return `(file is ${(st.size / 1e6).toFixed(1)} MB — too large to read whole; use search_files, or read a smaller file)`;
      } catch {
        /* stat unavailable — fall through */
      }
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
      return truncate(await webSearch(q, settings, ctx.signal), 8000);
    }
    case 'read_url': {
      const url = String(args.url || '').trim();
      if (!/^https?:\/\//i.test(url)) throw new Error('a full http(s) url is required');
      if (isPrivateUrl(url)) throw new Error('Refusing to fetch a localhost / private-network address.');
      const r = await browserGet(url, ctx.signal);
      if (isPrivateUrl(r.finalUrl)) throw new Error('Refusing: the URL redirected to a localhost / private-network address.');
      if (r.status >= 400) throw new Error(`Failed to open page (HTTP ${r.status})`);
      const raw = r.body.length > 2_000_000 ? r.body.slice(0, 2_000_000) : r.body;
      if (raw.slice(0, 4000).indexOf(String.fromCharCode(0)) >= 0) return '(the URL did not return readable text)';
      const text = htmlToText(raw);
      return text ? truncate(text, 12000) : '(no readable text found on the page)';
    }
    case 'read_office': {
      const p = resolvePath(args.path, settings.workingDir);
      if (!p) throw new Error('path is required');
      return truncate(await readOffice(p), 60000);
    }
    case 'find_files': {
      const pattern = String(args.pattern || '').trim();
      if (!pattern) throw new Error('pattern is required');
      const root = resolvePath(args.path || '.', settings.workingDir) || settings.workingDir;
      if (!root) throw new Error('no working directory set; set one in Settings or pass an absolute path');
      const re = globToRegExp(pattern);
      const rootNorm = root.replace(/\\/g, '/').replace(/\/+$/, '');
      const matches = (await walkFiles(root))
        .map((f) => f.replace(/\\/g, '/'))
        .filter((f) => re.test(f))
        .map((f) => toRel(f, rootNorm));
      if (!matches.length) return `No files matching "${pattern}" under ${root}`;
      return (
        `Found ${matches.length} file(s):\n` +
        matches.slice(0, 200).join('\n') +
        (matches.length > 200 ? `\n… and ${matches.length - 200} more` : '')
      );
    }
    case 'search_files': {
      const q = String(args.query || '');
      if (!q) throw new Error('query is required');
      let re: RegExp;
      try {
        re = new RegExp(q, 'i');
      } catch {
        throw new Error('invalid regular expression');
      }
      const root = resolvePath(args.path || '.', settings.workingDir) || settings.workingDir;
      if (!root) throw new Error('no working directory set; set one in Settings or pass an absolute path');
      const rootNorm = root.replace(/\\/g, '/').replace(/\/+$/, '');
      const globRe = args.glob ? globToRegExp(String(args.glob)) : null;
      const files = (await walkFiles(root)).filter(
        (f) => !BINARY_EXT.test(f) && (!globRe || globRe.test(f.replace(/\\/g, '/'))),
      );
      const lines: string[] = [];
      let scanned = 0;
      for (const f of files) {
        if (lines.length >= 100 || scanned >= 800) break;
        let content: string;
        try {
          content = await fs.readTextFile(f);
        } catch {
          continue;
        }
        scanned++;
        if (content.length > 1_000_000) continue;
        const fl = content.split('\n');
        for (let i = 0; i < fl.length && lines.length < 100; i++) {
          if (re.test(fl[i])) lines.push(`${toRel(f.replace(/\\/g, '/'), rootNorm)}:${i + 1}: ${fl[i].trim().slice(0, 200)}`);
        }
      }
      if (!lines.length) return `No matches for /${q}/ under ${root}`;
      return `${lines.length} match(es) (scanned ${scanned} files):\n` + lines.join('\n');
    }
    case 'edit_file': {
      const p = resolvePath(args.path, settings.workingDir);
      if (!p) throw new Error('path is required');
      const oldStr = String(args.old_string ?? '');
      const newStr = String(args.new_string ?? '');
      if (!oldStr) throw new Error('old_string is required');
      const content = await fs.readTextFile(p);
      const count = content.split(oldStr).length - 1;
      if (count === 0) throw new Error('old_string was not found in the file');
      if (count > 1 && !args.replace_all)
        throw new Error(`old_string appears ${count} times; pass replace_all:true or add more surrounding context`);
      const updated = args.replace_all ? content.split(oldStr).join(newStr) : content.replace(oldStr, newStr);
      await fs.writeTextFile(p, updated);
      return `Edited ${p} (${count === 1 ? '1 replacement' : count + ' replacements'})`;
    }
    case 'write_file': {
      const p = resolvePath(args.path, settings.workingDir);
      if (!p) throw new Error('path is required');
      const content = typeof args.content === 'string' ? args.content : '';
      await fs.writeTextFile(p, content);
      return `Wrote ${content.length} characters to ${p}`;
    }
    case 'apply_patch': {
      const patch = String(args.patch ?? args.input ?? '');
      if (!patch.trim()) throw new Error('patch is required');
      let ops;
      try {
        ops = parsePatch(patch);
      } catch (e: any) {
        throw new Error('Invalid patch: ' + (e?.message || String(e)));
      }
      const done: string[] = [];
      for (const op of ops) {
        const abs = resolvePath(op.path, settings.workingDir);
        if (!abs) throw new Error('invalid path in patch');
        if (op.kind === 'add') {
          await fs.writeTextFile(abs, op.lines.join('\n'));
          done.push('A ' + op.path);
        } else if (op.kind === 'delete') {
          await fs.remove(abs);
          done.push('D ' + op.path);
        } else {
          const cur = await fs.readTextFile(abs);
          const next = applySections(cur, op.sections);
          const dest = op.moveTo ? resolvePath(op.moveTo, settings.workingDir) : abs;
          await fs.writeTextFile(dest, next);
          if (op.moveTo && dest !== abs) await fs.remove(abs);
          done.push((op.moveTo ? 'M ' : 'U ') + op.path + (op.moveTo ? ' → ' + op.moveTo : ''));
        }
      }
      return 'Patch applied:\n' + done.join('\n');
    }
    case 'write_excel': {
      const p = resolvePath(args.path, settings.workingDir);
      if (!p) throw new Error('path is required');
      const sheets = Array.isArray(args.sheets) ? args.sheets : [];
      if (!sheets.length) throw new Error('sheets is required (array of { name, rows })');
      const rows = await writeExcel(p, sheets);
      return `Wrote ${sheets.length} sheet(s), ${rows} row(s) to ${p}`;
    }
    case 'run_command': {
      const cmd = String(args.command || '').trim();
      if (!cmd) throw new Error('command is required');
      const wd = (settings.workingDir || '').replace(/"/g, '').trim();
      // Run via PowerShell (like Codex). -EncodedCommand (base64 of UTF-16LE) sidesteps
      // all shell quoting; `& { } 2>&1` returns output+errors as plain text. Native
      // commands set $LASTEXITCODE; a pure-cmdlet error leaves it $null, so fall back to
      // $error.Count so a failing cmdlet (e.g. Get-Item missing) reports nonzero, not 0.
      const b64 = psEncode(
        `& {\n${cmd}\n} 2>&1\n$ec = $LASTEXITCODE\nif ($null -eq $ec) { $ec = $(if ($error.Count) { 1 } else { 0 }) }\nexit $ec`,
      );
      const r = await shell.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64], ctx.cancelId, wd || undefined);
      let out = (r.stdout || '').trim();
      // PowerShell serializes its error stream to stderr as CLIXML noise — drop it
      // (genuine native-process stderr still comes through as plain text).
      const err = /^#< CLIXML/.test((r.stderr || '').trim()) ? '' : (r.stderr || '').trim();
      if (err) out += (out ? '\n' : '') + '[stderr]\n' + err;
      out = out.trim();
      out += `${out ? '\n' : ''}[exit code ${r.exitCode}]`;
      return truncate(out, 30000);
    }
    case 'start_process': {
      const cmd = String(args.command || '').trim();
      if (!cmd) throw new Error('command is required');
      const wd = (settings.workingDir || '').replace(/"/g, '').trim();
      // Start the command in a persistent PowerShell session (stdout+stderr merged).
      const { sessionId } = await shell.session.start('powershell.exe', {
        args: ['-NoProfile', '-NoLogo', '-EncodedCommand', psEncode(cmd)],
        cwd: wd || undefined,
      });
      await sleep(Math.min(Math.max(Number(args.wait_ms) || 1500, 0), 15000));
      const r = await shell.session.read(sessionId);
      return formatSession(sessionId, r);
    }
    case 'read_process': {
      const id = Number(args.session_id);
      if (!Number.isFinite(id)) throw new Error('session_id is required');
      if (args.wait_ms) await sleep(Math.min(Math.max(Number(args.wait_ms), 0), 15000));
      const r = await shell.session.read(id);
      if (!r.ok) throw new Error(r.error || 'session not found (it may have been stopped)');
      return formatSession(id, r);
    }
    case 'write_process': {
      const id = Number(args.session_id);
      if (!Number.isFinite(id)) throw new Error('session_id is required');
      const input = String(args.input ?? '');
      const w = await shell.session.write(id, input, args.newline !== false);
      if (!w.ok) throw new Error(w.exited ? 'the process has already exited' : 'session not found');
      await sleep(Math.min(Math.max(Number(args.wait_ms) || 1000, 0), 15000));
      const r = await shell.session.read(id);
      return formatSession(id, r);
    }
    case 'stop_process': {
      const id = Number(args.session_id);
      if (!Number.isFinite(id)) throw new Error('session_id is required');
      const r = await shell.session.kill(id);
      return r.ok ? `Stopped process session ${id}.` : `Session ${id} was not running.`;
    }
    default:
      throw new Error('Unknown tool: ' + tc.name);
  }
}
