// Core data model for DeepSeek Desktop.

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export type ModelId = 'deepseek-chat' | 'deepseek-reasoner';

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
  /** Fatal error for this turn (shown in the bubble). */
  error?: string;
  /** Wall-clock ms the turn took (assistant messages). */
  elapsedMs?: number;
}

export interface Conversation {
  id: string;
  title: string;
  model: ModelId;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export type ThemePref = 'system' | 'light' | 'dark';
export type Lang = 'en' | 'zh';
/** Per-tool permission: run freely / ask each time / disabled. */
export type ToolPerm = 'allow' | 'ask' | 'off';

export interface Settings {
  apiKey: string;
  baseUrl: string;
  model: ModelId;
  systemPrompt: string;
  /** Directory tool calls operate in; relative paths resolve against it. */
  workingDir: string;
  /** Per-tool permissions (keyed by tool name). */
  toolPermissions: Record<string, ToolPerm>;
  /** Optional SearXNG endpoint for web_search; empty = keyless DuckDuckGo. */
  searchEndpoint: string;
  /** Sampling temperature for deepseek-chat. */
  temperature: number;
  /** UI language. */
  language: Lang;
  /** Colour theme preference. */
  theme: ThemePref;
}

export const DEFAULT_SYSTEM_PROMPT =
  'You are DeepSeek, a helpful AI assistant running as a native desktop app on the ' +
  "user's Windows machine. You can read and write files and run shell commands through " +
  'the provided tools to help with real tasks. Be concise and accurate. When you use a ' +
  'tool, briefly explain what you are doing. Prefer relative paths inside the working ' +
  'directory. Format answers in Markdown.';

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  workingDir: '',
  toolPermissions: {
    read_file: 'allow',
    list_dir: 'allow',
    web_search: 'allow',
    write_file: 'ask',
    run_command: 'ask',
  },
  searchEndpoint: '',
  temperature: 1.0,
  language: 'en',
  theme: 'system',
};

export const MODELS: { id: ModelId; label: string; blurbKey: string; tools: boolean }[] = [
  { id: 'deepseek-chat', label: 'DeepSeek V3', blurbKey: 'model_chat_blurb', tools: true },
  { id: 'deepseek-reasoner', label: 'DeepSeek R1', blurbKey: 'model_reasoner_blurb', tools: false },
];
