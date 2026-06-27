import { useState } from 'react';
import { describeTool } from '../lib/tools';
import { useI18n } from '../lib/i18n';
import type { Message, ToolCall } from '../lib/types';

const ICONS: Record<string, string> = {
  read_file: '📄',
  list_dir: '📁',
  find_files: '🔎',
  search_files: '🔎',
  web_search: '🌐',
  read_url: '🌐',
  update_plan: '📋',
  edit_file: '✎',
  write_file: '✎',
  run_command: '❯',
};

type DiffRow = { t: 'ctx' | 'del' | 'add'; s: string };

function lineDiff(oldStr: string, newStr: string): DiffRow[] {
  // Empty string = zero lines (avoids a phantom +1/-1 for new/cleared files).
  const a = oldStr === '' ? [] : oldStr.split('\n');
  const b = newStr === '' ? [] : newStr.split('\n');
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
  return rows.slice(0, 300);
}

export function ToolCallCard({ call, result }: { call: ToolCall; result?: Message }) {
  const { t } = useI18n();
  const { detail } = describeTool(call);
  const [open, setOpen] = useState(false);
  const running = !result;
  const isError = result?.isError;
  const title = t('tool_' + call.name);

  let diff: DiffRow[] | null = null;
  if (open && result && !isError && (call.name === 'edit_file' || call.name === 'write_file')) {
    try {
      const a = JSON.parse(call.arguments || '{}');
      diff =
        call.name === 'edit_file'
          ? lineDiff(String(a.old_string ?? ''), String(a.new_string ?? ''))
          : lineDiff('', String(a.content ?? ''));
    } catch {
      diff = null;
    }
  }

  return (
    <div className={`tool-row ${isError ? 'error' : ''}`}>
      <button className="tool-row-head" onClick={() => result && setOpen((o) => !o)} disabled={running}>
        {running ? (
          <span className="tool-row-spin" />
        ) : (
          <span className="tool-row-ico">{ICONS[call.name] ?? '⚙'}</span>
        )}
        <span className="tool-row-title">{title}</span>
        {detail && <code className="tool-row-detail">{detail}</code>}
        {result && <span className="tool-row-chev">{open ? '▾' : '›'}</span>}
      </button>
      {open && result &&
        (diff ? (
          <div className="diff">
            {diff.map((r, i) => (
              <div key={i} className={`diff-line ${r.t}`}>
                <span className="diff-sign">{r.t === 'del' ? '-' : r.t === 'add' ? '+' : ' '}</span>
                {r.s}
              </div>
            ))}
          </div>
        ) : (
          <pre className="tool-row-out">{result.content}</pre>
        ))}
    </div>
  );
}
