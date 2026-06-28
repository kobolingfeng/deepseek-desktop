import { useEffect, useState } from 'react';
import { Pencil, FileSpreadsheet, FilePlus, FileText, TriangleAlert, ExternalLink, RotateCw } from 'lucide-react';
import { shell } from '../api';
import { extractChanges } from '../lib/diff';
import { useI18n } from '../lib/i18n';
import { isPrivateUrl } from '../lib/tools';
import { isOfficeFile, officePreviewHtml } from '../lib/office';
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
        {/* No close button here — the fixed top-right panel toggle handles open/close. */}
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
  const base = controller.activeConversation?.cwd || controller.settings.workingDir;
  const resolve = (p: string) =>
    /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\')
      ? p
      : base
        ? base.replace(/[\\/]+$/, '') + '\\' + p.replace(/^[\\/]+/, '').replace(/\//g, '\\')
        : p;
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
          <div className="change-row">
            <button className="change-head" onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}>
              <span className="change-kind">
                {c.kind === 'edit' ? (
                  <Pencil size={13} strokeWidth={1.9} />
                ) : c.kind === 'excel' ? (
                  <FileSpreadsheet size={13} strokeWidth={1.9} />
                ) : c.kind === 'doc' ? (
                  <FileText size={13} strokeWidth={1.9} />
                ) : (
                  <FilePlus size={13} strokeWidth={1.9} />
                )}
              </span>
              <span className="change-path">{c.path}</span>
              {!c.ok && (
                <span className="change-fail" title="failed">
                  <TriangleAlert size={13} strokeWidth={1.9} />
                </span>
              )}
              <span className="change-stat">
                <span className="diff-add">+{c.additions}</span> <span className="diff-del">-{c.deletions}</span>
              </span>
            </button>
            <button className="change-open" title={t('ctxOpen')} onClick={() => shell.open(resolve(c.path)).catch(() => {})}>
              <ExternalLink size={13} strokeWidth={1.9} />
            </button>
          </div>
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
  const [officeHtml, setOfficeHtml] = useState<string | null>(null);
  const [officeErr, setOfficeErr] = useState('');
  useEffect(() => {
    setUrl(controller.previewUrl);
    setSrc(controller.previewUrl);
  }, [controller.previewUrl]);

  const office = isOfficeFile(src);
  // Load + render Office files (xlsx/docx/pptx) as HTML when the target is one.
  useEffect(() => {
    if (!office || !src) {
      setOfficeHtml(null);
      setOfficeErr('');
      return;
    }
    let cancelled = false;
    setOfficeHtml(null);
    setOfficeErr('');
    officePreviewHtml(src)
      .then((html) => {
        if (!cancelled) setOfficeHtml(html);
      })
      .catch((e) => {
        if (!cancelled) setOfficeErr(e?.message || String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [office, src]);

  const go = () => {
    let u = url.trim();
    if (u && !isOfficeFile(u) && !/^https?:\/\//i.test(u)) u = 'http://' + u;
    setSrc(u);
    controller.setPreviewUrl(u);
  };
  const reload = () => {
    const cur = src;
    setSrc('');
    requestAnimationFrame(() => setSrc(cur));
  };

  const officeDoc =
    officeHtml == null
      ? ''
      : `<!doctype html><html><head><meta charset="utf-8"><style>
  body{font:13px/1.55 system-ui,Segoe UI,sans-serif;color:#1a1a1a;background:#fff;margin:0;padding:16px;}
  table{border-collapse:collapse;margin:0 0 18px;font-size:12px;}
  td,th{border:1px solid #d4d4d4;padding:3px 8px;text-align:left;}
  .o-sheet{margin:16px 0 6px;font-size:13px;font-weight:600;color:#333;}
  .o-text{white-space:pre-wrap;font:13px/1.6 system-ui;margin:0;}
  .o-slide{border:1px solid #e2e2e2;border-radius:8px;padding:14px 18px;margin:0 0 12px;box-shadow:0 1px 3px rgba(0,0,0,.06);}
  .o-slide pre{white-space:pre-wrap;margin:0;font:13px/1.55 system-ui;}
</style></head><body>${officeHtml}</body></html>`;

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
          <RotateCw size={14} strokeWidth={1.9} />
        </button>
        <button
          className="ghost"
          onClick={() => src && shell.open(src).catch(() => {})}
          title={office ? t('panelOpenFile') : t('panelOpenBrowser')}
        >
          <ExternalLink size={14} strokeWidth={1.9} />
        </button>
      </div>
      {!src ? (
        <div className="side-empty">{t('panelNoPreview')}</div>
      ) : office ? (
        officeErr ? (
          <div className="side-empty">{officeErr}</div>
        ) : officeHtml == null ? (
          <div className="side-empty">{t('panelLoading')}</div>
        ) : (
          <iframe className="preview-frame" srcDoc={officeDoc} title="office preview" sandbox="" />
        )
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
