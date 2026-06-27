// Tiny global context-menu bus. Anything can call showContextMenu(); a single
// <ContextMenu/> host (mounted in App) listens and renders it.
export interface CtxItem {
  label: string;
  danger?: boolean;
  onClick: () => void;
}

export function showContextMenu(x: number, y: number, items: CtxItem[]): void {
  window.dispatchEvent(new CustomEvent('app:ctxmenu', { detail: { x, y, items } }));
}
