import { shell } from '../api';

// Executable / script extensions that must NEVER be launched directly from a click in agent output
// (the model could write/mislabel one). We reveal these in Explorer instead of shell.open-running
// them. Shared by every file-open path (Markdown links, edited-file rows, the changes panel).
export const EXEC_RE = /\.(exe|bat|cmd|com|scr|msi|msp|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|jar|reg|hta|cpl|lnk|msc|pif|gadget|inf)$/i;

/** Open a local file with its default app — but for executables/scripts reveal it in Explorer
 *  (no auto-run). `onReveal` runs when we revealed instead of opened (e.g. to notify the user). */
export function openPathSafely(abs: string, onReveal?: () => void): void {
  if (EXEC_RE.test(abs)) {
    shell.execute('explorer.exe', ['/select,', abs]).catch(() => {});
    onReveal?.();
    return;
  }
  shell.open(abs).catch(() => {});
}
