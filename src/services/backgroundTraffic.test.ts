import { describe, expect, it, vi } from "vitest";
import { BackgroundTrafficBudget, DeviceHeartbeatGate } from "./backgroundTraffic";

describe("background Supabase traffic budget", () => {
  it("backs off on HTTP 402 instead of retrying every polling tick", () => {
    const budget = new BackgroundTrafficBudget();
    budget.noteFailure(new Error("exceed_egress_quota (HTTP 402)"), 1000);
    expect(budget.canPoll(1000 + 60_000)).toBe(false);
    expect(budget.canPoll(1000 + 300_000)).toBe(true);
    budget.noteFailure(new Error("Supabase quota exceeded (HTTP 402)"), 301_000);
    expect(budget.canPoll(301_000 + 300_000)).toBe(false);
    expect(budget.canPoll(301_000 + 600_000)).toBe(true);
    budget.noteSuccess();
    expect(budget.canPoll(301_000)).toBe(true);
  });

  it("backs off briefly from network outages without suppressing normal errors", () => {
    const budget = new BackgroundTrafficBudget();
    budget.noteFailure(new Error("Failed to fetch"), 100);
    expect(budget.canPoll(29_999)).toBe(false);
    expect(budget.canPoll(30_100)).toBe(true);
    budget.noteSuccess();
    budget.noteFailure(new Error("unsupported request type"), 50_000);
    expect(budget.canPoll(50_000)).toBe(true);
  });
});

describe("shared device presence", () => {
  it("deduplicates simultaneous beats and skips redundant polls for 25 seconds", async () => {
    let time = 1000;
    const gate = new DeviceHeartbeatGate(new BackgroundTrafficBudget(), 25_000, () => time);
    const write = vi.fn(async () => undefined);
    await Promise.all([gate.touch("one", write), gate.touch("one", write), gate.touch("one", write)]);
    expect(write).toHaveBeenCalledTimes(1);
    time += 24_000;
    await gate.touch("one", write);
    expect(write).toHaveBeenCalledTimes(1);
    time += 1001;
    await gate.touch("one", write);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("does not hide failed writes or mark a failing heartbeat as sent", async () => {
    let time = 1000;
    const budget = new BackgroundTrafficBudget();
    const gate = new DeviceHeartbeatGate(budget, 25_000, () => time);
    const write = vi.fn().mockRejectedValueOnce(new Error("Failed to fetch")).mockResolvedValue(undefined);
    await expect(gate.touch("one", write)).rejects.toThrow("Failed to fetch");
    expect(write).toHaveBeenCalledTimes(1);
    time += 30_000;
    await gate.touch("one", write);
    expect(write).toHaveBeenCalledTimes(2);
  });
});
