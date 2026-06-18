'use client';

import { useState } from 'react';

// ── Tool definitions ───────────────────────────────────────────────────────────

type ParamType = 'string' | 'number' | 'boolean' | 'array';

interface ParamDef {
  name: string;
  type: ParamType;
  required: boolean;
  placeholder?: string;
  description: string;
}

interface ToolDef {
  name: string;
  label: string;
  description: string;
  params: ParamDef[];
}

const TOOLS: ToolDef[] = [
  {
    name: 'search_emails',
    label: 'search_emails',
    description: 'Semantic search over the email inbox.',
    params: [
      { name: 'query', type: 'string', required: true, placeholder: 'Q2 roadmap', description: 'Topic or keywords to search for' },
      { name: 'sender', type: 'string', required: false, placeholder: 'alice@example.com', description: 'Filter by exact sender address' },
      { name: 'to', type: 'array', required: false, placeholder: 'bob@example.com, carol@example.com', description: 'Filter by recipient addresses (comma-separated, converted to list)' },
      { name: 'date_from', type: 'string', required: false, placeholder: '2026-04-01', description: 'Start date (ISO)' },
      { name: 'date_to', type: 'string', required: false, placeholder: '2026-04-30', description: 'End date (ISO)' },
    ],
  },
  {
    name: 'get_email',
    label: 'get_email',
    description: 'Read a specific email in full by its ID.',
    params: [
      { name: 'email_id', type: 'string', required: true, placeholder: 'email-008', description: 'Email ID from a search_emails result' },
    ],
  },
  {
    name: 'search_entities',
    label: 'search_entities',
    description: 'Semantic search for an entity in the knowledge graph.',
    params: [
      { name: 'query', type: 'string', required: true, placeholder: 'Sarah Chen', description: 'Name or description of the entity' },
      { name: 'with_relationships', type: 'boolean', required: false, description: 'Also return connected nodes' },
    ],
  },
  {
    name: 'get_entity',
    label: 'get_entity',
    description: 'Fetch a graph node by exact canonical name.',
    params: [
      { name: 'name', type: 'string', required: true, placeholder: 'Sarah Chen', description: 'Exact canonical node name' },
      { name: 'with_relationships', type: 'boolean', required: false, description: 'Also return connected nodes' },
    ],
  },
  {
    name: 'search_events',
    label: 'search_events',
    description: 'Semantic search over events from past voice sessions.',
    params: [
      { name: 'query', type: 'string', required: true, placeholder: 'sent email to Jake', description: 'What to recall' },
      { name: 'session_id', type: 'string', required: false, placeholder: 'session_1745123456789', description: 'Restrict to a specific session' },
      { name: 'entity_name', type: 'array', required: false, placeholder: 'Sarah Chen', description: 'Restrict to events involving these entities (AND logic)' },
    ],
  },
  {
    name: 'get_session_transcript',
    label: 'get_session_transcript',
    description: 'Retrieve the full transcript of a specific past session.',
    params: [
      { name: 'session_id', type: 'string', required: true, placeholder: 'session_1745123456789', description: 'Session ID' },
    ],
  },
  {
    name: 'get_recent_emails',
    label: 'get_recent_emails',
    description: 'Fetch the most recent emails received by the user, ordered newest first.',
    params: [
      { name: 'num_emails', type: 'number', required: false, placeholder: '10', description: 'Number of emails to return (1–50, default 10)' },
    ],
  },
  {
    name: 'get_date',
    label: 'get_date',
    description: 'Return a date relative to the simulated current date (most recent email + 1 day). All offsets default to 0.',
    params: [
      { name: 'day_offset', type: 'number', required: false, placeholder: '0', description: 'Days to add (negative for past, e.g. -1 = yesterday)' },
      { name: 'week_offset', type: 'number', required: false, placeholder: '0', description: 'Weeks to add (negative for past, e.g. -1 = last week)' },
      { name: 'month_offset', type: 'number', required: false, placeholder: '0', description: 'Months to add (negative for past, e.g. -1 = last month)' },
      { name: 'year_offset', type: 'number', required: false, placeholder: '0', description: 'Years to add (negative for past, e.g. -1 = last year)' },
    ],
  },
];

