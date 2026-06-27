import { useState } from 'react';
import { useI18n } from '../lib/i18n';
import type { TodoItem } from '../lib/types';

const MARK: Record<string, string> = { done: '✓', doing: '◐', pending: '○' };

export function TodoPanel({ todos }: { todos: TodoItem[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const done = todos.filter((x) => x.status === 'done').length;
  return (
    <div className="todo-panel">
      <button className="todo-head" onClick={() => setOpen((o) => !o)}>
        <span className="todo-title">📋 {t('planTitle')}</span>
        <span className="todo-count">
          {done}/{todos.length}
        </span>
        <span className="todo-chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="todo-body">
          {todos.map((it, i) => (
            <div key={i} className={`todo-item ${it.status}`}>
              <span className="todo-mark">{MARK[it.status] ?? '○'}</span>
              <span className="todo-text">{it.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
