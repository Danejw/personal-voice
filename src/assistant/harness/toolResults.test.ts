import { describe, expect, it } from "vitest";
import { assistantToolResponse } from "@/assistant/protocol";
import {
  ASSISTANT_RESULT_GUIDANCE,
  ToolFailureHistory,
  interpretToolResult,
} from "@/assistant/harness/toolResults";

describe("tool result interpretation", () => {
  it("distinguishes observed evidence from action acknowledgement", () => {
    const observation = interpretToolResult("list_voice_notes", true, "Notes (1): milk");
    expect(observation).toMatchObject({
      status: "observed", evidence: "read_result", goal_verified: null,
      failure_kind: null, failure_streak: 0,
    });
    expect(observation.next_step).toContain("returned evidence");
    const screen = interpretToolResult("capture_screen", true, "Captured the screen.");
    expect(screen).toMatchObject({ status: "observed", evidence: "capture_attached", goal_verified: null });
    const action = interpretToolResult("insert_text", true, "Inserted the text.");
    expect(action).toMatchObject({
      status: "acknowledged", evidence: "action_acknowledged", goal_verified: null,
    });
    expect(action.next_step).toContain("not independently verified");
    expect(action.verification_hint).toContain("Focused-field");
  });

  it("never treats playbook lookup as task completion", () => {
    const assessment = interpretToolResult("get_tool_playbook", true, '{"kind":"tool_playbook"}');
    expect(assessment).toMatchObject({
      status: "reference", evidence: "reference_only", goal_verified: null,
    });
    expect(assessment.next_step).toContain("did not perform");
  });

  it("detects known incomplete screen tasks even when legacy runner returned success", () => {
    for (const message of [
      "Stopped after 8 steps. The latest screen was checked.",
      "Stopped. Nothing further was done.",
    ]) {
      const result = interpretToolResult("supervise_screen", true, message);
      expect(result).toMatchObject({ status: "incomplete", goal_verified: null });
      expect(result.next_step).toContain("without restarting it automatically");
    }
    expect(interpretToolResult("supervise_screen", true, "Clicked the button.").status)
      .toBe("acknowledged");
    expect(interpretToolResult("inspect_active_app", true, "No accessible text was available.").status)
      .toBe("incomplete");
  });

  it("classifies cancellation before other failures and never recommends retrying", () => {
    for (const message of ["The user cancelled. Nothing was changed.", "User declined the action."]) {
      const result = interpretToolResult("insert_text", false, message, 2);
      expect(result.status).toBe("cancelled");
      expect(result.failure_kind).toBe("cancelled");
      expect(result.next_step).toContain("Do not retry");
    }
  });

  it.each([
    ["Another action is already waiting for confirmation.", "busy", "blocked"],
    ["The action arguments were not an object.", "invalid_arguments", "failed"],
    ["The locator is stale.", "stale_target", "failed"],
    ["The named device is offline.", "offline", "failed"],
    ["Windows-only accessibility tool.", "unavailable", "blocked"],
    ["Network request timed out.", "transient", "failed"],
    ["Saving the note failed.", "unknown", "failed"],
  ] as const)("classifies '%s' as %s", (message, kind, status) => {
    const result = interpretToolResult("open_app", false, message, 1);
    expect(result).toMatchObject({ failure_kind: kind, status, goal_verified: null });
    expect(result.next_step.length).toBeGreaterThan(15);
  });

  it("caps retry guidance at two consecutive failures and resets without storing arguments", () => {
    const history = new ToolFailureHistory();
    expect(history.record("read_remote_device", false)).toBe(1);
    expect(history.record("read_remote_device", false)).toBe(2);
    expect(history.record("read_remote_device", false)).toBe(2);
    expect(interpretToolResult("read_remote_device", false, "Timed out.", 2).next_step)
      .toContain("Do not repeat");
    expect(history.record("read_remote_device", true)).toBe(0);
    expect(history.record("read_remote_device", false)).toBe(1);
    history.reset();
    expect(history.record("read_remote_device", false)).toBe(1);
  });

  it("does not emit original request data as interpretation metadata", () => {
    const privateText = "private token 12345";
    const info = interpretToolResult("create_voice_note", true, privateText);
    expect(JSON.stringify(info)).not.toContain(privateText);
    expect(info.verification_hint).toContain("Notes service");
  });

  it("adds structured information without renaming the existing Live result and error fields", () => {
    const success = interpretToolResult("copy_text", true, "Copied to the clipboard.");
    const error = interpretToolResult("copy_text", false, "The user cancelled.", 1);
    const responses = assistantToolResponse([
      { id: "1", name: "copy_text", ok: true, message: "Copied to the clipboard.", interpretation: success },
      { id: "2", name: "copy_text", ok: false, message: "The user cancelled.", interpretation: error },
    ]).toolResponse.functionResponses;
    expect(responses[0]).toMatchObject({
      id: "1", response: { result: "Copied to the clipboard.", interpretation: { status: "acknowledged" } },
    });
    expect(responses[1]).toMatchObject({
      id: "2", response: { error: "The user cancelled.", interpretation: { status: "cancelled" } },
    });
    expect(ASSISTANT_RESULT_GUIDANCE).toContain("NOT proof");
  });
});
