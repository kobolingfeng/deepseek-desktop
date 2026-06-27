import { Markdown } from './Markdown';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCallCard } from './ToolCallCard';
import type { Message as Msg } from '../lib/types';

export function Message({
  message,
  toolResults,
}: {
  message: Msg;
  toolResults: Map<string, Msg>;
}) {
  if (message.role === 'user') {
    return (
      <div className="msg user">
        <div className="bubble user-bubble">{message.content}</div>
      </div>
    );
  }

  // assistant
  const streaming = !!message.pending;
  const empty = !message.content && !message.reasoning && !(message.toolCalls && message.toolCalls.length);

  return (
    <div className="msg assistant">
      <div className="avatar" aria-hidden>
        🐋
      </div>
      <div className="assistant-body">
        {message.reasoning && <ThinkingBlock text={message.reasoning} streaming={streaming && !message.content} />}

        {message.toolCalls?.map((tc, i) => (
          <ToolCallCard key={tc.id || `${tc.name}:${i}`} call={tc} result={tc.id ? toolResults.get(tc.id) : undefined} />
        ))}

        {message.content && <Markdown text={message.content} highlight={!streaming} />}

        {streaming && empty && (
          <div className="typing">
            <span />
            <span />
            <span />
          </div>
        )}
        {streaming && !empty && message.content && <span className="caret" />}

        {message.error && <div className="msg-error">⚠ {message.error}</div>}

        {!streaming && message.elapsedMs != null && (message.content || message.error) && (
          <div className="msg-meta">
            {message.model} · {(message.elapsedMs / 1000).toFixed(1)}s
          </div>
        )}
      </div>
    </div>
  );
}
