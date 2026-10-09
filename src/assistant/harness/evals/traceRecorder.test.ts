import { describe, expect, it } from "vitest";
import { ToolTraceRecorder, MAX_EVAL_TOOL_ATTEMPTS } from "@/assistant/harness/evals/traceRecorder";
import { interpretToolResult } from "@/assistant/harness/toolResults";

describe("privacy-minimal tool trace recorder", () => {
  it("records actual call names, latency and outcomes but never arguments, text or raw IDs", () => {
    let now = 100;
    const recorder = new ToolTraceRecorder(
      { scenarioId: "choice-copy-v-insert", modality: "voice", platform: "windows" },
      () => now,
    );
    now = 140;
    recorder.noteCalls([{ id: "secret-call-id-123", name: "copy_text" }]);
    now = 190;
    recorder.noteResult("secret-call-id-123", interpretToolResult("copy_text", true, "private clipboard phrase"));
    expect(recorder.snapshot()).toEqual({
      version: 1, scenarioId: "choice-copy-v-insert", origin: "live",
      modality: "voice", platform: "windows",
      attempts: [{ tool: "copy_text", startMs: 40, durationMs: 50, status: "acknowledged", failureKind: null }],
      goal: { passed: null, source: "unverified" },
    });
    const json = JSON.stringify(recorder.snapshot());
    expect(json).not.toContain("secret-call-id-123");
    expect(json).not.toContain("private clipboard phrase");
  });

  it("keeps unfinished calls visibly pending, ignores unknown completions, and caps memory", () => {
    const recorder = new ToolTraceRecorder(
      { scenarioId: "none-chat-only", platform: "unknown", modality: "unknown", origin: "mock" },
      () => 0,
    );
    recorder.noteResult("lost", interpretToolResult("copy_text", false, "error"));
    recorder.noteCalls([{ id: null, name: "copy_text" }, { id: "1", name: "bad command!" }]);
    expect(recorder.snapshot().attempts).toHaveLength(0);
    recorder.noteCalls(Array.from({ length: MAX_EVAL_TOOL_ATTEMPTS + 10 },
      (_, index) => ({ id: String(index), name: "copy_text" })));
    expect(recorder.snapshot().attempts).toHaveLength(MAX_EVAL_TOOL_ATTEMPTS);
    recorder.noteResult("0", interpretToolResult("copy_text", false, "Cancelled"));
    expect(recorder.snapshot().attempts[0]).toMatchObject({ status: "cancelled", failureKind: "cancelled" });
    expect(recorder.snapshot().attempts[1]).toMatchObject({ status: "pending", durationMs: null });
    expect(() => new ToolTraceRecorder({ scenarioId: "../sneaky", modality: "typed", platform: "windows" })).toThrow();
  });
});
