import { describe, expect, it } from "vitest";
import {
  computerUseBody,
  isUnsupportedAction,
  planComputerStep,
  planRemoteComputerAction,
  safetyClass,
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
