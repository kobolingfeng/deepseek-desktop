import { useEffect, useState } from 'react';
import type { CtxItem } from '../lib/contextMenu';

interface MenuState {
  x: number;
  y: number;
  items: CtxItem[];
}

export function ContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    const open = (e: Event) => setMenu((e as CustomEvent).detail as MenuState);
    window.addEventListener('app:ctxmenu', open);
    return () => window.removeEventListener('app:ctxmenu', open);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  if (!menu) return null;
  const w = 220;
  const h = menu.items.length * 34 + 8;
  const left = Math.max(6, Math.min(menu.x, window.innerWidth - w - 6));
  const top = Math.max(6, Math.min(menu.y, window.innerHeight - h - 6));

  return (
    <div className="ctx-menu" style={{ left, top }} onMouseDown={(e) => e.stopPropagation()}>
      {menu.items.map((it, i) => (
        <button
          key={i}
          className={`ctx-item ${it.danger ? 'danger' : ''}`}
          onClick={() => {
            setMenu(null);
            it.onClick();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
