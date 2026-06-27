import { useState } from 'react';
import { describeTool } from '../lib/tools';
import { useI18n } from '../lib/i18n';
import type { Message, ToolCall } from '../lib/types';

const ICONS: Record<string, string> = {
  read_file: '📄',
  list_dir: '📁',
  write_file: '✏️',
  run_command: '❯_',
};

export function ToolCallCard({ call, result }: { call: ToolCall; result?: Message }) {
  const { t } = useI18n();
  const { detail } = describeTool(call);
  const [open, setOpen] = useState(false);
  const running = !result;
  const isError = result?.isError;
  const title = t('tool_' + call.name);

  return (
    <div className={`tool-card ${isError ? 'error' : ''} ${running ? 'running' : ''}`}>
      <button className="tool-head" onClick={() => result && setOpen((o) => !o)} disabled={running}>
        <span className="tool-icon">{ICONS[call.name] ?? '⚙'}</span>
        <span className="tool-title">{title}</span>
        {detail && <code className="tool-detail">{detail}</code>}
        <span className="tool-status">
          {running ? <span className="dot-pulse" /> : isError ? t('statusFailed') : t('statusDone')}
        </span>
        {result && <span className="tool-chevron">{open ? '▾' : '▸'}</span>}
      </button>
      {open && result && <pre className="tool-output">{result.content}</pre>}
    </div>
  );
}
