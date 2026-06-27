// Persistence via WebView2's localStorage (survives in the app's user data dir).
import type { Conversation, Settings } from './types';
import { DEFAULT_SETTINGS } from './types';

const CONV_KEY = 'deepseek.conversations';
const SETTINGS_KEY = 'deepseek.settings';

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
