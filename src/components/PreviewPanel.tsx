import { useEffect, useState } from 'react';
import { Pencil, FileSpreadsheet, FilePlus, FileText, TriangleAlert, ExternalLink, RotateCw, Undo2 } from 'lucide-react';
import { fs, shell } from '../api';
import { extractChanges } from '../lib/diff';
import { useI18n } from '../lib/i18n';
import { isPrivateUrl } from '../lib/tools';
import { officePreviewHtml, previewKind, isPreviewableFile } from '../lib/office';
import { Markdown } from './Markdown';
import { TerminalPanel } from './TerminalPanel';
import type { ChatController } from '../lib/useChat';
import type { Conversation } from '../lib/types';

const TABS = ['changes', 'preview', 'tasks', 'terminal'] as const;

export function PreviewPanel({ controller }: { controller: ChatController }) {
  const { t } = useI18n();
  const tab = controller.panelTab;
  // While dragging the resize handle we kill the width transition so it tracks the cursor.
  const [resizing, setResizing] = useState(false);
  const open = controller.panelOpen;
  // Keep the terminal mounted once opened (so its session survives tab switches); just hide it.
  const [termMounted, setTermMounted] = useState(false);
  useEffect(() => {
    if (tab === 'terminal') setTermMounted(true);
  }, [tab]);
  // Re-render on window resize so the width cap below tracks the current window size.
  const [, setTick] = useState(0);
  useEffect(() => {
    const onR = () => setTick((n) => n + 1);
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);

  // Cap the panel so the chat pane always keeps at least MIN_CHAT px — never let it cover the
  // content. `panelW` is the effective width: it also clamps a persisted value that's now too
  // wide for the current window / sidebar width.
  const MIN_PANEL = 240;
  const MIN_CHAT = 360;
  // Only subtract the sidebar's width when it's actually shown (collapsed wrapper is width 0).
  const sidebarW = controller.sidebarOpen ? controller.sidebarWidth : 0;
  const maxPanel = Math.max(MIN_PANEL, window.innerWidth - sidebarW - MIN_CHAT);
  const panelW = Math.min(Math.max(controller.panelWidth, MIN_PANEL), maxPanel);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelW;
    setResizing(true);
    const onMove = (ev: MouseEvent) =>
      controller.setPanelWidth(Math.min(maxPanel, Math.max(MIN_PANEL, startW + (startX - ev.clientX))));
    const onUp = () => {
      setResizing(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // The panel stays mounted; only the outer width animates (0 ↔ panelWidth) so the chat pane
  // glides wider/narrower. The inner keeps a fixed width so its content doesn't reflow while
  // sliding — it's just clipped by the outer's overflow.
  return (
    <aside
      className={`side-panel ${open ? 'open' : 'closed'} ${resizing ? 'resizing' : ''}`}
      style={{ width: open ? panelW : 0 }}
      aria-hidden={!open}
    >
      <div className="side-panel-inner" style={{ width: panelW }}>
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
          {termMounted && (
            <div className="term-wrap" hidden={tab !== 'terminal'}>
              <TerminalPanel cwd={controller.activeConversation?.cwd || controller.settings.workingDir} />
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function ChangesTab({ controller }: { controller: ChatController }) {
  const { t } = useI18n();
  const changes = extractChanges(controller.activeConversation?.messages ?? []);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [undid, setUndid] = useState<number | null>(null);
  const doUndo = async () => {
    if (controller.generating) return; // don't restore a checkpoint mid-turn (would race snapshotEdit)
    const n = await controller.undoLast();
    setUndid(n);
    window.setTimeout(() => setUndid(null), 2500);
  };
  const base = controller.activeConversation?.cwd || controller.settings.workingDir;
  const resolve = (p: string) =>
    /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\')
      ? p
      : base
        ? base.replace(/[\\/]+$/, '') + '\\' + p.replace(/^[\\/]+/, '').replace(/\//g, '\\')
        : p;
  if (!changes.length && !controller.undoCount) return <div className="side-empty">{t('panelNoChanges')}</div>;
  const totA = changes.reduce((s, c) => s + c.additions, 0);
  const totD = changes.reduce((s, c) => s + c.deletions, 0);
  return (
    <div className="changes">
      {controller.undoCount > 0 && (
        <div className="undo-bar">
          <button className="undo-btn" onClick={doUndo} disabled={controller.generating} title={controller.undoLabel || undefined}>
            <Undo2 size={13} strokeWidth={1.9} />
            <span>{t('panelUndo')}</span>
          </button>
          {undid != null && <span className="undo-done">{t('panelUndone', { n: String(undid) })}</span>}
        </div>
      )}
      {changes.length > 0 && (
        <div className="changes-sum">
          {t('panelEditedN', { n: String(changes.length) })} <span className="diff-add">+{totA}</span>{' '}
          <span className="diff-del">-{totD}</span>
        </div>
      )}
      {changes.map((c) => {
        const k = c.id ?? c.path; // unique per change card (same file edited twice → distinct cards)
        return (
        <div className="change-file" key={k}>
          <div className="change-row">
            <button className="change-head" onClick={() => setOpen((o) => ({ ...o, [k]: !o[k] }))}>
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
            <button className="change-open" title={t('ctxOpen')} onClick={() => shell.open(c.abs || resolve(c.path)).catch(() => {})}>
              <ExternalLink size={13} strokeWidth={1.9} />
            </button>
          </div>
          {open[k] && c.diff.length > 0 && (
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
        );
      })}
    </div>
  );
}

function PreviewTab({ controller }: { controller: ChatController }) {
  const { t } = useI18n();
  const [url, setUrl] = useState(controller.previewUrl);
  const [src, setSrc] = useState(controller.previewUrl);
  const [docHtml, setDocHtml] = useState<string | null>(null); // office/image/text → wrapped iframe
  const [rawHtml, setRawHtml] = useState<string | null>(null); // .html file → rendered as a page
  const [mdText, setMdText] = useState<string | null>(null); // .md → React Markdown
  const [loadErr, setLoadErr] = useState('');
  useEffect(() => {
    setUrl(controller.previewUrl);
    setSrc(controller.previewUrl);
  }, [controller.previewUrl]);

  const isHttp = /^https?:\/\//i.test(src);
  const kind = isHttp ? 'web' : previewKind(src); // '' | web | office | image | html | md | text
  const cwd = controller.activeConversation?.cwd;

  // Load + render a local file by kind (web URLs go straight to the <iframe src>).
  useEffect(() => {
    setDocHtml(null);
    setRawHtml(null);
    setMdText(null);
    setLoadErr('');
    if (!src || kind === 'web' || kind === '') return;
    let cancelled = false;
    (async () => {
      try {
        if (kind === 'md') {
          const txt = await fs.readTextFile(src);
          if (!cancelled) setMdText(txt);
        } else if (kind === 'html') {
          const txt = await fs.readTextFile(src);
          if (!cancelled) setRawHtml(txt);
        } else {
          const html = await officePreviewHtml(src); // office / image / text
          if (!cancelled) setDocHtml(html);
        }
      } catch (e: any) {
        if (!cancelled) setLoadErr(e?.message || String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // previewNonce: re-render when the agent rewrites the same file this turn (live refresh).
  }, [kind, src, controller.previewNonce]);

  const go = () => {
    let u = url.trim();
    if (u && !isPreviewableFile(u) && !/^https?:\/\//i.test(u)) u = 'http://' + u;
    setSrc(u);
    controller.setPreviewUrl(u);
  };
  const reload = () => {
    const cur = src;
    setSrc('');
    requestAnimationFrame(() => setSrc(cur));
  };

  const wrappedDoc =
    docHtml == null
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
  .o-slr{position:absolute;width:0;height:0;opacity:0;pointer-events:none;}
  .o-deck.paged{gap:12px;}
  .o-deck.paged .o-slide{display:none;}
  .o-slides{display:block;}
  .o-pager{display:flex;flex-wrap:wrap;gap:5px;justify-content:center;}
  .o-pager label{min-width:28px;text-align:center;padding:4px 9px;font-size:12px;color:#555;cursor:pointer;border:1px solid #d4d4d4;border-radius:6px;background:#ececed;user-select:none;}
  .o-doc{max-width:820px;margin:0 auto;background:#fff;padding:32px 40px;border-radius:5px;box-shadow:0 1px 6px rgba(0,0,0,.09);}
  .o-doc h1{font-size:23px;margin:.3em 0 .5em;} .o-doc h2{font-size:18px;margin:1em 0 .4em;} .o-doc h3{font-size:15px;margin:.9em 0 .35em;}
  .o-doc p{margin:.5em 0;} .o-doc ul,.o-doc ol{margin:.5em 0;padding-left:1.6em;} .o-doc li{margin:.2em 0;}
  .o-doc table{width:auto;} .o-doc strong{font-weight:700;} .o-doc em{font-style:italic;} .o-doc a{color:#2563eb;}
  .o-xlsx .o-tabr{position:absolute;width:0;height:0;opacity:0;pointer-events:none;}
  .o-tabs{display:flex;gap:2px;flex-wrap:wrap;border-bottom:1px solid #d4d4d4;margin-bottom:10px;}
  .o-tabs label{padding:5px 13px;font-size:12px;color:#666;cursor:pointer;border:1px solid transparent;border-bottom:none;border-radius:6px 6px 0 0;background:#e9e9ea;}
  .o-panel{display:none;}
  .o-empty{color:#888;padding:20px;}
  .o-imgwrap{display:flex;justify-content:center;}
  .o-img{max-width:100%;height:auto;display:block;border-radius:6px;box-shadow:0 1px 8px rgba(0,0,0,.12);}
</style></head><body>${docHtml}</body></html>`;

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
          title={kind !== 'web' && kind !== '' ? t('panelOpenFile') : t('panelOpenBrowser')}
        >
          <ExternalLink size={14} strokeWidth={1.9} />
        </button>
      </div>
      {!src ? (
        <div className="side-empty">{t('panelNoPreview')}</div>
      ) : kind === '' ? (
        <div className="side-empty">{t('panelNoPreview')}</div>
      ) : loadErr ? (
        <div className="side-empty">{loadErr}</div>
      ) : kind === 'md' ? (
        mdText == null ? (
          <div className="side-empty">{t('panelLoading')}</div>
        ) : (
          <div className="preview-md markdown">
            <Markdown text={mdText} cwd={cwd} />
          </div>
        )
      ) : kind === 'html' ? (
        rawHtml == null ? (
          <div className="side-empty">{t('panelLoading')}</div>
        ) : (
          <iframe className="preview-frame" srcDoc={rawHtml} title="html preview" sandbox="" />
        )
      ) : kind === 'office' || kind === 'image' || kind === 'text' ? (
        docHtml == null ? (
          <div className="side-empty">{t('panelLoading')}</div>
        ) : (
          <iframe className="preview-frame" srcDoc={wrappedDoc} title="file preview" sandbox="" />
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
