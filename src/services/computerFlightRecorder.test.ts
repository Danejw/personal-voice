import { describe, expect, it } from "vitest";
import {
  flightActionName, flightDiagnosis, flightFailureCode,
} from "@/services/computerFlightRecorder";

describe("Computer Use flight recorder metadata", () => {
  it("refuses raw model text, screenshot data and arguments in action labels", () => {
    expect(flightActionName("click")).toBe("click");
    expect(flightActionName("computer_goal_status")).toBe("computer_goal_status");
    expect(flightActionName("type password secret")).toBe("unsupported");
    expect(flightActionName("https://example.org")).toBe("unsupported");
    expect(flightActionName(null)).toBeNull();
  });

  it("normalizes failures into a safe fixed vocabulary", () => {
    expect(flightFailureCode(new Error("Windows desktop locked"))).toBe("locked");
    expect(flightFailureCode(new TypeError("Failed to fetch"))).toBe("network");
    expect(flightFailureCode(new Error("Computer Use rate-limited"))).toBe("model");
    expect(flightFailureCode(new Error("Signature could not be authenticated"))).toBe("auth");
    expect(flightFailureCode(new Error("Database secret token: do not store"), "tool")).toBe("tool");
    expect(flightFailureCode(new Error("Windows could not open Notepad."), "tool")).toBe("unavailable");
  });

  it("never treats receipt delivery or executed clicks as verified success", () => {
    expect(flightDiagnosis([{ stage: "acknowledged", actor: "android", failure_code: null }]))
      .toBe("Command acknowledged, result not verified");
    expect(flightDiagnosis([
      { stage: "acted", actor: "windows", failure_code: null },
      { stage: "queued", actor: "android", failure_code: null },
    ])).toBe("Task in progress");
    expect(flightDiagnosis([
      { stage: "verified", actor: "windows", failure_code: null },
      { stage: "acknowledged", actor: "android", failure_code: null },
    ])).toBe("Verified on Windows");
  });

  it("distinguishes an actual Windows failure from a phone timeout", () => {
    expect(flightDiagnosis([{ stage: "failed", actor: "windows", failure_code: "capture" }]))
      .toBe("Windows: failed (capture)");
    expect(flightDiagnosis([{ stage: "timeout", actor: "android", failure_code: "timeout" }]))
      .toBe("Android: timeout (timeout)");
  });
});
