import { describe, expect, it } from "vitest";
import {
  assistantPhase, companionGaze, defaultMonitorIndex, isPointerSample, monitorFromIndex,
} from "@/companion/companionGeometry";
import { initialAssistantState } from "@/assistant/state";

const monitors = [
  { x: -2560, y: -100, width: 2560, height: 1440 },
  { x: 0, y: 0, width: 3840, height: 2160 },
  { x: 3840, y: 180, width: 1920, height: 1080 },
];

describe("Android companion monitor geometry", () => {
  it("defaults below the horizontal center screen, even with negative desktop origins", () => {
    expect(defaultMonitorIndex(monitors)).toBe(1);
    expect(monitorFromIndex(monitors, 1)).toEqual(monitors[1]);
    const center = companionGaze({ x: 1920, y: 700 }, monitors, 1);
    const left = companionGaze({ x: -2400, y: 400 }, monitors, 1);
    const right = companionGaze({ x: 5300, y: 400 }, monitors, 1);
    expect(Math.abs(center.x)).toBeLessThan(0.01);
    expect(left.x).toBeLessThan(0);
    expect(right.x).toBeGreaterThan(0);
  });

  it("scales by the chosen monitor and handles dissimilar resolutions", () => {
    const leftScreen = companionGaze({ x: -2500, y: 800 }, monitors, 0);
    const rightScreen = companionGaze({ x: -2500, y: 800 }, monitors, 2);
    expect(leftScreen.x).toBeLessThan(0);
    expect(rightScreen.x).toBeLessThan(leftScreen.x);
    expect(companionGaze({ x: NaN, y: 3 }, monitors, 0)).toEqual({ x: 0, y: 0 });
    expect(companionGaze({ x: 1, y: 1 }, [], 0)).toEqual({ x: 0, y: 0 });
  });

  it("accepts physical monitor rectangles without cursor logs or application data", () => {
    expect(isPointerSample({ x: -2200, y: 350, monitors })).toBe(true);
    expect(isPointerSample({ x: 0, y: 0, monitors: [] })).toBe(false);
    expect(isPointerSample({ x: 0, y: 0, monitors: [{ x: 0, y: 0, width: 0, height: 200 }] })).toBe(false);
  });

  it("maps existing voice state without creating an independent session", () => {
    expect(assistantPhase(initialAssistantState)).toBe("idle");
    expect(assistantPhase({ ...initialAssistantState, status: "CONNECTING" })).toBe("thinking");
    expect(assistantPhase({ ...initialAssistantState, status: "READY" })).toBe("listening");
    expect(assistantPhase({ ...initialAssistantState, status: "RESPONDING" })).toBe("speaking");
  });
});
