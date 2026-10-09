import { afterEach, describe, expect, it, vi } from "vitest";
import { currentPointerSample, trackAssistantPointer } from "@/assistant/pointerAwareness";

afterEach(() => { vi.useRealTimers(); });

describe("Windows Assistant pointer awareness", () => {
  it("tracks physical desktop coordinates in memory and discards them on stop", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T15:00:00Z"));
    const read = vi.fn().mockResolvedValue({ x: -480, y: 225 });
    const stop = trackAssistantPointer(read);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(currentPointerSample()).toMatchObject({ x: -480, y: 225 });
    await vi.advanceTimersByTimeAsync(250);
    expect(read).toHaveBeenCalledTimes(2);
    stop();
    expect(currentPointerSample()).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("ignores a late position read after tracking ends", async () => {
    let finish: (position: { x: number; y: number }) => void = () => {};
    const read = vi.fn(() => new Promise<{ x: number; y: number }>((resolve) => { finish = resolve; }));
    const stop = trackAssistantPointer(read);
    stop();
    finish({ x: 122, y: 345 });
    await Promise.resolve();
    expect(currentPointerSample()).toBeNull();
  });

  it("handles access failures without retaining stale data", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockRejectedValue(new Error("No cursor access"));
    const stop = trackAssistantPointer(read);
    await Promise.resolve();
    expect(currentPointerSample()).toBeNull();
    await vi.advanceTimersByTimeAsync(250);
    expect(read).toHaveBeenCalledTimes(2);
    stop();
  });
});
