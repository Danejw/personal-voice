import { describe, expect, it, vi } from "vitest";
import { runModelEval, scriptedProbe } from "@/assistant/harness/evals/modelProbe";
import { evaluateBatch } from "@/assistant/harness/evals/evaluate";

describe("bounded, injected model probe (no provider calls)", () => {
  it("runs a scripted multi-step proposal through a mock executor and records results", async () => {
    let now = 0;
    const executor = { execute: vi.fn(async () => {
      now += 25;
      return { ok: true, message: "Mock acknowledged (not a real action)." };
    }) };
    const trace = await runModelEval(
      scriptedProbe([["list_past_conversations"], ["read_past_conversation"]]),
      executor,
      { metadata: { scenarioId: "choice-read-v-resume", modality: "voice", platform: "android" },
        now: () => now },
    );
    expect(trace.origin).toBe("mock");
    expect(trace.attempts.map((call) => call.tool)).toEqual(["list_past_conversations", "read_past_conversation"]);
    expect(trace.attempts.every((call) => call.status === "observed")).toBe(true);
    expect(trace.goal).toEqual({ passed: null, source: "unverified" });
    expect(executor.execute).toHaveBeenCalledTimes(2);
    const report = evaluateBatch([trace]);
    expect(report.overall.rates.pathAccuracy).toBe(1);
    expect(report.overall.rates.independentlyVerifiedGoalRate).toBeNull();
    expect(report.warnings[0]).toContain("NOT model accuracy");
  });

  it("rejects unexpected unbounded output and does not silently fabricate success", async () => {
    const executor = { execute: vi.fn(async () => ({ ok: true, message: "mock" })) };
    const infinite = { propose: async () => ({ calls: [{ id: "a", name: "capture_screen" }] }) };
    await expect(runModelEval(infinite, executor,
      { metadata: { scenarioId: "tool-capture_screen", modality: "typed", platform: "windows" },
        maxSteps: 2 })).rejects.toThrow("bounded step limit");
    const tooMany = { propose: async () => ({ calls: Array.from({ length: 13 },
      (_, i) => ({ id: String(i), name: "copy_text" })) }) };
    await expect(runModelEval(tooMany, executor,
      { metadata: { scenarioId: "tool-copy_text", modality: "typed", platform: "windows" } }))
      .rejects.toThrow("too many tools");
    await expect(runModelEval(scriptedProbe([]), executor,
      { metadata: { scenarioId: "unknown-eval", modality: "typed", platform: "windows" } }))
      .rejects.toThrow("Unknown evaluation fixture");
  });
});
