import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { filterGraph, graphCanvasState, graphColor, kindLabel, layoutGraph, type GraphNode, type GraphPoint, type GraphSnapshot } from "@/memory-graph/graph";
import { loadMemoryGraph } from "@/memory-graph/graphService";
import "./memoryGraph.css";

interface MemoryGraphPanelProps {
  userId: string | null;
  active: boolean;
  onNavigate?(section: "assistant" | "notes" | "dictation" | "insights"): void;
}
interface View { x: number; y: number; w: number; h: number }
type Gesture = { kind: "pan"; clientX: number; clientY: number; view: View } |
  { kind: "drag"; id: string; clientX: number; clientY: number; point: GraphPoint };
const HOME: View = { x: -730, y: -440, w: 1460, h: 880 };
const DISPLAY_LIMIT = 24;
const shorten = (value: string, max = 22) => value.length > max ? value.slice(0, max - 1) + "…" : value;
const clearDate = (value: string) => {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Unknown" : date.toLocaleDateString();
};
function suggestedSection(node: GraphNode): "assistant" | "notes" | "dictation" | "insights" | null {
  if (node.kind === "memory" || node.kind === "message") return "assistant";
  if (node.kind === "note" || node.kind === "note_attachment") return "notes";
  if (node.kind === "dictation") return "dictation";
  return null;
}
function ZoomIcon({ direction }: { direction: "in" | "out" }) {
  return <span aria-hidden="true">{direction === "in" ? "+" : "−"}</span>;
}

/**
 * A read-only visual projection of current authorized memory graph rows.
 * This page never invokes Gemini or starts an indexing/backfill job.
 */
