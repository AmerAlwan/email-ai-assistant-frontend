'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Session {
  session_id: string;
  transcript: string;
  summary: string | null;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Confirm delete button ─────────────────────────────────────────────────────

function DeleteButton({ onConfirm, disabled }: { onConfirm: () => void; disabled?: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFirst = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirming(true);
    timerRef.current = setTimeout(() => setConfirming(false), 2500);
  };

  const handleConfirm = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (timerRef.current) clearTimeout(timerRef.current);
    onConfirm();
  };

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  if (confirming) {
    return (
      <button
        onClick={handleConfirm}
        className="rounded px-2 py-0.5 text-xs font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors"
      >
        Confirm
      </button>
    );
  }
  return (
    <button
      onClick={handleFirst}
      disabled={disabled}
      className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
    >
      Delete
    </button>
  );
}

// ── Session row ───────────────────────────────────────────────────────────────

function SessionRow({
  session,
  selected,
  onSelect,
  onDelete,
  deleting,
}: {
  session: Session;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      className={[
        'w-full text-left px-4 py-3 border-b border-border transition-colors cursor-pointer',
        selected ? 'bg-primary/10' : 'hover:bg-accent',
        deleting ? 'opacity-40 pointer-events-none' : '',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-[10px] text-muted-foreground truncate">{session.session_id}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">{formatDate(session.created_at)}</span>
          </div>
          {session.summary ? (
            <p className="text-sm text-foreground leading-snug line-clamp-2">{session.summary}</p>
          ) : (
            <p className="text-xs text-muted-foreground italic">No summary</p>
          )}
        </div>
        <div className="shrink-0 pt-0.5" onClick={(e) => e.stopPropagation()}>
          <DeleteButton onConfirm={onDelete} disabled={deleting} />
        </div>
      </div>
    </div>
  );
}

// ── Detail pane ───────────────────────────────────────────────────────────────

function SessionDetail({ session, onClose }: { session: Session; onClose: () => void }) {
  const [tab, setTab] = useState<'summary' | 'transcript'>('summary');

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-start justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="min-w-0">
          <div className="text-[10px] font-mono text-muted-foreground truncate">{session.session_id}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{formatDate(session.created_at)}</div>
        </div>
        <button
          onClick={onClose}
          className="ml-2 mt-0.5 rounded-md p-1 text-muted-foreground hover:bg-accent transition-colors"
          aria-label="Close"
        >
          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 px-3 pt-2 pb-1 border-b border-border shrink-0">
        {(['summary', 'transcript'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              'px-2.5 py-1 rounded text-xs font-medium capitalize transition-colors',
              tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
            ].join(' ')}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {tab === 'summary' ? (
          session.summary ? (
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{session.summary}</p>
          ) : (
            <p className="text-xs text-muted-foreground italic">No summary available for this session.</p>
          )
        ) : (
          <pre className="text-xs text-foreground/90 whitespace-pre-wrap font-mono leading-relaxed">{session.transcript}</pre>
        )}
      </div>
    </div>
  );
}

// ── Main SessionsTab ──────────────────────────────────────────────────────────

export function SessionsTab() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/analytics/sessions')
      .then((r) => r.json())
      .then((data: { sessions?: Session[]; error?: string }) => {
        if (data.error) { setError(data.error); return; }
        setSessions(data.sessions ?? []);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = useCallback(async (sessionId: string) => {
    setDeleting((prev) => new Set(prev).add(sessionId));
    if (selectedId === sessionId) setSelectedId(null);
    try {
      await fetch(`/api/analytics/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
      setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
    } finally {
      setDeleting((prev) => { const n = new Set(prev); n.delete(sessionId); return n; });
    }
  }, [selectedId]);

  const selected = sessions.find((s) => s.session_id === selectedId) ?? null;

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-10rem)] items-center justify-center">
        <div className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>
    );
  }

  return (
    <div className="flex gap-0 rounded-xl border border-border overflow-hidden" style={{ height: 'calc(100vh - 8rem)' }}>
      {/* Session list */}
      <div className="flex flex-col w-[380px] shrink-0 border-r border-border">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-background/50 shrink-0">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
            {sessions.length} session{sessions.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={load}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-accent"
          >
            Refresh
          </button>
        </div>

        {sessions.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground px-8 text-center">
            No sessions yet — complete a voice session to see it here
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {sessions.map((s) => (
              <SessionRow
                key={s.session_id}
                session={s}
                selected={selectedId === s.session_id}
                onSelect={() => setSelectedId((prev) => prev === s.session_id ? null : s.session_id)}
                onDelete={() => handleDelete(s.session_id)}
                deleting={deleting.has(s.session_id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail pane */}
      <div className="flex-1 overflow-hidden">
        {selected ? (
          <SessionDetail session={selected} onClose={() => setSelectedId(null)} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select a session to view its summary and transcript
          </div>
        )}
      </div>
    </div>
  );
}
