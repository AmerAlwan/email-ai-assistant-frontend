'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MemoryEvent {
  id: string;
  session_id: string | null;
  description: string | null;
  timestamp: string | null;
  entity_names: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTimestamp(ts: string | null) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function sessionColor(sessionId: string | null) {
  if (!sessionId) return 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400';
  const palette = [
    'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
    'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300',
    'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  ];
  const code = sessionId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return palette[code % palette.length];
}

// ── Confirm delete button ─────────────────────────────────────────────────────

function DeleteButton({ onConfirm }: { onConfirm: () => void }) {
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
        className="shrink-0 rounded-md bg-destructive px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-destructive/80"
      >
        Confirm
      </button>
    );
  }

  return (
    <button
      onClick={handleFirst}
      className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
      aria-label="Delete event"
    >
      <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}

// ── Event card ────────────────────────────────────────────────────────────────

function EventCard({
  event,
  onDelete,
  deleting,
}: {
  event: MemoryEvent;
  onDelete: (id: string) => void;
  deleting: boolean;
}) {
  return (
    <div
      className={[
        'flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-opacity',
        deleting ? 'opacity-40 pointer-events-none' : '',
      ].join(' ')}
    >
      {/* Timeline dot */}
      <div className="mt-1.5 size-2 shrink-0 rounded-full bg-primary/60" />

      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground leading-relaxed">
          {event.description ?? '(no description)'}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* Session badge */}
          {event.session_id && (
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${sessionColor(event.session_id)}`}
            >
              {event.session_id}
            </span>
          )}

          {/* Timestamp */}
          {event.timestamp && (
            <span className="text-[11px] text-muted-foreground">
              {formatTimestamp(event.timestamp)}
            </span>
          )}

          {/* Entity pills */}
          {event.entity_names.map((name) => (
            <span
              key={name}
              className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground"
            >
              {name}
            </span>
          ))}
        </div>
      </div>

      <DeleteButton onConfirm={() => onDelete(event.id)} />
    </div>
  );
}

// ── Main EventsTab ────────────────────────────────────────────────────────────

export function EventsTab() {
  const [events, setEvents] = useState<MemoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextOffset, setNextOffset] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const fetchEvents = useCallback(async (offset?: string) => {
    const isLoadMore = !!offset;
    if (isLoadMore) setLoadingMore(true);
    else setLoading(true);

    try {
      const params = new URLSearchParams({ limit: '50' });
      if (offset) params.set('offset', offset);

      const res = await fetch(`/api/analytics/session-log?${params}`);
      const data = await res.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      setEvents((prev) => (isLoadMore ? [...prev, ...data.events] : data.events));
      setNextOffset(data.next_offset ? String(data.next_offset) : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const handleDelete = async (id: string) => {
    setDeletingIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/analytics/session-log/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setDeletingIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
      } else {
        setEvents((prev) => prev.filter((e) => e.id !== id));
        setDeletingIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      setDeletingIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const filtered = search.trim()
    ? events.filter(
        (e) =>
          e.description?.toLowerCase().includes(search.toLowerCase()) ||
          e.session_id?.toLowerCase().includes(search.toLowerCase()) ||
          e.entity_names.some((n) => n.toLowerCase().includes(search.toLowerCase()))
      )
    : events;

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <svg
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="search"
            placeholder="Filter events…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <span className="text-sm text-muted-foreground shrink-0">
          {filtered.length} event{filtered.length !== 1 ? 's' : ''}
          {search && events.length !== filtered.length && ` of ${events.length}`}
        </span>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex h-32 items-center justify-center">
          <div className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
        </div>
      )}

      {/* Empty */}
      {!loading && !error && filtered.length === 0 && (
        <div className="flex h-32 flex-col items-center justify-center gap-1 text-muted-foreground">
          <svg className="size-6 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 1 1-20 0 10 10 0 0 1 20 0z" />
          </svg>
          <span className="text-sm">{search ? 'No matching events' : 'No events yet'}</span>
        </div>
      )}

      {/* Event list */}
      {!loading && (
        <div className="flex flex-col gap-2">
          {filtered.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              onDelete={handleDelete}
              deleting={deletingIds.has(event.id)}
            />
          ))}
        </div>
      )}

      {/* Load more */}
      {nextOffset && !search && (
        <div className="flex justify-center pt-2">
          <button
            onClick={() => fetchEvents(nextOffset)}
            disabled={loadingMore}
            className="rounded-md border border-border bg-background px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {loadingMore ? (
              <span className="flex items-center gap-2">
                <span className="size-3.5 animate-spin rounded-full border-2 border-border border-t-primary" />
                Loading…
              </span>
            ) : (
              'Load more'
            )}
          </button>
        </div>
      )}
    </div>
  );
}
