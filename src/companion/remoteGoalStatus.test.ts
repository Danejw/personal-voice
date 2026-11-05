import { describe, expect, it } from "vitest";
import { remoteGoalStillActive } from "@/companion/remoteGoalStatus";

describe("Companion remote goal status", () => {
  it("polls a signed start receipt without treating it as completion", () => {
    expect(remoteGoalStillActive("Computer Use goal accepted on Windows. Check status.")).toBe(true);
  });
  it("recognizes running and terminal Windows reports", () => {
    expect(remoteGoalStillActive("Computer Use job req-1: running; 3 steps")).toBe(true);
    expect(remoteGoalStillActive("Computer Use stopping; 3 steps")).toBe(true);
    expect(remoteGoalStillActive("Computer Use job req-1: needs_review; 4 steps")).toBe(false);
    expect(remoteGoalStillActive("Computer Use completed; 6 steps")).toBe(false);
    expect(remoteGoalStillActive("No Computer Use session has been started on this PC.")).toBe(false);
  });
  it("does not infer progress from unknown responses", () => {
    expect(remoteGoalStillActive("Request was queued.")).toBe(false);
  });
});
