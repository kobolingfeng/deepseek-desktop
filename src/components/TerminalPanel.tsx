import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { shell } from '../api';

// An interactive terminal backed by a real ConPTY (shell.pty.*). xterm renders; the pty runs
// PowerShell with a proper pseudo-console (prompt, colours, full-screen apps). Output is polled
// (the pty buffer is drained on each read) and keystrokes go straight to the pty's stdin.
export function TerminalPanel({ cwd }: { cwd?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
    const term = new Terminal({
      fontFamily: 'Consolas, "Cascadia Mono", "JetBrains Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: {
        background: v('--bg-sidebar', '#1b1b1d'),
        foreground: v('--text-primary', '#e6e6e6'),
        cursor: v('--accent', '#7aa2f7'),
        selectionBackground: v('--accent-soft', 'rgba(122,162,247,0.3)'),
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try {
      fit.fit();
    } catch {
      /* host not laid out yet */
    }

    let ptyId: number | null = null;
    let poll: number | null = null;
    let disposed = false;

    shell.pty
      .start('powershell.exe', { cwd, cols: term.cols, rows: term.rows })
      .then((res) => {
        if (disposed) {
          shell.pty.kill(res.ptyId).catch(() => {});
          return;
        }
        ptyId = res.ptyId;
        term.onData((d) => {
          if (ptyId != null) shell.pty.write(ptyId, d).catch(() => {});
        });
        poll = window.setInterval(async () => {
          if (ptyId == null) return;
          try {
            const r = await shell.pty.read(ptyId);
            if (r.output) term.write(r.output);
            if (r.exited) {
              if (poll) window.clearInterval(poll);
              poll = null;
              term.write('\r\n\x1b[90m[process exited]\x1b[0m\r\n');
              // Reap now: native only auto-reaps on an EMPTY final read, so a final read that
              // still carried output would otherwise leave the pty + HPCON around until unmount.
              if (ptyId != null) shell.pty.kill(ptyId).catch(() => {});
            }
          } catch {
            /* transient */
          }
        }, 60);
      })
      .catch(() => term.write('\x1b[31mFailed to start terminal.\x1b[0m\r\n'));

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        if (ptyId != null) shell.pty.resize(ptyId, term.cols, term.rows).catch(() => {});
      } catch {
        /* ignore */
      }
    });
    ro.observe(host);

    return () => {
      disposed = true;
      ro.disconnect();
      if (poll) window.clearInterval(poll);
      if (ptyId != null) shell.pty.kill(ptyId).catch(() => {});
      term.dispose();
    };
  }, [cwd]);

  return <div className="terminal-host" ref={hostRef} />;
}
