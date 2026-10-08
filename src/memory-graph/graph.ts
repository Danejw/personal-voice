export interface GraphNode {
  id: string;
  kind: string;
  label: string;
  snippet: string;
  tableName: string;
  recordId: string;
  sourceId: string | null;
  status: string;
  createdAt: string;
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  confidence: number;
  evidenceSourceId: string | null;
}
export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
  activeMemoryCount: number;
  eligibleSourceCount: number;
  sampleLimit: number;
}
export interface GraphPoint { x: number; y: number }

const str = (value: unknown, max: number): string =>
  typeof value === "string" ? value.slice(0, max) : "";
function integer(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

/** Defensive parser: no data from other accounts, source text, or missing nodes is invented. */
export function parseGraphSnapshot(input: unknown): GraphSnapshot {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Graph response is not readable.");
  }
  const v = input as Record<string, unknown>;
  if (!Array.isArray(v.nodes) || !Array.isArray(v.edges)) {
    throw new Error("Graph response has no nodes or connections.");
  }
  const nodes: GraphNode[] = [];
  const seen = new Set<string>();
  for (const value of v.nodes.slice(0, 600)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const n = value as Record<string, unknown>;
    const id = str(n.id, 100);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    nodes.push({
      id,
      kind: str(n.kind, 64) || "unknown",
      label: str(n.label, 240) || "Untitled",
      snippet: str(n.snippet, 600),
      tableName: str(n.tableName, 80),
      recordId: str(n.recordId, 100),
      sourceId: n.sourceId === null ? null : str(n.sourceId, 100) || null,
      status: str(n.status, 40),
      createdAt: str(n.createdAt, 60),
    });
  }
  const edges: GraphEdge[] = [];
  const edgesSeen = new Set<string>();
  for (const value of v.edges.slice(0, 1000)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const e = value as Record<string, unknown>;
    const id = str(e.id, 100);
    const source = str(e.source, 100);
    const target = str(e.target, 100);
    if (!id || edgesSeen.has(id) || source === target || !seen.has(source) || !seen.has(target)) continue;
    const confidence = typeof e.confidence === "number" && Number.isFinite(e.confidence) ? e.confidence : 1;
    edgesSeen.add(id);
    edges.push({
      id, source, target, relation: str(e.relation, 48) || "related_to",
      confidence: Math.min(1, Math.max(0, confidence)),
      evidenceSourceId: e.evidenceSourceId === null ? null : str(e.evidenceSourceId, 100) || null,
    });
  }
  return {
    nodes, edges,
    activeMemoryCount: integer(v.activeMemoryCount),
    eligibleSourceCount: integer(v.eligibleSourceCount),
    sampleLimit: integer(v.sampleLimit, 180),
  };
}

export const SOURCE_LABELS: Record<string, string> = {
  memory: "Memory",
  note: "Note",
  message: "Assistant message",
  dictation: "Dictation",
  asset: "Memory file",
  note_attachment: "Note file",
  person: "Person",
  project: "Project",
  organization: "Organization",
  goal: "Goal",
  concept: "Concept",
  decision: "Decision",
  event: "Event",
};

/** Reserved colors are used for consistent source categories, not inferred meanings. */
export const GRAPH_COLORS: Record<string, string> = {
  memory: "#89e0c4", note: "#75b8ef", message: "#8ea8f8",
  dictation: "#8ec9f1", asset: "#d1a3f6", note_attachment: "#b59aea",
  person: "#f2c17d", project: "#f0c773", organization: "#f3b88c",
  goal: "#f3ca90", concept: "#c4b6f3", decision: "#eac792", event: "#e3bd96",
};
export function graphColor(kind: string): string {
  return GRAPH_COLORS[kind] ?? "#9cacbc";
}
export function kindLabel(kind: string): string {
  return SOURCE_LABELS[kind] ?? kind.replace(/_/g, " ");
}

