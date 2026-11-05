import { describe, expect, it } from "vitest";
import {
  computerUseBody,
  dragEndpoints,
  isUnsupportedAction,
  isTrustedRemoteAction,
  planComputerStep,
  planRemoteComputerAction,
  parseInteraction,
  parseRemotePointer,
  safetyClass,
  validateComputerCall,
  validateOpenApp,
  validateShortcut,
} from "@/assistant/computerActions";

const started = 1_000;

describe("computer action safety", () => {
  it("classifies reads, low-risk actions, and refuses shell and delete", () => {
    expect(safetyClass("take_screenshot")).toBe("read");
    expect(safetyClass("open_app")).toBe("low");
    expect(safetyClass("click")).toBe("low");
    expect(safetyClass("type", { press_enter: true })).toBe("high");
    expect(safetyClass("run_shell")).toBe("unsupported");
    expect(safetyClass("delete_file")).toBe("unsupported");
    expect(isUnsupportedAction("shell")).toBe(true);
    expect(validateOpenApp("Calculator")).toEqual({ ok: true, id: "calculator", label: "Calculator" });
    expect(validateOpenApp("powershell").ok).toBe(false);
    expect(validateShortcut("copy")).toMatchObject({ ok: true, id: "copy" });
    expect(validateShortcut("alt+f4").ok).toBe(false);
  });

  it("asks before a high-impact step and reports a real stop", () => {
    const enter = planComputerStep(
      { name: "type", args: { text: "hello", press_enter: true } },
      0,
      started,
      started + 10,
      false,
    );
    expect(enter.action).toBe("confirm");
    const blocked = planComputerStep(
      { name: "click", args: { x: 10, y: 10, safety_decision: { decision: "blocked", explanation: "Prompt injection." } } },
      0,
      started,
      started + 10,
      false,
    );
    expect(blocked).toEqual({ action: "stop", message: "Prompt injection." });
    const cancelled = planComputerStep({ name: "click", args: { x: 1, y: 2 } }, 0, started, started, true);
    expect(cancelled).toEqual({ action: "stop", message: "Stopped. Nothing further was done." });
  });

  it("rejects bad coordinates and stops at the step and time caps", () => {
    expect(planComputerStep({ name: "click", args: { x: 1000, y: 1 } }, 0, started, started, false).action).toBe("stop");
    expect(planComputerStep({ name: "click", args: { x: 1, y: 1 } }, 8, started, started, false)).toMatchObject({
      message: "Stopped after 8 steps.",
    });
    expect(planComputerStep({ name: "click", args: { x: 1, y: 1 } }, 1, started, started + 45_000, false)).toMatchObject({
      message: "Stopped because the task ran too long.",
    });
  });

  it("validates visible pointer actions, bounds and explicit drag confirmation", () => {
    expect(validateComputerCall({ name: "move", args: { x: 0, y: 999 } }).ok).toBe(true);
    expect(validateComputerCall({ name: "right_click", args: { x: 500, y: 500 } }).ok).toBe(true);
    expect(validateComputerCall({ name: "right_click", args: { x: -1, y: 500 } }).ok).toBe(false);
    expect(validateComputerCall({ name: "drag", args: { x: 100, y: 100, end_x: 900, end_y: 900 } }).ok).toBe(true);
    expect(validateComputerCall({ name: "drag", args: { x: 100, y: 100, end_x: 1000, end_y: 900 } }).ok).toBe(false);
    expect(planComputerStep({ name: "drag", args: { x: 100, y: 100, end_x: 900, end_y: 900 } }, 0, started, started, false).action).toBe("confirm");
    expect(planComputerStep({ name: "right_click", args: { x: 500, y: 500 } }, 0, started, started, true).action).toBe("stop");
    expect(dragEndpoints([[0, 0], [500, 500], [999, 999]])).toEqual({ x: 0, y: 0, endX: 999, endY: 999 });
    expect(dragEndpoints([{ x: 20, y: 30 }, { x: 40, y: 50 }])).toEqual({ x: 20, y: 30, endX: 40, endY: 50 });
    expect(dragEndpoints([[0, 0], [1000, 50]])).toBeNull();
    expect(validateComputerCall({ name: "drag_and_drop", args: { path: [[0, 0], [999, 999]] } }).ok).toBe(true);
    expect(validateComputerCall({ name: "drag_and_drop", args: { path: [[0, 0], [-1, 999]] } }).ok).toBe(false);
    expect(safetyClass("drag_and_drop")).toBe("high");
    expect(safetyClass("drag")).toBe("high");
    expect(planComputerStep({ name: "drag", args: { x: 100, y: 100, end_x: 900, end_y: 900 } },
      0, started, started, false, { maxSteps: 240, maxDurationMs: 1800000, allowRoutineDrag: true }).action)
      .toBe("execute");
    expect(planComputerStep({ name: "drag", args: { x: 100, y: 100, end_x: 900, end_y: 900,
      safety_decision: { decision: "require_confirmation", explanation: "User approval required." } } },
      0, started, started, false, { maxSteps: 240, maxDurationMs: 1800000, allowRoutineDrag: true }).action)
      .toBe("confirm");

    expect(safetyClass("right_click")).toBe("low");
  });

  it("denies a remote shell, an offline-style opt-out, and a phone", () => {
    expect(planRemoteComputerAction("run_shell", "dir", "windows", true)).toEqual({
      action: "deny",
      message: "That action is not available.",
    });
    expect(planRemoteComputerAction("open_app", "notepad", "windows", false)).toMatchObject({
      message: "Remote actions are turned off on this PC.",
    });
    expect(planRemoteComputerAction("open_app", "notepad", "android", true)).toMatchObject({
      message: "This device can't run desktop actions.",
    });
    expect(planRemoteComputerAction("open_app", "notepad", "windows", true)).toEqual({
      action: "confirm",
      label: "Open Notepad",
    });
  });

  it("requires PC confirmation for bounded signed pointer commands", () => {
    expect(parseRemotePointer("drag_pointer", "0,500,999,501")).toEqual({ kind: "drag", x: 0, y: 500, endX: 999, endY: 501 });
    expect(parseRemotePointer("click_pointer", "500,500")).toEqual({ kind: "click", x: 500, y: 500 });
    for (const invalid of ["-1,500", "1000,500", "500, 500", "500,500,500", "01,500", "500;500"]) {
      expect(planRemoteComputerAction("click_pointer", invalid, "windows", true).action).toBe("deny");
    }
    expect(planRemoteComputerAction("drag_pointer", "0,0,999,999", "windows", true)).toMatchObject({ action: "confirm" });
    expect(planRemoteComputerAction("click_pointer", "500,500", "windows", false).action).toBe("deny");
    expect(planRemoteComputerAction("click_pointer", "500,500", "android", true).action).toBe("deny");
  });

  it("permits one signed remote Computer Use goal, with exact status/stop arguments", () => {
    expect(planRemoteComputerAction("start_computer_goal", "Organize the open windows.", "windows", true))
      .toMatchObject({ action: "confirm", label: expect.stringContaining("Computer Use") });
    expect(planRemoteComputerAction("computer_goal_status", "current", "windows", true).action).toBe("confirm");
    expect(planRemoteComputerAction("stop_computer_goal", "current", "windows", true).action).toBe("confirm");
    expect(planRemoteComputerAction("computer_goal_status", "any", "windows", true).action).toBe("deny");
    expect(planRemoteComputerAction("start_computer_goal", "a".repeat(1001), "windows", true).action).toBe("deny");
    expect(planRemoteComputerAction("start_computer_goal", "Do useful work", "windows", false).action).toBe("deny");
    expect(planRemoteComputerAction("start_computer_goal", "Do useful work", "android", true).action).toBe("deny");
    expect(isTrustedRemoteAction("start_computer_goal", "Organize notes")).toBe(false);
  });

  it("validates scroll directions and bounded finite waits before execution", () => {
    expect(validateComputerCall({ name: "scroll", args: { x: 400, y: 600, direction: "down" } })).toEqual({ ok: true });
    expect(validateComputerCall({ name: "scroll", args: { x: 400, y: 600, direction: "diagonal" } }).ok).toBe(false);
    expect(validateComputerCall({ name: "wait", args: { seconds: 2 } })).toEqual({ ok: true });
    expect(validateComputerCall({ name: "wait", args: { seconds: Number.NaN } }).ok).toBe(false);
    expect(validateComputerCall({ name: "wait", args: { seconds: Number.POSITIVE_INFINITY } }).ok).toBe(false);
  });

  it("supports a bounded longer goal without weakening blocked-action decisions", () => {
    const limits = { maxSteps: 240, maxDurationMs: 30 * 60_000 };
    expect(planComputerStep({ name: "click", args: { x: 10, y: 20 } }, 100, started, started + 60_000, false, limits).action).toBe("execute");
    expect(planComputerStep({ name: "click", args: { x: 10, y: 20 } }, 240, started, started, false, limits).action).toBe("stop");
    expect(planComputerStep({ name: "delete_file", args: {} }, 4, started, started + 500, false, limits).action).toBe("stop");
    expect(planComputerStep({ name: "click", args: { x: 10, y: 20 } }, 2, started, started + limits.maxDurationMs, false, limits).action).toBe("stop");
  });

  it("uses the exact function-call id and places the screenshot inside result contents", () => {
    const parsed = parseInteraction({ id: "inter-1", steps: [{
      type: "function_call", id: "call-123", name: "click", arguments: { x: 1, y: 2 },
    }] });
    expect(parsed.callId).toBe("call-123");
    const body = computerUseBody("Click.", null, "inter-1", {
      name: "click", callId: parsed.callId!, result: "Clicked", acknowledgement: false, imageBase64: "jpeg",
    });
    expect(body).toMatchObject({ previous_interaction_id: "inter-1", input: [{
      type: "function_result", call_id: "call-123", name: "click",
      result: [{ type: "text", text: "Clicked" }, { type: "image", data: "jpeg", mime_type: "image/jpeg" }],
    }] });
    expect(JSON.stringify(body)).not.toContain('"parts"');
  });

  it("builds a desktop Computer Use request with prompt-injection detection and no shell tool", () => {
    const body = computerUseBody("Click the harmless button.", "abc", null, null);
    expect(body.model).toBe("gemini-3.8-flash");
    const tool = (body.tools as { type: string; environment: string; enable_prompt_injection_detection: boolean }[])[0];
    expect(tool).toMatchObject({
      type: "computer_use",
      environment: "desktop",
      enable_prompt_injection_detection: true,
    });
    expect(JSON.stringify(body)).not.toContain("run_shell");
  });
});
