import type { Message } from './types';

export type DiffRow = { t: 'ctx' | 'del' | 'add'; s: string };

/** Minimal common-prefix/suffix line diff (same algorithm the tool cards use). */
export function lineDiff(oldStr: string, newStr: string): DiffRow[] {
  // Cap input so a huge write_file/edit_file arg can't freeze render (recomputed often).
  const CAP = 200000;
  const a = (oldStr.length > CAP ? oldStr.slice(0, CAP) : oldStr).split('\n');
  const b = (newStr.length > CAP ? newStr.slice(0, CAP) : newStr).split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const rows: DiffRow[] = [];
  for (let i = 0; i < start; i++) rows.push({ t: 'ctx', s: a[i] });
  for (let i = start; i < endA; i++) rows.push({ t: 'del', s: a[i] });
  for (let i = start; i < endB; i++) rows.push({ t: 'add', s: b[i] });
  for (let i = endA; i < a.length; i++) rows.push({ t: 'ctx', s: a[i] });
  return rows.slice(0, 400);
}

export interface FileChange {
  path: string;
  kind: 'edit' | 'write' | 'excel';
  additions: number;
  deletions: number;
  diff: DiffRow[];
  ok: boolean;
}

const EDIT_TOOLS = new Set(['edit_file', 'write_file', 'write_excel']);

/** Aggregate the file-mutating tool calls in a conversation into a change list. */
export function extractChanges(messages: Message[]): FileChange[] {
  const results = new Map<string, Message>();
  for (const m of messages) if (m.role === 'tool' && m.toolCallId) results.set(m.toolCallId, m);
  const out: FileChange[] = [];
  for (const m of messages) {
    if (m.role !== 'assistant' || !m.toolCalls) continue;
    for (const tc of m.toolCalls) {
      if (!EDIT_TOOLS.has(tc.name)) continue;
      const res = tc.id ? results.get(tc.id) : undefined;
      const ok = !!res && !res.isError;
      let a: any = {};
      try {
        a = JSON.parse(tc.arguments || '{}');
      } catch {
        /* ignore */
      }
      let diff: DiffRow[] = [];
      if (tc.name === 'edit_file') diff = lineDiff(String(a.old_string ?? ''), String(a.new_string ?? ''));
      else if (tc.name === 'write_file') diff = lineDiff('', String(a.content ?? ''));
      out.push({
        path: a.path || '(unknown)',
        kind: tc.name === 'edit_file' ? 'edit' : tc.name === 'write_file' ? 'write' : 'excel',
        additions: diff.filter((r) => r.t === 'add').length,
        deletions: diff.filter((r) => r.t === 'del').length,
        diff,
        ok,
      });
    }
  }
  return out;
}
