// Core data model for DeepSeek Desktop.

export type Role = 'system' | 'user' | 'assistant' | 'tool';

// Model ids are dynamic — fetched from the provider's /models endpoint at runtime.
export type ModelId = string;

export interface ToolCall {
  /** Provider-assigned id (call_xxx). */
  id: string;
  name: string;
  /** Raw JSON arguments string. Built up incrementally while streaming. */
  arguments: string;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  /** Chain-of-thought from deepseek-reasoner (never sent back to the API). */
  reasoning?: string;
  /** Tool calls requested by an assistant turn. */
  toolCalls?: ToolCall[];
  // For role === 'tool' (a tool result):
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  // Meta / UI:
  model?: ModelId;
  createdAt: number;
  /** True while the assistant message is still streaming. */
  pending?: boolean;
  /** Marks a context-compaction summary message (rendered as a notice). */
  compacted?: boolean;
  /** Auto-generated continuation prompt (goal mode) — hidden from the chat UI. */
  auto?: boolean;
  /** Fatal error for this turn (shown in the bubble). */
  error?: string;
  /** Wall-clock ms the turn took (assistant messages). */
  elapsedMs?: number;
  /** Total tokens reported by the API for this turn. */
  tokens?: number;
  /** Input (prompt) tokens for this turn — reflects current context size. */
  inputTokens?: number;
  /** Files referenced via @mention; their contents are sent to the model. */
  attachments?: { path: string; content: string }[];
}

export type TodoStatus = 'pending' | 'doing' | 'done';
export interface TodoItem {
  text: string;
  status: TodoStatus;
}

export interface Conversation {
  id: string;
  title: string;
  model: ModelId;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  todos?: TodoItem[];
  /** Id of the user-defined group this chat belongs to, if any. */
  groupId?: string;
  /** Archived chats are hidden from the main list (shown under "Archived"). */
  archived?: boolean;
  /** Per-conversation working directory override (falls back to the global one). */
  cwd?: string;
  /** Session type, locked when the first message is sent: 'agent' if a working
   *  directory (project) was chosen, otherwise 'chat'. */
  type?: 'chat' | 'agent';
  /** Name of the tool currently executing this turn (drives the "Searching the web…"
   *  style status indicator); transient, not persisted meaningfully. */
  activeTool?: string;
  /** Messages typed while a turn was running — queued to send after it finishes. */
  queued?: { id: string; text: string }[];
}

/** A conversation is an "agent" session (has a project working dir) vs a plain chat. */
export function isAgentConv(c: Conversation): boolean {
  return c.type ? c.type === 'agent' : !!c.cwd;
}

/** A user-defined conversation group (folder). */
export interface Group {
  id: string;
  name: string;
  collapsed?: boolean;
}

export type ThemePref = 'system' | 'light' | 'dark';
export type Lang = 'en' | 'zh';
/** Per-tool permission: run freely / ask each time / disabled. */
export type ToolPerm = 'allow' | 'ask' | 'off';
/** Agent operating mode: normal chat / plan-only / autonomous goal. */
export type AgentMode = 'chat' | 'plan' | 'goal';

export interface Settings {
  apiKey: string;
  baseUrl: string;
  model: ModelId;
  systemPrompt: string;
  /** Directory tool calls operate in; relative paths resolve against it. */
  workingDir: string;
  /** Per-tool permissions (keyed by tool name). */
  toolPermissions: Record<string, ToolPerm>;
  /** Quick approval preset shown in the composer chip (source of truth for it). */
  approvalMode: 'read' | 'auto' | 'full';
  /** Optional SearXNG endpoint for web_search; empty = keyless DuckDuckGo. */
  searchEndpoint: string;
  /** Sampling temperature for deepseek-chat. */
  temperature: number;
  /** UI language. */
  language: Lang;
  /** Colour theme preference. */
  theme: ThemePref;
  /** Agent operating mode. */
  agentMode: AgentMode;
  /** Show a desktop notification when a reply finishes and the window is unfocused. */
  notifyOnDone: boolean;
  /** User-defined slash commands (name → prompt text). */
  customCommands: { name: string; prompt: string }[];
  /** MCP servers (HTTP transport) to load tools from. */
  mcpServers: { name: string; url: string }[];
  /** Global memory: instructions injected into every conversation, any project. */
  globalMemory: string;
}

/** Per-working-directory profile: settings remembered per project. */
export interface Profile {
  model: ModelId;
  systemPrompt: string;
  agentMode: AgentMode;
  toolPermissions: Record<string, ToolPerm>;
}

// Empty by default — no system prompt is sent unless the user sets one.
export const DEFAULT_SYSTEM_PROMPT = '';

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  workingDir: '',
  // Default approval = Codex-style "Read Only": only local reading is free; edits,
  // commands, and web access need approval. The composer chip is the source of truth
  // (settings.approvalMode); toolPermissions is the matching per-tool map.
  approvalMode: 'read',
  toolPermissions: {
    read_file: 'allow',
    list_dir: 'allow',
    find_files: 'allow',
    search_files: 'allow',
    read_office: 'allow',
    update_plan: 'allow',
    read_process: 'allow',
    web_search: 'ask',
    read_url: 'ask',
    edit_file: 'ask',
    write_file: 'ask',
    write_excel: 'ask',
    run_command: 'ask',
    start_process: 'ask',
    write_process: 'ask',
    stop_process: 'ask',
  },
  searchEndpoint: '',
  temperature: 1.0,
  language: 'en',
  theme: 'system',
  agentMode: 'chat',
  notifyOnDone: true,
  customCommands: [],
  mcpServers: [],
  globalMemory: '',
};

// Offline fallback when /models can't be reached; the live list overrides these.
export const FALLBACK_MODEL_IDS = ['deepseek-v4-flash', 'deepseek-v4-pro'];

/** "deepseek-v4-flash" → "DeepSeek V4 Flash". */
export function prettyModel(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((p) =>
      /^v\d/i.test(p) ? p.toUpperCase() : p.toLowerCase() === 'deepseek' ? 'DeepSeek' : p.charAt(0).toUpperCase() + p.slice(1),
    )
    .join(' ');
}

/** Reasoning-only models can't use function calling; everything else can. */
export function modelSupportsTools(id: string): boolean {
  return !/reason/i.test(id);
}
