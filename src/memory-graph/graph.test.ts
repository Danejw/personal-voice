import { describe, expect, it } from "vitest";
import { filterGraph, graphColor, kindLabel, layoutGraph, parseGraphSnapshot } from "@/memory-graph/graph";

const example = {
  activeMemoryCount: 3, eligibleSourceCount: 4, sampleLimit: 180,
  nodes: [
    { id: "a", kind: "memory", label: "Favorite style", snippet: "Prefers concise answers",
      tableName: "assistant_memories", recordId: "ma", sourceId: "sa",
      status: "ready", createdAt: "2026-10-08T00:00:00Z" },
    { id: "b", kind: "note", label: "Project notes", snippet: "Building Personal Voice",
      tableName: "notes", recordId: "nb", sourceId: "sb",
      status: "ready", createdAt: "2026-10-08T00:00:00Z" },
    { id: "c", kind: "project", label: "Personal Voice", snippet: null,
      tableName: "memory_graph_nodes", recordId: "pc", sourceId: null,
      status: "linked", createdAt: "2026-10-08T00:00:00Z" },
    { id: "d", kind: "memory", label: "New memory", snippet: "Not yet indexed",
      tableName: "assistant_memories", recordId: "md", sourceId: null,
      status: "pending", createdAt: "2026-10-08T00:00:00Z" },
  ],
  edges: [
    { id: "edge-1", source: "a", target: "c", relation: "related_to", confidence: 0.86, evidenceSourceId: "sa" },
    { id: "edge-2", source: "b", target: "c", relation: "mentioned_in", confidence: 1, evidenceSourceId: "sb" },
    { id: "edge-stale", source: "a", target: "gone", relation: "related_to", confidence: 1 },
  ],
};

describe("Memory Graph read-only projection", () => {
  it("accepts genuine source-backed nodes and removes dangling/duplicate edges", () => {
    const graph = parseGraphSnapshot(example);
    expect(graph.nodes).toHaveLength(4);
    expect(graph.edges).toHaveLength(2);
    expect(graph.activeMemoryCount).toBe(3);
    expect(graph.nodes.find((n) => n.id === "d")?.status).toBe("pending");
  });

  it("does not turn invalid data into a fake graph", () => {
    expect(() => parseGraphSnapshot(null)).toThrow("readable");
    expect(() => parseGraphSnapshot({ nodes: [], edges: null })).toThrow("nodes or connections");
    expect(parseGraphSnapshot({ nodes: [{ id: "a" }, { id: "a" }], edges: [] }).nodes).toHaveLength(1);
  });

  it("filters by source type, exact content, and connected state", () => {
    const all = parseGraphSnapshot(example);
    const filtered = filterGraph(all, "project", "all", false);
    expect(filtered.nodes.map((n) => n.id)).toEqual(["b"]);
    expect(filtered.edges).toHaveLength(0);
    const memory = filterGraph(all, "", "memory", true);
    expect(memory.nodes.map((n) => n.id)).toEqual([]);
    expect(filterGraph(all, "", "all", true).nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("returns deterministic, finite layout positions without a network call", () => {
    const graph = parseGraphSnapshot(example);
    const first = layoutGraph(graph);
    const second = layoutGraph(graph);
    expect([...first.entries()]).toEqual([...second.entries()]);
    expect([...first.values()].every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    expect(layoutGraph(graph, first)).toHaveProperty("size", 4);
  });

  it("assigns distinct source colors and human-readable names", () => {
    expect(graphColor("memory")).not.toBe(graphColor("note"));
    expect(kindLabel("note_attachment")).toBe("Note file");
    expect(graphColor("custom")).toBeTruthy();
  });
});
