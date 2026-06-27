import { useEffect, useState } from 'react';
import { shell } from '../api';
import { extractChanges } from '../lib/diff';
import { useI18n } from '../lib/i18n';
import { isPrivateUrl } from '../lib/tools';
import type { ChatController } from '../lib/useChat';
import type { Conversation } from '../lib/types';

const TABS = ['changes', 'preview', 'tasks'] as const;

export function PreviewPanel({ controller }: { controller: ChatController }) {
  const { t } = useI18n();
  const tab = controller.panelTab;

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = controller.panelWidth;
    const onMove = (ev: MouseEvent) => controller.setPanelWidth(Math.min(900, Math.max(320, startW + (startX - ev.clientX))));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <aside className="side-panel" style={{ width: controller.panelWidth }}>
      <div className="side-resize" onMouseDown={startResize} />
      <div className="side-head">
        <div className="side-tabs">
          {TABS.map((k) => (
            <button key={k} className={`side-tab ${tab === k ? 'active' : ''}`} onClick={() => controller.setPanelTab(k)}>
              {t('panel_' + k)}
            </button>
          ))}
        </div>
        <button className="side-close" onClick={controller.closePanel} title={t('close')}>
          ✕
        </button>
      </div>
      <div className="side-body">
        {tab === 'changes' && <ChangesTab controller={controller} />}
        {tab === 'preview' && <PreviewTab controller={controller} />}
        {tab === 'tasks' && <TasksTab controller={controller} />}
      </div>
    </aside>
  );
}

function ChangesTab({ controller }: { controller: ChatController }) {
  const { t } = useI18n();
  const changes = extractChanges(controller.activeConversation?.messages ?? []);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  if (!changes.length) return <div className="side-empty">{t('panelNoChanges')}</div>;
  const totA = changes.reduce((s, c) => s + c.additions, 0);
  const totD = changes.reduce((s, c) => s + c.deletions, 0);
  return (
    <div className="changes">
      <div className="changes-sum">
        {t('panelEditedN', { n: String(changes.length) })} <span className="diff-add">+{totA}</span>{' '}
        <span className="diff-del">-{totD}</span>
      </div>
      {changes.map((c, i) => (
        <div className="change-file" key={i}>
          <button className="change-head" onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}>
            <span className="change-kind">{c.kind === 'edit' ? '✎' : c.kind === 'excel' ? '▦' : '＋'}</span>
            <span className="change-path">{c.path}</span>
            {!c.ok && <span className="change-fail" title="failed">⚠</span>}
            <span className="change-stat">
              <span className="diff-add">+{c.additions}</span> <span className="diff-del">-{c.deletions}</span>
            </span>
          </button>
          {open[i] && c.diff.length > 0 && (
            <div className="diff">
              {c.diff.map((r, j) => (
                <div key={j} className={`diff-line ${r.t}`}>
                  <span className="diff-sign">{r.t === 'del' ? '-' : r.t === 'add' ? '+' : ' '}</span>
                  {r.s}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PreviewTab({ controller }: { controller: ChatController }) {
  const { t } = useI18n();
  const [url, setUrl] = useState(controller.previewUrl);
  const [src, setSrc] = useState(controller.previewUrl);
  useEffect(() => {
    setUrl(controller.previewUrl);
    setSrc(controller.previewUrl);
  }, [controller.previewUrl]);
  const go = () => {
    let u = url.trim();
    if (u && !/^https?:\/\//i.test(u)) u = 'http://' + u;
    setSrc(u);
    controller.setPreviewUrl(u);
  };
  const reload = () => {
    const cur = src;
    setSrc('');
    requestAnimationFrame(() => setSrc(cur));
  };
  return (
    <div className="preview-tab">
      <div className="preview-bar">
        <input
          value={url}
          placeholder="http://localhost:5173"
          spellCheck={false}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go();
          }}
        />
        <button className="ghost" onClick={go}>
          {t('panelGo')}
        </button>
        <button className="ghost" onClick={reload} title={t('panelReload')}>
          ⟳
        </button>
      </div>
      {!src ? (
        <div className="side-empty">{t('panelNoPreview')}</div>
      ) : isPrivateUrl(src) ? (
        // Only preview local servers in-app: web-security is disabled, so a remote
        // page in this iframe could reach the native IPC bridge. Sandbox as defense.
        <iframe
          className="preview-frame"
          src={src}
          title="preview"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        />
      ) : (
        <div className="side-empty">
          {t('panelRemoteWarn')}
          <br />
          <button className="ghost" style={{ marginTop: 10 }} onClick={() => shell.open(src).catch(() => {})}>
            {t('panelOpenBrowser')}
          </button>
        </div>
      )}
    </div>
  );
}

function TasksTab({ controller }: { controller: ChatController }) {
  const { t } = useI18n();
  const convs = controller.conversations;
  const running = convs.filter((c) => controller.runningIds.has(c.id));
  const unread = convs.filter((c) => controller.unreadIds.has(c.id) && !controller.runningIds.has(c.id));
  if (!running.length && !unread.length) return <div className="side-empty">{t('panelNoTasks')}</div>;
  const row = (c: Conversation) => (
    <button key={c.id} className="task-row" onClick={() => controller.selectConversation(c.id)}>
      {controller.runningIds.has(c.id) ? <span className="conv-spin" /> : <span className="conv-dot" />}
      <span className="task-title">{c.title}</span>
    </button>
  );
  return (
    <div className="tasks">
      {running.length > 0 && (
        <>
          <div className="side-section">{t('panelRunning')}</div>
          {running.map(row)}
        </>
      )}
      {unread.length > 0 && (
        <>
          <div className="side-section">{t('panelDone')}</div>
          {unread.map(row)}
        </>
      )}
    </div>
  );
}
