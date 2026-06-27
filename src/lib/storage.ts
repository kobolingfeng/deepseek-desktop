// Persistence via WebView2's localStorage (survives in the app's user data dir).
import type { Conversation, Group, Profile, Settings } from './types';
import { DEFAULT_SETTINGS } from './types';

const CONV_KEY = 'deepseek.conversations';
const SETTINGS_KEY = 'deepseek.settings';
const PROFILES_KEY = 'deepseek.profiles';
const GROUPS_KEY = 'deepseek.groups';
const MODELS_KEY = 'deepseek.models';
const PANEL_KEY = 'deepseek.panel';

export function loadPanelPrefs(): { width?: number; url?: string } {
  try {
    const raw = localStorage.getItem(PANEL_KEY);
    const o = raw ? JSON.parse(raw) : {};
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

export function savePanelPrefs(p: { width?: number; url?: string }): void {
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
    return raw ? (JSON.parse(raw) as Record<string, Profile>) : {};
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
    const s = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as Settings;
    // Coerce critical fields so malformed/old storage can't crash render paths.
    if (typeof s.temperature !== 'number' || Number.isNaN(s.temperature)) s.temperature = DEFAULT_SETTINGS.temperature;
    if (!Array.isArray(s.mcpServers)) s.mcpServers = [];
    if (!Array.isArray(s.customCommands)) s.customCommands = [];
    if (!s.toolPermissions || typeof s.toolPermissions !== 'object') s.toolPermissions = { ...DEFAULT_SETTINGS.toolPermissions };
    if (typeof s.model !== 'string' || !s.model) s.model = DEFAULT_SETTINGS.model;
    if (typeof s.globalMemory !== 'string') s.globalMemory = '';
    if (typeof s.workingDir !== 'string') s.workingDir = '';
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
      .map((c) => ({
        ...c,
        title: typeof c.title === 'string' ? c.title : 'Chat',
        model: typeof c.model === 'string' && c.model ? c.model : DEFAULT_SETTINGS.model,
        messages: Array.isArray(c.messages) ? c.messages : [],
        createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now(),
        updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : c.createdAt || Date.now(),
      }));
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
