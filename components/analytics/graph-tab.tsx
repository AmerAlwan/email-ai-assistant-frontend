'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

// ── Types ─────────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  type: string;
  name: string;
  info: string | null;
  aliases: string[];
  properties: Record<string, unknown>;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ── Colors ────────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  Person:       '#3b82f6',
  Organization: '#22c55e',
  Project:      '#f59e0b',
  Location:     '#ec4899',
  Topic:        '#8b5cf6',
  User:         '#6366f1',
};
const FALLBACK_COLORS = ['#e11d48', '#0ea5e9', '#84cc16', '#d946ef', '#14b8a6'];
let colorIdx = 0;
const dynamicColors: Record<string, string> = {};

function getTypeColor(type: string) {
  if (TYPE_COLORS[type]) return TYPE_COLORS[type];
  if (!dynamicColors[type]) {
    dynamicColors[type] = FALLBACK_COLORS[colorIdx % FALLBACK_COLORS.length];
    colorIdx++;
  }
  return dynamicColors[type];
}

// ── Side panel ────────────────────────────────────────────────────────────────

interface Relationship {
  relatedName: string;
  direction: 'out' | 'in';
  label: string;
}

interface SelectedDetail {
  node: GraphNode;
  relationships: Relationship[];
}

function NodeDetail({ detail, onClose }: { detail: SelectedDetail; onClose: () => void }) {
  const { node, relationships } = detail;
  const color = getTypeColor(node.type);
  return (
    <div className="w-72 border-l border-gray-800 flex flex-col shrink-0 overflow-hidden">
      {/* header */}
      <div className="flex items-start justify-between px-4 py-3 border-b border-gray-800"
        style={{ borderLeftWidth: 3, borderLeftStyle: 'solid', borderLeftColor: color }}>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{node.type}</div>
          <div className="mt-0.5 text-sm font-semibold text-gray-200">{node.name}</div>
        </div>
        <button onClick={onClose} className="mt-0.5 text-gray-600 hover:text-gray-300 p-1">✕</button>
      </div>

      {/* body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {node.info && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">About</div>
            <p className="text-xs text-gray-400 leading-relaxed">{node.info}</p>
          </div>
        )}
        {node.aliases.length > 0 && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">Aliases</div>
            <div className="flex flex-wrap gap-1.5">
              {node.aliases.map((a) => (
                <span key={a} className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">{a}</span>
              ))}
            </div>
          </div>
        )}
        {Object.keys(node.properties).length > 0 && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">Properties</div>
            {Object.entries(node.properties).map(([k, v]) => (
              <div key={k} className="text-xs text-gray-400 mb-1">
                <span className="text-gray-600">{k}:</span>{' '}
                {Array.isArray(v) ? v.join(', ') || '—' : String(v) || '—'}
              </div>
            ))}
          </div>
        )}
        {relationships.length > 0 && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">Relationships</div>
            {relationships.map((r, i) => (
              <div key={i} className="text-xs bg-gray-800/60 rounded p-1.5 mb-1">
                <span className="text-indigo-400">{r.label.replace(/_/g, ' ')}</span>
                <span className="text-gray-400"> {r.direction === 'out' ? '→' : '←'} {r.relatedName}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main GraphTab ─────────────────────────────────────────────────────────────

export function GraphTab() {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);
  const [selected, setSelected] = useState<SelectedDetail | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 800, height: 600 });
  const onNodeClickRef = useRef<(n: unknown) => void>(() => {});

  // Track container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDims({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setSettled(false);
    setSelected(null);
    fetch('/api/analytics/graph')
      .then((r) => r.json())
      .then((data: GraphData & { error?: string }) => {
        if (data.error) { setError(data.error); return; }
        setGraphData(data);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Always-current node-click handler via ref — avoids stale closure in ForceGraph2D
  onNodeClickRef.current = (rawNode: unknown) => {
    const n = rawNode as GraphNode & { x?: number; y?: number };
    if (!n.id || !graphData) return;

    const nodeId = n.id;
    const relationships: Relationship[] = [];
    const nodeMap = new Map(graphData.nodes.map((node) => [node.id, node]));

    for (const edge of graphData.edges) {
      const srcId = typeof edge.source === 'object'
        ? (edge.source as { id: string }).id
        : edge.source;
      const tgtId = typeof edge.target === 'object'
        ? (edge.target as { id: string }).id
        : edge.target;
      if (srcId === nodeId) {
        const rel = nodeMap.get(tgtId);
        if (rel) relationships.push({ relatedName: rel.name, direction: 'out', label: edge.label });
      } else if (tgtId === nodeId) {
        const rel = nodeMap.get(srcId);
        if (rel) relationships.push({ relatedName: rel.name, direction: 'in', label: edge.label });
      }
    }

    // flushSync so canvas event immediately triggers re-render
    flushSync(() => {
      setSelected({ node: n as GraphNode, relationships });
    });
  };

  const onNodeClick = useCallback((n: unknown) => onNodeClickRef.current(n), []);

  const fgNodes = useMemo(
    () => (graphData?.nodes ?? []).map((n) => ({ ...n, val: 1, color: getTypeColor(n.type) })),
    [graphData?.nodes],
  );

  const fgLinks = useMemo(
    () => (graphData?.edges ?? []).map((e) => ({ source: e.source, target: e.target, label: e.label })),
    [graphData?.edges],
  );

  const allColors = { ...TYPE_COLORS, ...dynamicColors };

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-10rem)] items-center justify-center text-gray-500 text-sm">
        Loading graph…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-900/40 bg-red-950/30 p-4 text-sm text-red-400">{error}</div>
    );
  }

  return (
    <div className="flex" style={{ height: 'calc(100vh - 8rem)' }}>
      {/* Graph canvas */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden rounded-l-xl" style={{ background: '#030712' }}>
        {!loading && (graphData?.nodes.length ?? 0) === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-sm">
            No graph data yet — ingest some emails to build the graph
          </div>
        )}

        {(graphData?.nodes.length ?? 0) > 0 && (
          <ForceGraph2D
            width={dims.width}
            height={dims.height}
            graphData={{ nodes: fgNodes, links: fgLinks }}
            nodeLabel={() => ''}
            nodeColor={(n: unknown) => (n as { color: string }).color}
            nodeVal={1}
            nodeRelSize={5}
            linkColor={() => '#374151'}
            linkWidth={1.5}
            linkDirectionalArrowLength={4}
            linkDirectionalArrowRelPos={1}
            onNodeClick={onNodeClick}
            onEngineStop={() => setSettled(true)}
            backgroundColor="#030712"
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.3}
            cooldownTicks={settled ? 0 : 100}
            nodeCanvasObjectMode={() => 'after'}
            nodeCanvasObject={(node: unknown, ctx: CanvasRenderingContext2D, globalScale: number) => {
              const n = node as GraphNode & { x: number; y: number };
              const fontSize = Math.max(20 / globalScale, 2);
              ctx.font = `${fontSize}px Sans-Serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              ctx.fillStyle = '#ffffff';
              ctx.fillText(n.name, n.x, n.y + 8 / globalScale);
            }}
            linkCanvasObjectMode={() => 'after'}
            linkCanvasObject={(link: unknown, ctx: CanvasRenderingContext2D, globalScale: number) => {
              if (globalScale < 0.8) return;
              const l = link as { source: { x: number; y: number }; target: { x: number; y: number }; label: string };
              if (!l.label || !l.source?.x || !l.target?.x) return;
              const midX = (l.source.x + l.target.x) / 2;
              const midY = (l.source.y + l.target.y) / 2;
              const fontSize = Math.max(8 / globalScale, 1);
              ctx.font = `${fontSize}px Sans-Serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillStyle = '#4b5563';
              ctx.fillText(l.label.replace(/_/g, ' '), midX, midY);
            }}
          />
        )}

        {/* Legend */}
        <div className="absolute bottom-4 left-4 bg-gray-900/80 rounded p-2 flex flex-wrap gap-2 max-w-xs pointer-events-none">
          {Object.entries(allColors).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1 text-xs text-gray-400">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
              {type}
            </div>
          ))}
        </div>

        {/* Stats + Refresh */}
        <div className="absolute top-3 left-3 flex items-center gap-2">
          <div className="bg-gray-900/80 rounded px-2 py-1 text-xs text-gray-500 pointer-events-none">
            {graphData?.nodes.length ?? 0} nodes · {graphData?.edges.length ?? 0} edges
          </div>
          <button
            onClick={load}
            className="px-2 py-1 bg-gray-800 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Side panel */}
      {selected
        ? <NodeDetail detail={selected} onClose={() => setSelected(null)} />
        : (
          <div className="w-72 border-l border-gray-800 flex flex-col shrink-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <h3 className="font-medium text-gray-400 text-sm">Select a node</h3>
            </div>
            <p className="px-4 pt-3 text-xs text-gray-600">Click any node in the graph to see its details and relationships.</p>
          </div>
        )
      }
    </div>
  );
}

