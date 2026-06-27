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
  edit_file: '✎',
  write_file: '✎',
  run_command: '❯',
};

export function ToolCallCard({ call, result }: { call: ToolCall; result?: Message }) {
  const { t } = useI18n();
  const { detail } = describeTool(call);
  const [open, setOpen] = useState(false);
  const running = !result;
  const isError = result?.isError;
  const title = t('tool_' + call.name);

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
      {open && result && <pre className="tool-row-out">{result.content}</pre>}
    </div>
  );
}
