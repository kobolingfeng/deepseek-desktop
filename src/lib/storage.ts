// Persistence via WebView2's localStorage (survives in the app's user data dir).
import type { Conversation, Group, Profile, Settings } from './types';
import { DEFAULT_SETTINGS } from './types';

const CONV_KEY = 'deepseek.conversations';
const SETTINGS_KEY = 'deepseek.settings';
const PROFILES_KEY = 'deepseek.profiles';
const GROUPS_KEY = 'deepseek.groups';
const MODELS_KEY = 'deepseek.models';

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
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
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
    return list;
  } catch {
    return [];
  }
}

export function saveConversations(list: Conversation[]): void {
  try {
    // Drop the transient streaming flag before persisting.
    const clean = list.slice(0, 50).map((c) => ({
      ...c,
      messages: c.messages.map((m) => ({ ...m, pending: false })),
    }));
    localStorage.setItem(CONV_KEY, JSON.stringify(clean));
  } catch (e) {
    console.warn('Failed to save conversations', e);
  }
}
