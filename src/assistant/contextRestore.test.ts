import { describe, expect, it } from "vitest";
import {
  ASSISTANT_CONTEXT_RECENT_MESSAGES,
  ASSISTANT_CONTEXT_TOTAL_CHARS,
  contextFingerprint,
  restoreAssistantContext,
  type ContextMessage,
} from "@/assistant/contextRestore";

function message(seq: number, role: ContextMessage["role"], body: string, extra?: Partial<ContextMessage>): ContextMessage {
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    seq,
    role,
    status: "final",
    body,
    ...extra,
  };
}

describe("restored assistant context", () => {
  it("gives a new session each saved turn once and stays inside the budget", () => {
    const messages = Array.from({ length: 24 }, (_, index) => message(
      index + 1,
      index % 2 === 0 ? "user" : "assistant",
      index === 0 ? `start ${"q".repeat(180)} OLDTAIL` : `Line ${index + 1}`,
    ));
    const restored = restoreAssistantContext({ messages, summary: null });
    const text = restored.turns.map((turn) => turn.text).join("\n");
    expect(text.length).toBeLessThanOrEqual(ASSISTANT_CONTEXT_TOTAL_CHARS);
    expect(text).toContain("Line 24");
    expect(text).not.toContain("OLDTAIL");
    expect(restored.summary?.throughSeq).toBe(24 - ASSISTANT_CONTEXT_RECENT_MESSAGES);
    expect(restored.summary?.fingerprint).toBe(contextFingerprint(messages.slice(0, 24 - ASSISTANT_CONTEXT_RECENT_MESSAGES)));
    expect(text).toContain(`through sequence ${restored.summary?.throughSeq}`);
    const recentBodies = restored.turns.filter((turn) => turn.role === "model" || turn.text.startsWith("Line"));
    expect(recentBodies.length).toBeLessThanOrEqual(ASSISTANT_CONTEXT_RECENT_MESSAGES + 1);
  });

  it("reuses a summary only when its watermark still matches, and drops a stale one", () => {
    const messages = [
      message(1, "user", "Meet on Friday."),
      message(2, "assistant", "Friday is the decision."),
      ...Array.from({ length: 8 }, (_, index) => message(index + 3, "user", `Later ${index}`)),
    ];
    const first = restoreAssistantContext({ messages, summary: null });
    if (!first.summary) throw new Error("expected a summary");
    const again = restoreAssistantContext({ messages, summary: first.summary });
    expect(again.summaryState).toBe("used");
    expect(again.summary).toBeNull();
    expect(again.turns.map((turn) => turn.text).join("\n")).toContain("Friday is the decision.");

    const removed = messages.filter((item) => item.seq !== 1);
    const stale = restoreAssistantContext({ messages: removed, summary: first.summary });
    const staleText = stale.turns.map((turn) => turn.text).join("\n");
    expect(stale.summaryState === "stale" || stale.summaryState === "clipped").toBe(true);
    expect(staleText).not.toContain("Meet on Friday.");
    expect(stale.recovery).toMatch(/out of date/);
  });

  it("keeps a correction and a finished tool, and does not turn the tool into a new call", () => {
    const messages = [
      message(1, "user", "I meant Friday, not Thursday."),
      message(2, "tool", "Opened the calendar.", { toolName: "open_app", toolOutcome: "Opened the calendar." }),
      message(3, "user", "What day did we keep?"),
    ];
    const restored = restoreAssistantContext({ messages, summary: null });
    const text = JSON.stringify(restored.turns);
    expect(text).toContain("I meant Friday, not Thursday.");
    expect(text).toContain("Already finished: open_app.");
    expect(text).toContain("Do not run this again.");
    expect(text).not.toContain("functionCall");
    expect(text).not.toContain("toolResponse");
  });

  it("says a saved screenshot has no image and is not the current screen", () => {
    const restored = restoreAssistantContext({
      messages: [message(1, "user", "Look at that window.")],
      summary: null,
      attachments: [{
        kind: "screenshot",
        id: "screenshot",
        body: "",
        capturedAt: "2026-09-29T12:00:00.000Z",
        source: "window",
      }],
    });
    const text = restored.turns.map((turn) => turn.text).join("\n");
    expect(text).toContain("not available");
    expect(text).toContain("not this device's current screen");
    expect(restored.unavailableScreenshots).toEqual([{ source: "window", capturedAt: "2026-09-29T12:00:00.000Z" }]);
    expect(text).not.toContain("jpeg");
  });

  it("does not seed an attachment that is still on this device", () => {
    const restored = restoreAssistantContext({
      messages: [message(1, "user", "Hello")],
      summary: null,
      attachments: [{
        kind: "note",
        id: "note-1",
        body: "Desk fact.",
        capturedAt: "2026-09-29T12:00:00.000Z",
        source: "",
      }],
      live: { noteIds: ["note-1"], hasSelection: false, handoffId: null, hasScreen: false },
    });
    expect(restored.turns.map((turn) => turn.text).join("\n")).not.toContain("Desk fact.");
  });

  it("leaves an interrupted line unfinished instead of inventing extra partials", () => {
    const restored = restoreAssistantContext({
      messages: [message(1, "assistant", "I was saying", { status: "interrupted" })],
      summary: null,
    });
    expect(restored.turns[0]).toEqual({ role: "model", text: "I was saying (unfinished)" });
    expect(restored.summaryState).toBe("none");
    expect(restored.summary).toBeNull();
  });
});
