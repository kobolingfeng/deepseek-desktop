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
      cursorStyle: 'bar', // thin I-beam, not a fat block
      cursorWidth: 2,
      scrollback: 5000,
      theme: {
        // Terminals are conventionally dark; PowerShell/PSReadLine assume a dark console and emit
        // light-coloured input, which was INVISIBLE on the light app theme. Use a fixed dark
        // palette (VS Code's) so typed input + tool colours always show, regardless of app theme.
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: v('--accent', '#5b74f3'),
        cursorAccent: '#1e1e1e',
        selectionBackground: 'rgba(255,255,255,0.22)',
        black: '#1e1e1e',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#d4d4d4',
        brightBlack: '#808080',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff',
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
    let pollTimer: number | null = null;
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
        // Single-flight poll: schedule the next read only AFTER the current one resolves (so slow
        // IPC reads can't pile up), and bail immediately if the panel was disposed mid-await.
        const pump = async () => {
          if (disposed || ptyId == null) return;
          try {
            const r = await shell.pty.read(ptyId);
            if (disposed) return;
            if (r.output) term.write(r.output);
            if (r.exited) {
              term.write('\r\n\x1b[90m[process exited]\x1b[0m\r\n');
              shell.pty.kill(ptyId).catch(() => {});
              return; // stop the loop (native reaps the pty on this exited read)
            }
          } catch {
            if (disposed) return;
          }
          pollTimer = window.setTimeout(pump, 60);
        };
        pump();
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
      if (pollTimer) window.clearTimeout(pollTimer);
      if (ptyId != null) shell.pty.kill(ptyId).catch(() => {});
      term.dispose();
    };
  }, [cwd]);

  return <div className="terminal-host" ref={hostRef} />;
}
