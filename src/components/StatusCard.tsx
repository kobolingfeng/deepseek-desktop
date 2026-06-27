import { useI18n } from '../lib/i18n';
import { deriveApprovalMode } from '../lib/tools';
import type { ChatController } from '../lib/useChat';

export function StatusCard({ controller }: { controller: ChatController }) {
  const { t } = useI18n();
  const s = controller.settings;
  const conv = controller.activeConversation;
  const msgs = conv?.messages ?? [];
  let ctx = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].inputTokens) {
      ctx = msgs[i].inputTokens as number;
      break;
    }
  }
  const count = msgs.filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.auto).length;
  const rows: [string, string][] = [
    [t('statusModel'), conv?.model ?? s.model],
    [t('statusDir'), s.workingDir || '—'],
    [t('statusMode'), s.agentMode],
    [t('statusApproval'), deriveApprovalMode(s.toolPermissions)],
    [t('statusContext'), `${Math.round(ctx / 1000)}k / 64k`],
    [t('statusMessages'), String(count)],
  ];

  return (
    <div className="modal-scrim" onClick={controller.closeStatus}>
      <div className="status-card" onClick={(e) => e.stopPropagation()}>
        <div className="status-card-head">{t('cmdStatus')}</div>
        <div className="status-rows">
          {rows.map(([k, v]) => (
            <div className="status-row" key={k}>
              <span className="status-k">{k}</span>
              <span className="status-v">{v}</span>
            </div>
          ))}
          {controller.mcpStatus.map((m) => (
            <div className="status-row" key={'mcp-' + m.name}>
              <span className="status-k">
                {m.ok ? '🟢' : '🔴'} {m.name}
              </span>
              <span className="status-v">{m.ok ? `${m.tools.length} ${t('mcpTools')}` : m.error || 'failed'}</span>
            </div>
          ))}
        </div>
        <button className="btn-approve status-close" onClick={controller.closeStatus}>
          {t('close')}
        </button>
      </div>
    </div>
  );
}
