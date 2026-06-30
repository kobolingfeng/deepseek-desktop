// Persistence via WebView2's localStorage (survives in the app's user data dir).
import type { Conversation, Group, Profile, Settings } from './types';
import { DEFAULT_SETTINGS } from './types';
import { deriveApprovalMode, defaultToolPermissions } from './tools';

const CONV_KEY = 'deepseek.conversations';
const SETTINGS_KEY = 'deepseek.settings';
const PROFILES_KEY = 'deepseek.profiles';
const GROUPS_KEY = 'deepseek.groups';
const MODELS_KEY = 'deepseek.models';
const PANEL_KEY = 'deepseek.panel';

export interface PanelPrefs {
  width?: number;
  url?: string;
  sidebarWidth?: number;
  sidebarOpen?: boolean;
  zoom?: number;
}

export function loadPanelPrefs(): PanelPrefs {
  try {
    const raw = localStorage.getItem(PANEL_KEY);
    const o = raw ? JSON.parse(raw) : {};
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

export function savePanelPrefs(p: PanelPrefs): void {
  try {
    localStorage.setItem(PANEL_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function loadModels(): string[] {
  try {
    const raw = localStorage.getItem(MODELS_KEY);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveModels(ids: string[]): void {
  try {
    localStorage.setItem(MODELS_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

export function loadGroups(): Group[] {
  try {
    const raw = localStorage.getItem(GROUPS_KEY);
    const list = raw ? (JSON.parse(raw) as Group[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveGroups(g: Group[]): void {
  try {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(g));
  } catch {
    /* ignore */
  }
}

export function loadProfiles(): Record<string, Profile> {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    const o = raw ? JSON.parse(raw) : {};
    if (!o || typeof o !== 'object') return {};
    const out: Record<string, Profile> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      // Validate EVERY field — a profile is spread into live settings on project switch, so a corrupt
      // model/agentMode/toolPermissions/approvalMode would 400 the next request or wedge the UI mode.
      const p = v as Profile;
      const prof: Profile = {
        model: typeof p.model === 'string' && p.model ? p.model : DEFAULT_SETTINGS.model,
        systemPrompt: typeof p.systemPrompt === 'string' ? p.systemPrompt : '',
        agentMode: p.agentMode === 'chat' || p.agentMode === 'plan' || p.agentMode === 'goal' ? p.agentMode : DEFAULT_SETTINGS.agentMode,
        toolPermissions: p.toolPermissions && typeof p.toolPermissions === 'object' ? p.toolPermissions : {},
      };
      if (p.approvalMode === 'read' || p.approvalMode === 'auto' || p.approvalMode === 'full') prof.approvalMode = p.approvalMode;
      out[k] = prof;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveProfiles(p: Record<string, Profile>): void {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    const s = { ...DEFAULT_SETTINGS, ...parsed } as Settings;
    // Migrate to the explicit approvalMode: if older storage didn't have it, FREEZE the
    // user's effective legacy perms by filling missing tools with their per-tool defaults
    // (so newly-added tools don't silently change behavior), then infer the mode (never
    // 'custom' — the map is the source of truth for execution either way).
    if (!parsed.approvalMode) {
      s.toolPermissions = { ...defaultToolPermissions(), ...(s.toolPermissions || {}) };
      const d = deriveApprovalMode(s.toolPermissions);
      s.approvalMode = d === 'custom' ? 'read' : d;
    }
    if (s.approvalMode !== 'read' && s.approvalMode !== 'auto' && s.approvalMode !== 'full') s.approvalMode = 'read';
    // Coerce critical fields so malformed/old storage can't crash render paths.
    if (typeof s.temperature !== 'number' || Number.isNaN(s.temperature)) s.temperature = DEFAULT_SETTINGS.temperature;
    s.mcpServers = Array.isArray(s.mcpServers)
      ? s.mcpServers
          .filter((m: unknown): m is { name: unknown; url: unknown } => !!m && typeof m === 'object')
          // Sanitize the persisted name to the SAME policy as add_mcp_server: it is embedded into
          // OpenAI function names (mcp__<name>__tool), so spaces/punctuation would 400 every request.
          .map((m: { name: unknown; url: unknown }) => ({ name: String(m.name ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64), url: String(m.url ?? '') }))
          .filter((m: { name: string; url: string }) => m.name && m.url)
      : [];
    if (!Array.isArray(s.customCommands)) s.customCommands = [];
    if (!s.toolPermissions || typeof s.toolPermissions !== 'object') s.toolPermissions = { ...DEFAULT_SETTINGS.toolPermissions };
    if (typeof s.model !== 'string' || !s.model) s.model = DEFAULT_SETTINGS.model;
    if (typeof s.globalMemory !== 'string') s.globalMemory = '';
    if (typeof s.workingDir !== 'string') s.workingDir = '';
    // Coerce the remaining scalar fields too — a malformed value here crashes render/turn paths
    // (e.g. systemPrompt.trim() in deepseek.ts, THEME_ICON[theme] in the sidebar).
    if (typeof s.systemPrompt !== 'string') s.systemPrompt = DEFAULT_SETTINGS.systemPrompt;
    if (typeof s.baseUrl !== 'string' || !s.baseUrl) s.baseUrl = DEFAULT_SETTINGS.baseUrl;
    if (typeof s.apiKey !== 'string') s.apiKey = '';
    if (typeof s.searchEndpoint !== 'string') s.searchEndpoint = '';
    if (typeof s.notifyOnDone !== 'boolean') s.notifyOnDone = DEFAULT_SETTINGS.notifyOnDone;
    if (s.theme !== 'system' && s.theme !== 'light' && s.theme !== 'dark') s.theme = DEFAULT_SETTINGS.theme;
    if (s.language !== 'en' && s.language !== 'zh') s.language = DEFAULT_SETTINGS.language;
    if ((s.agentMode as string) === 'loop') s.agentMode = 'goal'; // renamed: loop → goal
    if (s.agentMode !== 'chat' && s.agentMode !== 'plan' && s.agentMode !== 'goal') s.agentMode = DEFAULT_SETTINGS.agentMode;
    return s;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota errors */
  }
}

export function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(CONV_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as Conversation[];
    if (!Array.isArray(list)) return [];
    // Normalize/drop malformed entries so the sidebar can't white-screen.
    return list
      .filter((c) => c && typeof c === 'object' && typeof c.id === 'string' && c.id)
      .map((c): Conversation | null => {
        try {
          const rawMsgs = Array.isArray(c.messages) ? c.messages : [];
          // If the app was closed mid-turn the history can be inconsistent (assistant tool_call with
          // no result, or an orphan tool result), which 400s the next API request. Normalize in
          // SEQUENCE: pair each assistant-with-tool_calls with the tool results that immediately
          // follow it, keep only matched (nonempty-string-id'd) pairs, dedupe by id, and drop any
          // other / empty-id tool message. Every field is guarded — one bad message must not throw.
          const messages: typeof rawMsgs = [];
          for (let i = 0; i < rawMsgs.length; i++) {
            const m = rawMsgs[i];
            if (!m || typeof m !== 'object' || typeof m.role !== 'string') continue;
            if (m.role === 'tool') continue; // a tool result not consumed by a preceding block = orphan
            const tcs = Array.isArray(m.toolCalls)
              ? m.toolCalls.filter((t) => t && typeof t.id === 'string' && t.id && typeof t.name === 'string')
              : [];
            if (m.role === 'assistant' && tcs.length) {
              let j = i + 1;
              const following = [];
              while (j < rawMsgs.length && rawMsgs[j] && rawMsgs[j].role === 'tool') following.push(rawMsgs[j++]);
              const resultIds = new Set(following.filter((r) => typeof r.toolCallId === 'string' && r.toolCallId).map((r) => r.toolCallId));
              // Keep each matched call at most once (duplicate call ids would 400).
              const keptCalls: typeof tcs = [];
              const seenCall = new Set<string>();
              for (const t of tcs) if (resultIds.has(t.id) && !seenCall.has(t.id)) { seenCall.add(t.id); keptCalls.push(t); }
              messages.push({ ...m, toolCalls: keptCalls.length ? keptCalls : undefined, pending: false });
              // Emit exactly one result per kept call id, in order.
              const usedResult = new Set<string>();
              for (const r of following) {
                if (typeof r.toolCallId === 'string' && seenCall.has(r.toolCallId) && !usedResult.has(r.toolCallId)) {
                  usedResult.add(r.toolCallId);
                  messages.push(r.pending ? { ...r, pending: false } : r);
                }
              }
              i = j - 1; // skip the consumed tool results
            } else {
              messages.push(m.pending ? { ...m, pending: false } : m);
            }
          }
          return {
            ...c,
            title: typeof c.title === 'string' ? c.title : 'Chat',
            model: typeof c.model === 'string' && c.model ? c.model : DEFAULT_SETTINGS.model,
            messages,
            createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now(),
            updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : c.createdAt || Date.now(),
            // Transient per-turn state must not survive a reload (no turn is running on load).
            queued: undefined,
            activeTool: undefined,
            turnStartedAt: undefined,
          };
        } catch {
          return null; // one corrupt conversation must never wipe the whole list
        }
      })
      .filter((c): c is Conversation => c !== null);
  } catch {
    return [];
  }
}

export function saveConversations(list: Conversation[]): void {
  try {
    // Cap stored history, but NEVER evict pinned or grouped chats — only the
    // oldest plain ones beyond the cap (list is newest-first).
    const CAP = 50;
    const keep = list.filter((c) => c.pinned || c.groupId);
    const plain = list.filter((c) => !c.pinned && !c.groupId).slice(0, Math.max(20, CAP - keep.length));
    const keepIds = new Set([...keep, ...plain].map((c) => c.id));
    const clean = list
      .filter((c) => keepIds.has(c.id))
      .map((c) => ({ ...c, messages: c.messages.map((m) => ({ ...m, pending: false })) }));
    localStorage.setItem(CONV_KEY, JSON.stringify(clean));
  } catch (e) {
    console.warn('Failed to save conversations', e);
  }
}
