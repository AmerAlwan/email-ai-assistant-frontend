'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ── Danger action card ────────────────────────────────────────────────────────

type ActionState = 'idle' | 'confirming' | 'loading' | 'success' | 'error';

function DangerAction({
  title,
  description,
  buttonLabel,
  onConfirm,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  onConfirm: () => Promise<string>;
}) {
  const [state, setState] = useState<ActionState>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const handleClick = () => {
    if (state === 'idle') { setState('confirming'); return; }
    if (state === 'confirming') {
      setState('loading');
      setMessage(null);
      onConfirm()
        .then((msg) => { setMessage(msg); setState('success'); })
        .catch((e: Error) => { setMessage(e.message); setState('error'); });
    }
  };

  const handleCancel = () => setState('idle');

  const buttonStyles: Record<ActionState, string> = {
    idle:       'bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/30',
    confirming: 'bg-destructive text-white hover:bg-destructive/90',
    loading:    'bg-destructive/40 text-destructive/70 cursor-not-allowed',
    success:    'bg-green-100 text-green-700 border border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700',
    error:      'bg-destructive/10 text-destructive border border-destructive/30',
  };

  const buttonText: Record<ActionState, string> = {
    idle:       buttonLabel,
    confirming: 'Click again to confirm',
    loading:    'Working…',
    success:    'Done',
    error:      'Retry',
  };

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{description}</p>
          {message && (
            <p className={`mt-2 text-xs ${state === 'error' ? 'text-destructive' : 'text-green-600 dark:text-green-400'}`}>
              {message}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {state === 'confirming' && (
            <button
              onClick={handleCancel}
              className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleClick}
            disabled={state === 'loading'}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${buttonStyles[state]}`}
          >
            {buttonText[state]}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Prompt Editor ─────────────────────────────────────────────────────────────

function PromptEditor() {
  const [text, setText] = useState('');
  const [original, setOriginal] = useState('');
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveMsg, setSaveMsg] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [preview, setPreview] = useState<{ full_prompt: string; has_context: boolean; context_chars: number } | null>(null);
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'error'>('idle');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    setLoadState('loading');
    try {
      const res = await fetch('/api/analytics/prompt', { cache: 'no-store' });
      const data = await res.json() as { text?: string; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? 'Failed to load');
      setText(data.text ?? '');
      setOriginal(data.text ?? '');
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaveState('saving');
    setSaveMsg('');
    try {
      const res = await fetch('/api/analytics/prompt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? 'Save failed');
      setOriginal(text);
      setSaveState('saved');
      setSaveMsg('Saved — changes take effect on the next session start.');
      setTimeout(() => setSaveState('idle'), 3000);
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : 'Save failed');
      setSaveState('error');
    }
  };

  const handlePreview = async () => {
    if (showPreview) { setShowPreview(false); return; }
    setShowPreview(true);
    if (preview) return; // already loaded
    setPreviewState('loading');
    try {
      const res = await fetch('/api/analytics/prompt/preview', { cache: 'no-store' });
      const data = await res.json() as { full_prompt?: string; has_context?: boolean; context_chars?: number; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? 'Failed to load preview');
      setPreview({ full_prompt: data.full_prompt ?? '', has_context: data.has_context ?? false, context_chars: data.context_chars ?? 0 });
      setPreviewState('idle');
    } catch {
      setPreviewState('error');
    }
  };

  const refreshPreview = async () => {
    setPreview(null);
    setPreviewState('loading');
    try {
      const res = await fetch('/api/analytics/prompt/preview', { cache: 'no-store' });
      const data = await res.json() as { full_prompt?: string; has_context?: boolean; context_chars?: number; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? 'Failed to load preview');
      setPreview({ full_prompt: data.full_prompt ?? '', has_context: data.has_context ?? false, context_chars: data.context_chars ?? 0 });
      setPreviewState('idle');
    } catch {
      setPreviewState('error');
    }
  };

  const isDirty = text !== original;

  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Agent Instructions</h3>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            System prompt passed to the agent on every session start. Changes take effect on the next session.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={handlePreview}
            className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent border border-border transition-colors"
          >
            {showPreview ? 'Hide Preview' : 'Preview Full Prompt'}
          </button>
          <button
            onClick={handleSave}
            disabled={!isDirty || saveState === 'saving' || loadState !== 'ready'}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              saveState === 'saved'
                ? 'bg-green-100 text-green-700 border border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700'
                : saveState === 'error'
                ? 'bg-destructive/10 text-destructive border border-destructive/30'
                : isDirty && saveState !== 'saving'
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-accent text-muted-foreground cursor-not-allowed'
            }`}
          >
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>

      {saveMsg && (
        <p className={`text-xs ${saveState === 'error' ? 'text-destructive' : 'text-green-600 dark:text-green-400'}`}>
          {saveMsg}
        </p>
      )}

      {loadState === 'loading' && (
        <div className="h-48 rounded border border-border bg-muted/30 animate-pulse" />
      )}
      {loadState === 'error' && (
        <div className="flex items-center gap-2">
          <p className="text-xs text-destructive">Failed to load prompt.</p>
          <button onClick={load} className="text-xs underline text-muted-foreground hover:text-foreground">Retry</button>
        </div>
      )}
      {loadState === 'ready' && (
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => { setText(e.target.value); setSaveState('idle'); }}
          spellCheck={false}
          rows={16}
          className="w-full rounded border border-border bg-background font-mono text-xs text-foreground leading-relaxed p-3 resize-y focus:outline-none focus:ring-1 focus:ring-ring"
        />
      )}

      {showPreview && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Full Prompt Preview
            </h4>
            <button
              onClick={refreshPreview}
              disabled={previewState === 'loading'}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              {previewState === 'loading' ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          {previewState === 'loading' && (
            <div className="h-32 rounded border border-border bg-muted/30 animate-pulse" />
          )}
          {previewState === 'error' && (
            <p className="text-xs text-destructive">Failed to load preview.</p>
          )}
          {previewState === 'idle' && preview && (
            <>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{preview.full_prompt.length.toLocaleString()} chars</span>
                <span>·</span>
                {preview.has_context
                  ? <span className="text-emerald-600 dark:text-emerald-400">Context injected ({preview.context_chars.toLocaleString()} chars)</span>
                  : <span>No prior context (no sessions yet)</span>
                }
              </div>
              <pre className="w-full overflow-auto rounded border border-border bg-muted/30 font-mono text-xs text-foreground leading-relaxed p-3 max-h-96 whitespace-pre-wrap break-words">
                {preview.full_prompt}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}



export function SettingsTab() {
  const resetSentEmails = async () => {
    const res = await fetch('/api/analytics/settings/reset-sent-emails', { method: 'POST' });
    const data = await res.json() as { deleted?: number; userEmail?: string; error?: string };
    if (data.error) throw new Error(data.error);
    return `Deleted ${data.deleted ?? 0} email(s) sent by ${data.userEmail}`;
  };

  const resetSessions = async () => {
    const res = await fetch('/api/analytics/settings/reset-sessions', { method: 'POST' });
    const data = await res.json() as { deletedSessions?: number; error?: string };
    if (data.error) throw new Error(data.error);
    return `Deleted ${data.deletedSessions ?? 0} session(s) and all associated events`;
  };

  const normalizeUserEmail = async () => {
    const res = await fetch('/api/analytics/settings/normalize-user-email', { method: 'POST' });
    const data = await res.json() as {
      canonical?: string;
      aliases?: string[];
      postgres?: { from_addr_updated: number; to_addr_updated: number };
      qdrant?: string;
      neo4j?: { nodes_updated: number };
      message?: string;
      error?: string;
    };
    if (data.error) throw new Error(data.error);
    if (data.message) return data.message;
    const pg = data.postgres;
    const neo = data.neo4j;
    return [
      `Canonical: ${data.canonical}`,
      `Postgres — from_addr: ${pg?.from_addr_updated ?? 0} rows, to_addr: ${pg?.to_addr_updated ?? 0} rows`,
      `Qdrant — ${data.qdrant}`,
      `Neo4j — ${neo?.nodes_updated ?? 0} node(s) updated`,
    ].join(' · ');
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8 py-4">
      {/* Agent configuration section */}
      <div>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Agent Configuration
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Edit the system prompt and preview the full prompt sent to the agent on session start.
        </p>
        <PromptEditor />
      </div>

      {/* Maintenance section */}
      <div>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Maintenance
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          One-time cleanup operations.
        </p>
        <div className="space-y-3">
          <DangerAction
            title="Normalize User Email"
            description={`Rewrites all known demo-user aliases (demo-user@gmail.com, demo-user@company.com, me@demo.local) to the canonical DEMO_USER_EMAIL across Postgres (from_addr / to_addr), Qdrant emails (sender / to), and Neo4j User nodes.`}
            buttonLabel="Normalize Now"
            onConfirm={normalizeUserEmail}
          />
        </div>
      </div>

      {/* Data management section */}
      <div>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Data Management
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          These actions are irreversible. Confirm twice before proceeding.
        </p>
        <div className="space-y-3">
          <DangerAction
            title="Reset Sent Emails"
            description="Looks up the User node in Neo4j, then permanently deletes all emails in the inbox where the sender matches the user's email address."
            buttonLabel="Reset Sent Emails"
            onConfirm={resetSentEmails}
          />
          <DangerAction
            title="Reset Sessions & Events"
            description="Permanently deletes all session transcripts and summaries from Postgres, and all events from Qdrant."
            buttonLabel="Reset Sessions"
            onConfirm={resetSessions}
          />
        </div>
      </div>
    </div>
  );
}