// ── Component ──────────────────────────────────────────────────────────────────

export function ToolsTab() {
  const [selectedTool, setSelectedTool] = useState<ToolDef>(TOOLS[0]);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  const handleToolChange = (toolName: string) => {
    const t = TOOLS.find((t) => t.name === toolName)!;
    setSelectedTool(t);
    setValues({});
    setResult(null);
    setError(null);
  };

  const handleRun = async () => {
    setRunning(true);
    setResult(null);
    setError(null);

    // Build params — omit empty optional strings
    const params: Record<string, unknown> = {};
    for (const p of selectedTool.params) {
      const val = values[p.name];
      if (p.type === 'boolean') {
        if (val === true) params[p.name] = true;
      } else if (p.type === 'number') {
        const s = (val as string | undefined) ?? '';
        if (s.trim() !== '') {
          const n = parseInt(s.trim(), 10);
          if (!isNaN(n)) params[p.name] = n;
        }
      } else if (p.type === 'array') {
        const s = (val as string | undefined) ?? '';
        if (s.trim() !== '') {
          params[p.name] = s.split(',').map((v) => v.trim()).filter(Boolean);
        } else if (p.required) {
          params[p.name] = [];
        }
      } else {
        const s = (val as string | undefined) ?? '';
        if (s.trim() !== '' || p.required) params[p.name] = s.trim();
      }
    }

    try {
      const res = await fetch(`/api/analytics/tools/${selectedTool.name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params }),
      });
      const data = await res.json() as { result?: unknown; detail?: string };
      if (!res.ok) {
        setError(data.detail ?? `HTTP ${res.status}`);
      } else {
        setResult(data.result ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-4">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">

        {/* Left — tool selector */}
        <div className="space-y-1">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Tools</p>
          {TOOLS.map((t) => (
            <button
              key={t.name}
              onClick={() => handleToolChange(t.name)}
              className={[
                'w-full rounded-md px-3 py-2 text-left text-sm font-mono transition-colors',
                selectedTool.name === t.name
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Right — params + result */}
        <div className="space-y-4">
          {/* Tool header */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="font-mono text-sm font-semibold text-foreground">{selectedTool.label}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{selectedTool.description}</p>
          </div>

          {/* Params */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Parameters</p>
            {selectedTool.params.map((p) => (
              <div key={p.name} className="space-y-1">
                <label className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <span className="font-mono">{p.name}</span>
                  {p.required
                    ? <span className="text-destructive">*</span>
                    : <span className="text-muted-foreground">(optional)</span>}
                </label>
                <p className="text-xs text-muted-foreground">{p.description}</p>
                {p.type === 'boolean' ? (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={(values[p.name] as boolean) ?? false}
                      onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.checked }))}
                      className="rounded border-border"
                    />
                    <span className="text-xs text-muted-foreground">Enable</span>
                  </label>
                ) : (
                  <input
                    type="text"
                    value={(values[p.name] as string) ?? ''}
                    placeholder={p.placeholder}
                    onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
                    className="w-full rounded border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                )}
                {p.type === 'array' && (
                  <p className="text-[10px] text-muted-foreground/60">Comma-separated values are converted to a list</p>
                )}
              </div>
            ))}

            <button
              onClick={handleRun}
              disabled={running}
              className="mt-2 rounded bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {running ? 'Running…' : 'Run'}
            </button>
          </div>

          {/* Result */}
          {(result !== null || error) && (
            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {error ? 'Error' : 'Result'}
              </p>
              {error ? (
                <p className="text-xs text-destructive font-mono">{error}</p>
              ) : (
                <pre className="overflow-auto max-h-[60vh] whitespace-pre-wrap break-words font-mono text-xs text-foreground leading-relaxed">
                  {typeof result === 'string'
                    ? result
                    : JSON.stringify(result, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
