'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EmailRow {
  id: string;
  from_addr: string | null;
  to_addr: string | null;
  subject: string | null;
  date: string | null;
  labels: string[] | null;
  body_preview: string | null;
  thread_id: string | null;
}

interface EmailFull extends Omit<EmailRow, 'body_preview'> {
  body: string | null;
}

interface FetchResult {
  emails: EmailRow[];
  total: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const LABEL_COLORS: Record<string, string> = {
  inbox: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  sent: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  draft: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  spam: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  trash: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
  important: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  starred: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
};

function labelColor(label: string) {
  return (
    LABEL_COLORS[label.toLowerCase()] ??
    'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
  );
}

function initials(addr: string | null) {
  if (!addr) return '?';
  const name = addr.split('@')[0].replace(/[._-]/g, ' ');
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function avatarColor(addr: string | null) {
  const palette = [
    'bg-rose-500',
    'bg-orange-500',
    'bg-amber-500',
    'bg-lime-600',
    'bg-emerald-600',
    'bg-teal-600',
    'bg-cyan-600',
    'bg-sky-600',
    'bg-blue-600',
    'bg-violet-600',
    'bg-fuchsia-600',
    'bg-pink-600',
  ];
  if (!addr) return palette[0];
  const code = addr.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return palette[code % palette.length];
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function fullDate(dateStr: string | null) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleString([], {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Label pill ────────────────────────────────────────────────────────────────

function LabelPill({ label }: { label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${labelColor(label)}`}
    >
      {label}
    </span>
  );
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ addr }: { addr: string | null }) {
  return (
    <div
      className={`flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${avatarColor(addr)}`}
    >
      {initials(addr)}
    </div>
  );
}

// ── Email list row ─────────────────────────────────────────────────────────────

function EmailRow({
  email,
  selected,
  onClick,
}: {
  email: EmailRow;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'w-full flex items-start gap-3 px-4 py-3 text-left transition-colors border-b border-border',
        selected
          ? 'bg-primary/8 dark:bg-primary/10'
          : 'hover:bg-accent/60',
      ].join(' ')}
    >
      <Avatar addr={email.from_addr} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-foreground">
            {email.from_addr ?? '(no sender)'}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {formatDate(email.date)}
          </span>
        </div>
        <div className="mt-0.5 truncate text-sm text-foreground/80">
          {email.subject ?? '(no subject)'}
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground leading-relaxed">
          {email.body_preview ?? ''}
        </div>
        {email.labels && email.labels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {email.labels.map((l) => (
              <LabelPill key={l} label={l} />
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

// ── Email detail pane ─────────────────────────────────────────────────────────

function EmailDetail({
  emailId,
  onClose,
}: {
  emailId: string;
  onClose: () => void;
}) {
  const [email, setEmail] = useState<EmailFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setEmail(null);
    fetch(`/api/analytics/emails/${encodeURIComponent(emailId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setEmail(data as EmailFull);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [emailId]);

  return (
    <div className="flex h-full flex-col">
      {/* Detail header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          Email
        </span>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          aria-label="Close"
        >
          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {loading && (
        <div className="flex flex-1 items-center justify-center">
          <div className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
        </div>
      )}

      {error && (
        <div className="m-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {email && (
        <div className="flex-1 overflow-y-auto">
          {/* Subject + labels */}
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold text-foreground leading-snug">
              {email.subject ?? '(no subject)'}
            </h2>
            {email.labels && email.labels.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {email.labels.map((l) => (
                  <LabelPill key={l} label={l} />
                ))}
              </div>
            )}
          </div>

          {/* Meta */}
          <div className="border-b border-border px-5 py-4 space-y-2">
            <div className="flex items-start gap-3">
              <Avatar addr={email.from_addr} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{email.from_addr ?? '(unknown)'}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  To: {email.to_addr ?? '—'}
                </div>
                {email.date && (
                  <div className="text-xs text-muted-foreground mt-0.5">{fullDate(email.date)}</div>
                )}
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="px-5 py-5">
            <pre className="whitespace-pre-wrap font-sans text-sm text-foreground/90 leading-relaxed">
              {email.body ?? '(empty body)'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main InboxTab ─────────────────────────────────────────────────────────────

export function InboxTab() {
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const LIMIT = 40;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
    setSelectedId(null);
  }, [debouncedSearch]);

  const fetchEmails = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({
      limit: String(LIMIT),
      offset: String(offset),
    });
    if (debouncedSearch) params.set('search', debouncedSearch);

    fetch(`/api/analytics/emails?${params}`)
      .then((r) => r.json())
      .then((data: FetchResult & { error?: string }) => {
        if (data.error) {
          setError(data.error);
        } else {
          setEmails(data.emails);
          setTotal(data.total);
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [debouncedSearch, offset]);

  useEffect(() => {
    fetchEmails();
  }, [fetchEmails]);

  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  return (
    <div className="flex gap-4 h-[calc(100vh-8rem)]">
      {/* Email list */}
      <div
        className={[
          'flex flex-col rounded-xl border border-border bg-card overflow-hidden',
          selectedId ? 'hidden md:flex md:w-80 lg:w-96 shrink-0' : 'flex-1',
        ].join(' ')}
      >
        {/* List toolbar */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <div className="relative flex-1">
            <svg
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
              />
            </svg>
            <input
              type="search"
              placeholder="Search emails…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <span className="text-[11px] text-muted-foreground shrink-0">
            {total.toLocaleString()} email{total !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Email rows */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex h-20 items-center justify-center">
              <div className="size-5 animate-spin rounded-full border-2 border-border border-t-primary" />
            </div>
          )}

          {error && (
            <div className="m-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {!loading && !error && emails.length === 0 && (
            <div className="flex h-32 flex-col items-center justify-center gap-1 text-muted-foreground">
              <svg className="size-6 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
              </svg>
              <span className="text-sm">No emails found</span>
            </div>
          )}

          {!loading &&
            emails.map((email) => (
              <EmailRow
                key={email.id}
                email={email}
                selected={selectedId === email.id}
                onClick={() => setSelectedId(selectedId === email.id ? null : email.id)}
              />
            ))}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-3 py-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              disabled={offset === 0}
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              ← Prev
            </button>
            <span className="text-xs text-muted-foreground">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setOffset(offset + LIMIT)}
              disabled={offset + LIMIT >= total}
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Detail pane */}
      {selectedId && (
        <div className="flex flex-1 flex-col rounded-xl border border-border bg-card overflow-hidden">
          <EmailDetail emailId={selectedId} onClose={() => setSelectedId(null)} />
        </div>
      )}
    </div>
  );
}
