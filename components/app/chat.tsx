'use client';

import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter } from '@assistant-ui/react';
import { Thread } from '@assistant-ui/react-ui';
import '@assistant-ui/react-ui/styles/index.css';
import { useState, useRef, useEffect } from 'react';

type DebugEvent =
  | { type: 'thinking'; value: string }
  | { type: 'debug'; value: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; result: string };

type DebugEntry = { messageIndex: number; event: DebugEvent };

function DebugPanel({ entries }: { entries: DebugEntry[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  if (entries.length === 0) return null;

  let lastIndex = -1;

  return (
    <div className="border-t border-zinc-700 bg-zinc-900 text-xs font-mono text-zinc-300 overflow-y-auto max-h-64 px-3 py-2 space-y-1">
      {entries.map(({ messageIndex, event: e }, i) => {
        const showDivider = messageIndex !== lastIndex;
        lastIndex = messageIndex;
        return (
          <div key={i}>
            {showDivider && i > 0 && (
              <div className="border-t border-zinc-700 my-1 pt-1 text-zinc-600">── message {messageIndex + 1} ──</div>
            )}
            {e.type === 'thinking' && (
              <div className="text-blue-400 italic animate-pulse">{e.value}</div>
            )}
            {e.type === 'debug' && (
              <div className="text-zinc-500 italic">{e.value}</div>
            )}
            {e.type === 'tool_call' && (
              <div className="text-yellow-400">
                → <span className="font-bold">{e.name}</span>
                {' '}
                <span className="text-zinc-400">{JSON.stringify(e.args)}</span>
              </div>
            )}
            {e.type === 'tool_result' && (
              <div className="text-green-400">
                ← <span className="font-bold">{e.name}</span>
                {' '}
                <span className="text-zinc-400">{e.result}</span>
              </div>
            )}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

export function Chat() {
  const [debugEntries, setDebugEntries] = useState<DebugEntry[]>([]);
  const debugEntriesRef = useRef<DebugEntry[]>([]);
  const messageIndexRef = useRef(0);

  const adapter: ChatModelAdapter = {
    async *run({ messages, abortSignal }) {
      const messageIndex = messageIndexRef.current++;

      const payload = messages.map((m) => ({
        role: m.role,
        content: m.content
          .filter((p) => p.type === 'text')
          .map((p) => (p as { type: 'text'; text: string }).text)
          .join(''),
      }));

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: payload }),
        signal: abortSignal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Agent error ${response.status}: ${await response.text()}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let text = '';

      // Replace the last "thinking" entry for this message with the real event
      // so the pulsing indicator disappears once we get a real event.
      const replaceThinking = (next: DebugEvent) => {
        const entries = debugEntriesRef.current;
        const lastIdx = [...entries].reverse().findIndex(
          (e) => e.messageIndex === messageIndex && e.event.type === 'thinking'
        );
        if (lastIdx !== -1) {
          const realIdx = entries.length - 1 - lastIdx;
          const updated = [...entries];
          updated[realIdx] = { messageIndex, event: next };
          debugEntriesRef.current = updated;
        } else {
          debugEntriesRef.current = [...entries, { messageIndex, event: next }];
        }
        setDebugEntries([...debugEntriesRef.current]);
      };

      const appendEntry = (event: DebugEvent) => {
        debugEntriesRef.current = [...debugEntriesRef.current, { messageIndex, event }];
        setDebugEntries([...debugEntriesRef.current]);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') return;
          try {
            const parsed = JSON.parse(data) as {
              type: string;
              value?: string;
              name?: string;
              args?: Record<string, unknown>;
              result?: string;
            };
            if (parsed.type === 'text' && parsed.value) {
              text += parsed.value;
              // Clear any dangling "thinking" indicator now that we have a real response
              const entries = debugEntriesRef.current;
              const lastThinkingIdx = [...entries].reverse().findIndex(
                (e) => e.messageIndex === messageIndex && e.event.type === 'thinking'
              );
              if (lastThinkingIdx !== -1) {
                const realIdx = entries.length - 1 - lastThinkingIdx;
                const updated = [...entries];
                updated.splice(realIdx, 1);
                debugEntriesRef.current = updated;
                setDebugEntries([...debugEntriesRef.current]);
              }
              yield { content: [{ type: 'text', text }] };
            } else if (parsed.type === 'thinking') {
              appendEntry({ type: 'thinking', value: parsed.value! });
            } else if (parsed.type === 'tool_call') {
              replaceThinking({ type: 'tool_call', name: parsed.name!, args: parsed.args ?? {} });
            } else if (parsed.type === 'tool_result') {
              appendEntry({ type: 'tool_result', name: parsed.name!, result: parsed.result ?? '' });
            } else if (parsed.type === 'debug') {
              appendEntry({ type: 'debug', value: parsed.value ?? '' });
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    },
  };

  const runtime = useLocalRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-svh flex-col">
        <Thread />
        <DebugPanel entries={debugEntries} />
      </div>
    </AssistantRuntimeProvider>
  );
}