/** Text search filters nodes, then preserves their connections to visible nodes. */
export function filterGraph(
  graph: GraphSnapshot, query: string, kind: string, connectedOnly: boolean,
): GraphSnapshot {
  const needle = query.toLocaleLowerCase().trim();
  const match = (n: GraphNode) =>
    (kind === "all" || n.kind === kind) &&
    (!needle || `${n.label} ${n.snippet} ${n.tableName}`.toLocaleLowerCase().includes(needle));
  const matchedIds = new Set(graph.nodes.filter(match).map((n) => n.id));
  const related = new Set<string>();
  if (connectedOnly) {
    for (const e of graph.edges) {
      if (matchedIds.has(e.source)) related.add(e.source);
      if (matchedIds.has(e.target)) related.add(e.target);
    }
  }
  const nodes = graph.nodes.filter((n) => matchedIds.has(n.id) && (!connectedOnly || related.has(n.id)));
  const kept = new Set(nodes.map((n) => n.id));
  return { ...graph, nodes, edges: graph.edges.filter((e) => kept.has(e.source) && kept.has(e.target)) };
}

/** Deterministic offline force layout. The viewer makes no model/API call for geometry. */
export function layoutGraph(graph: GraphSnapshot, previous?: ReadonlyMap<string, GraphPoint>): Map<string, GraphPoint> {
  const points = new Map<string, GraphPoint>();
  const sorted = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id));
  for (let i = 0; i < sorted.length; i++) {
    const n = sorted[i]!;
    const old = previous?.get(n.id);
    if (old) { points.set(n.id, { ...old }); continue; }
    const radius = n.kind === "memory" ? 155 : n.kind === "note" || n.kind === "message" ||
      n.kind === "dictation" || n.kind === "asset" || n.kind === "note_attachment" ? 345 : 280;
    const angle = i * Math.PI * (3 - Math.sqrt(5));
    points.set(n.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  // Cap pairwise physics work for Android. Spatially-bounded repulsion and
  // link springs produce a readable network, not an implied semantic distance.
  const nodes = sorted.slice(0, 360);
  const ids = new Set(nodes.map((n) => n.id));
  const links = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).slice(0, 700);
  for (let pass = 0; pass < 65; pass++) {
    const movement = new Map<string, GraphPoint>();
    for (const n of nodes) movement.set(n.id, { x: 0, y: 0 });
    for (let a = 0; a < nodes.length; a++) {
      const one = points.get(nodes[a]!.id)!;
      for (let b = a + 1; b < nodes.length; b++) {
        const two = points.get(nodes[b]!.id)!;
        const dx = one.x - two.x, dy = one.y - two.y;
        const squared = dx * dx + dy * dy + 100;
        if (squared > 55000) continue;
        const strength = 3400 / squared;
        const mx = dx * strength / Math.sqrt(squared);
        const my = dy * strength / Math.sqrt(squared);
        const aa = movement.get(nodes[a]!.id)!;
        const bb = movement.get(nodes[b]!.id)!;
        aa.x += mx; aa.y += my; bb.x -= mx; bb.y -= my;
      }
    }
    for (const e of links) {
      const a = points.get(e.source)!; const b = points.get(e.target)!;
      const dx = b.x - a.x, dy = b.y - a.y, dist = Math.max(1, Math.hypot(dx, dy));
      const force = (dist - 135) * 0.014;
      const mx = dx / dist * force, my = dy / dist * force;
      movement.get(e.source)!.x += mx; movement.get(e.source)!.y += my;
      movement.get(e.target)!.x -= mx; movement.get(e.target)!.y -= my;
    }
    for (const n of nodes) {
      const point = points.get(n.id)!;
      const move = movement.get(n.id)!;
      // Gentle center gravity avoids runaway disconnected islands.
      point.x = Math.max(-920, Math.min(920, point.x + Math.max(-9, Math.min(9, move.x - point.x * 0.0018))));
      point.y = Math.max(-720, Math.min(720, point.y + Math.max(-9, Math.min(9, move.y - point.y * 0.0018))));
    }
  }
  return points;
}