export function MemoryGraphPanel({ userId, active, onNavigate }: MemoryGraphPanelProps) {
  const [graph, setGraph] = useState<GraphSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [live, setLive] = useState(true);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [connectedOnly, setConnectedOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>(HOME);
  const [dragged, setDragged] = useState<Record<string, GraphPoint>>({});
  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const requestSequence = useRef(0);

  const reload = useCallback(async (quiet = false) => {
    if (!userId || !active) return;
    const seq = ++requestSequence.current;
    if (!quiet) setBusy(true);
    try {
      const result = await loadMemoryGraph(userId);
      if (seq !== requestSequence.current) return;
      setGraph(result);
      setError(null);
      setLastUpdated(new Date());
      setSelectedId((current) => current && result.nodes.some((n) => n.id === current) ? current : null);
    } catch (reason) {
      if (seq !== requestSequence.current) return;
      setError(reason instanceof Error ? reason.message : "Memory graph is unavailable.");
    } finally {
      if (seq === requestSequence.current) setBusy(false);
    }
  }, [userId, active]);

  useEffect(() => {
    setGraph(null);
    setLastUpdated(null);
    setSelectedId(null);
    setDragged({});
    setView(HOME);
    if (!active || !userId) return;
    void reload();
    return () => { requestSequence.current++; };
  }, [active, userId, reload]);

  useEffect(() => {
    if (!live || !active || !userId) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload(true);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [live, active, userId, reload]);

  const visible = useMemo(() => graph ? filterGraph(graph, query, kind, connectedOnly) : null, [graph, query, kind, connectedOnly]);
  const positions = useMemo(() => graph ? layoutGraph(graph) : new Map<string, GraphPoint>(), [graph]);
  const canvasState = graphCanvasState(graph, error, visible?.nodes.length ?? 0);
  const pointFor = useCallback((id: string): GraphPoint => dragged[id] ?? positions.get(id) ?? { x: 0, y: 0 }, [dragged, positions]);
  const selected = graph?.nodes.find((n) => n.id === selectedId) ?? null;
  const neighbors = useMemo(() => {
    if (!graph || !selected) return [];
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    return graph.edges.flatMap((e) => {
      if (e.source === selected.id) {
        const other = byId.get(e.target);
        return other ? [{ edge: e, node: other }] : [];
      }
      if (e.target === selected.id) {
        const other = byId.get(e.source);
        return other ? [{ edge: e, node: other }] : [];
      }
      return [];
    });
  }, [graph, selected]);
  const highlight = useMemo(() => new Set([selectedId, ...neighbors.map((item) => item.node.id)]), [selectedId, neighbors]);
  const kinds = useMemo(() => [...new Set(graph?.nodes.map((n) => n.kind) ?? [])].sort(), [graph]);
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const n of graph?.nodes ?? []) result.set(n.kind, (result.get(n.kind) ?? 0) + 1);
    return result;
  }, [graph]);

  function zoom(factor: number) {
    setView((v) => {
      const nextW = Math.max(270, Math.min(2200, v.w * factor));
      const ratio = nextW / v.w;
      return { w: nextW, h: v.h * ratio, x: v.x + v.w * (1 - ratio) / 2, y: v.y + v.h * (1 - ratio) / 2 };
    });
  }
  function onWheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const fx = (event.clientX - rect.left) / Math.max(rect.width, 1);
    const fy = (event.clientY - rect.top) / Math.max(rect.height, 1);
    const factor = event.deltaY < 0 ? 0.88 : 1.12;
    setView((v) => {
      const width = Math.max(270, Math.min(2200, v.w * factor));
      const ratio = width / v.w;
      return { x: v.x + fx * v.w * (1 - ratio), y: v.y + fy * v.h * (1 - ratio), w: width, h: v.h * ratio };
    });
  }
  function onCanvasPointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { kind: "pan", clientX: event.clientX, clientY: event.clientY, view: { ...view } };
  }
  function onNodePointerDown(event: PointerEvent<SVGGElement>, id: string) {
    if (event.button !== 0) return;
    event.stopPropagation();
    svgRef.current?.setPointerCapture(event.pointerId);
    gesture.current = { kind: "drag", id, clientX: event.clientX, clientY: event.clientY, point: { ...pointFor(id) } };
    setSelectedId(id);
  }
  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    if (!g) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = (event.clientX - g.clientX) * view.w / Math.max(1, rect.width);
    const dy = (event.clientY - g.clientY) * view.h / Math.max(1, rect.height);
    if (g.kind === "pan") setView({ ...g.view, x: g.view.x - dx, y: g.view.y - dy });
    else setDragged((p) => ({ ...p, [g.id]: { x: g.point.x + dx, y: g.point.y + dy } }));
  }
  function onPointerUp(event: PointerEvent<SVGSVGElement>) {
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <div className="memory-graph-page">
      <div className="memory-graph-intro">
        <div>
          <p className="memory-graph-kicker">PERSONAL KNOWLEDGE NETWORK</p>
          <h3>See how your memories connect</h3>
          <p>Live view of saved memories, related entities, and eligible records in your database. Select a node to inspect its evidence and connections.</p>
        </div>
        <div className="memory-graph-sync">
          <span className={error ? "memory-graph-status is-error" : "memory-graph-status"} aria-live="polite">
            {error ? "Connection issue" : busy ? "Syncing…" : lastUpdated ? "Synced" : "Loading"}
          </span>
          <button className="secondary" type="button" onClick={() => { void reload(); }} disabled={busy || !userId}>Refresh</button>
        </div>
      </div>

      {error && <p className="error" role="alert">{error} {graph ? "Displaying the most recent loaded snapshot." : ""}</p>}
      <div className="memory-graph-stats" aria-label="Memory graph statistics">
        <div><strong>{graph?.activeMemoryCount ?? "—"}</strong><span>Active memories</span></div>
        <div><strong>{graph?.nodes.length ?? "—"}</strong><span>Visible network nodes</span></div>
        <div><strong>{graph?.edges.length ?? "—"}</strong><span>Connections</span></div>
        <div><strong>{graph?.eligibleSourceCount ?? "—"}</strong><span>Eligible indexed sources</span></div>
      </div>

      <div className="memory-graph-toolbar">
        <label className="memory-graph-search">
          <span className="visually-hidden">Search graph nodes</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>
          <input type="search" placeholder="Find a memory, project, or source…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label className="memory-graph-filter">
          <span className="visually-hidden">Filter graph by node type</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">All node types</option>
            {kinds.map((item) => <option key={item} value={item}>{kindLabel(item)} ({counts.get(item) ?? 0})</option>)}
          </select>
        </label>
        <label className="memory-graph-toggle"><input type="checkbox" checked={connectedOnly} onChange={(e) => setConnectedOnly(e.target.checked)} /> Connected only</label>
        <label className="memory-graph-toggle"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Auto-refresh</label>
      </div>

      <div className="memory-graph-layout">
        <div className="memory-graph-stage">
          <div className="memory-graph-stagebar">
            <span><span className="memory-graph-stage-dot" /> {visible?.nodes.length ?? 0} nodes · {visible?.edges.length ?? 0} links</span>
            <div className="memory-graph-zoom">
              <button type="button" aria-label="Zoom in" onClick={() => zoom(0.8)}><ZoomIcon direction="in" /></button>
              <button type="button" aria-label="Zoom out" onClick={() => zoom(1.25)}><ZoomIcon direction="out" /></button>
              <button type="button" aria-label="Reset graph view" onClick={() => { setView(HOME); setDragged({}); }}>Reset</button>
            </div>
          </div>
          {canvasState === "loading" || canvasState === "error" ? (
            <div className="memory-graph-empty" role={error ? "alert" : "status"}>
              <span aria-hidden="true">{canvasState === "error" ? "!" : "◎"}</span>
              <strong>{canvasState === "error" ? "Memory is temporarily unavailable" : "Loading your knowledge network…"}</strong>
              {canvasState === "error" && <>
                <p>The graph could not be loaded. Your other Personal Voice features are unaffected.</p>
                <button className="secondary" type="button" disabled={busy} onClick={() => { void reload(); }}>
                  Retry loading
                </button>
              </>}
            </div>
          ) : canvasState === "empty" ? (
            <div className="memory-graph-empty">
              <span aria-hidden="true">◎</span>
              <strong>{graph?.nodes.length ? "No matches" : "Your memory graph is empty"}</strong>
              <p>{graph?.nodes.length
                ? "Try a different search or remove the filters."
                : "Saved Assistant memories will appear here automatically. Graph relationships appear when indexing and linking have completed."}</p>
            </div>
          ) : visible ? (
            <svg
              ref={svgRef} className="memory-graph-canvas" role="img"
              aria-label={`Interactive memory graph showing ${visible.nodes.length} nodes and ${visible.edges.length} connections. Select a node to inspect it.`}
              viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
              onWheel={onWheel} onPointerDown={onCanvasPointerDown}
              onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
            >
              <defs>
                <marker id="memory-graph-arrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto" markerUnits="strokeWidth">
                  <path d="M0 0 L6 3 L0 6 Z" fill="#64768a" />
                </marker>
              </defs>
              {visible.edges.map((e) => {
                const a = pointFor(e.source), b = pointFor(e.target);
                const related = !selectedId || e.source === selectedId || e.target === selectedId;
                return <g key={e.id} className="memory-graph-link" opacity={related ? 0.85 : 0.15}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={related && selectedId ? "#9bdcca" : "#526374"}
                    strokeWidth={related && selectedId ? 2 : 1.3} markerEnd="url(#memory-graph-arrow)" />
                  {selectedId && related && <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 9} textAnchor="middle" fill="#b9ccda" fontSize="11">
                    {e.relation.replace(/_/g, " ")}
                  </text>}
                </g>;
              })}
              {visible.nodes.map((node) => {
                const p = pointFor(node.id);
                const activeNode = node.id === selectedId;
                const highlighted = !selectedId || highlight.has(node.id);
                const isMemory = node.kind === "memory";
                const width = isMemory ? 162 : 148;
                return <g key={node.id}
                  className={`memory-graph-node${activeNode ? " is-selected" : ""}`}
                  transform={`translate(${p.x} ${p.y})`}
                  opacity={highlighted ? 1 : 0.35}
                  onPointerDown={(e) => onNodePointerDown(e, node.id)}
                  onClick={() => setSelectedId(node.id)}
                  tabIndex={0}
                  role="button"
                  aria-label={`Select ${kindLabel(node.kind)}: ${node.label}`}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(node.id); } }}
                >
                  <rect x={-width / 2} y={-25} width={width} height="50" rx="13" fill={activeNode ? "#253f39" : "#1c2935"} />
                  <rect x={-width / 2} y={-25} width="4" height="50" rx="2" fill={graphColor(node.kind)} />
                  <circle cx={-width / 2 + 19} cy={-6} r="5.5" fill={graphColor(node.kind)} />
                  <text x={-width / 2 + 32} y={-2} fontSize="12" fill="#eaf2f7" fontWeight="600">
                    {shorten(node.label, isMemory ? 20 : 18)}
                  </text>
                  <text x={-width / 2 + 17} y={15} fontSize="10" fill="#a4b4c2">
                    {kindLabel(node.kind)}{node.status === "ready" ? "" : ` · ${shorten(node.status, 12)}`}
                  </text>
                </g>;
              })}
            </svg>
          ) : (
            <div className="memory-graph-empty" role="alert">Memory view is unavailable. Try refreshing.</div>
          )}
          {visible && visible.nodes.length > 0 && <p className="memory-graph-stage-hint">Drag to pan. Scroll or use +/− to zoom. Drag nodes to rearrange. Tap a node for details.</p>}
        </div>

        <aside className="memory-graph-detail" aria-label="Selected memory information">
          {selected ? (
            <>
              <div className="memory-graph-detail-heading">
                <span className="memory-graph-kind" style={{ color: graphColor(selected.kind) }}>{kindLabel(selected.kind)}</span>
                <h4>{selected.label}</h4>
                <span className="memory-graph-detail-state">{selected.status}</span>
              </div>
              {selected.snippet && <p className="memory-graph-excerpt">{selected.snippet}</p>}
              <dl className="memory-graph-facts">
                <div><dt>Database table</dt><dd>{selected.tableName || "Entity"}</dd></div>
                <div><dt>Created</dt><dd>{clearDate(selected.createdAt)}</dd></div>
                {selected.recordId && <div><dt>Record ID</dt><dd className="memory-graph-record-id">{selected.recordId}</dd></div>}
              </dl>
              {suggestedSection(selected) && onNavigate && <button type="button" className="secondary memory-graph-open" onClick={() => onNavigate(suggestedSection(selected)!)}>Open {suggestedSection(selected) === "assistant" ? "Assistant" : suggestedSection(selected) === "notes" ? "Notes" : "Dictations"}</button>}
              <h5>Connections <span>{neighbors.length}</span></h5>
              {neighbors.length ? <ul className="memory-graph-relations">
                {neighbors.slice(0, 50).map(({ edge, node }) => (
                  <li key={edge.id}>
                    <button type="button" onClick={() => { setQuery(""); setKind("all"); setConnectedOnly(false); setSelectedId(node.id); }}>
                      <span className="memory-graph-relationship">{edge.relation.replace(/_/g, " ")}</span>
                      <span className="memory-graph-related-label"><span style={{ background: graphColor(node.kind) }} />{node.label}</span>
                    </button>
                  </li>
                ))}
              </ul> : <p className="memory-graph-detail-help">No graph connections yet. They appear when memories and authorized sources are indexed and linked.</p>}
            </>
          ) : (
            <>
              <div className="memory-graph-detail-heading">
                <span className="memory-graph-kind">EXPLORE YOUR NETWORK</span>
                <h4>Memory connections</h4>
                <p>Select any node in the graph to see its original source table, details, and related memories.</p>
              </div>
              <h5>Node types</h5>
              <ul className="memory-graph-legend">
                {[...counts].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, count]) =>
                  <li key={name}><span style={{ background: graphColor(name) }} />{kindLabel(name)}<strong>{count}</strong></li>)}
              </ul>
              {!!graph && graph.nodes.length > DISPLAY_LIMIT && <p className="memory-graph-detail-help">Use the filters to explore larger networks. This view returns a bounded sample from the database.</p>}
            </>
          )}
        </aside>
      </div>
      <div className="memory-graph-footnote" role="status">
        <span>{lastUpdated ? `Last updated ${lastUpdated.toLocaleTimeString()}` : "Not yet loaded"} · Source relationships reflect current account permissions.</span>
        <span>Viewing a graph does not generate embeddings or create memories.</span>
      </div>
    </div>
  );
}
