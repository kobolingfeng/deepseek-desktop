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
    // previewNonce: re-render when the agent rewrites the same file this turn (live refresh).
  }, [office, src, controller.previewNonce]);

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
  body{font:13px/1.55 system-ui,Segoe UI,sans-serif;color:#1a1a1a;background:#f3f3f4;margin:0;padding:16px;}
  table{border-collapse:collapse;margin:0 0 18px;font-size:12px;background:#fff;}
  td,th{border:1px solid #d4d4d4;padding:3px 8px;text-align:left;}
  .o-sheet{margin:16px 0 6px;font-size:13px;font-weight:600;color:#333;}
  .o-text{white-space:pre-wrap;font:13px/1.6 system-ui;margin:0;}
  .o-deck{display:flex;flex-direction:column;gap:16px;}
  .o-slide{aspect-ratio:16/9;border:1px solid #d8d8d8;border-radius:10px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.10);padding:5.5% 6.5%;position:relative;overflow:hidden;display:flex;flex-direction:column;}
  .o-slide-no{position:absolute;top:9px;right:13px;font-size:11px;color:#b3b3b3;}
  .o-slide-title{font-size:clamp(17px,3.4vw,30px);font-weight:700;color:#1a1a1a;line-height:1.2;margin-bottom:.55em;}
  .o-slide-body{margin:0;padding-left:1.15em;font-size:clamp(12px,2vw,18px);line-height:1.55;color:#333;}
  .o-slide-body li{margin:.28em 0;}
  .o-doc{max-width:820px;margin:0 auto;background:#fff;padding:32px 40px;border-radius:5px;box-shadow:0 1px 6px rgba(0,0,0,.09);}
  .o-doc h1{font-size:23px;margin:.3em 0 .5em;} .o-doc h2{font-size:18px;margin:1em 0 .4em;} .o-doc h3{font-size:15px;margin:.9em 0 .35em;}
  .o-doc p{margin:.5em 0;} .o-doc ul,.o-doc ol{margin:.5em 0;padding-left:1.6em;} .o-doc li{margin:.2em 0;}
  .o-doc table{width:auto;} .o-doc strong{font-weight:700;} .o-doc em{font-style:italic;} .o-doc a{color:#2563eb;}
  .o-xlsx .o-tabr{position:absolute;width:0;height:0;opacity:0;pointer-events:none;}
  .o-tabs{display:flex;gap:2px;flex-wrap:wrap;border-bottom:1px solid #d4d4d4;margin-bottom:10px;}
  .o-tabs label{padding:5px 13px;font-size:12px;color:#666;cursor:pointer;border:1px solid transparent;border-bottom:none;border-radius:6px 6px 0 0;background:#e9e9ea;}
  .o-panel{display:none;}
  .o-empty{color:#888;padding:20px;}
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
