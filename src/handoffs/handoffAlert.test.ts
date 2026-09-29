import { describe, expect, it } from "vitest";
import type { Handoff, OwnedDevice } from "@/handoffs/handoff";
import { initialArrivalState, nextArrivals } from "@/handoffs/handoffAlert";
import type { ArrivalSnapshot } from "@/handoffs/handoffAlert";

const office: OwnedDevice = {
  id: "office",
  name: "Office PC",
  platform: "windows",
  lastSeen: null,
};

function handoff(id: string, text = "hello from the other computer"): Handoff {
  return {
    id,
    text,
    sourceDeviceId: office.id,
    targetDeviceId: null,
    createdAt: "2026-09-28T12:00:00.000Z",
    consumedAt: null,
  };
}

function synced(received: Handoff[]): ArrivalSnapshot {
  return { status: "synced", received, devices: [office] };
}

describe("handoff arrival alerts", () => {
  it("does not alert for handoffs already pending on the first load", () => {
    const first = nextArrivals(initialArrivalState(), synced([handoff("a")]));
    expect(first.alerts).toEqual([]);
    expect(first.state.primed).toBe(true);
    expect(first.state.seen.has("a")).toBe(true);
  });

  it("alerts once when a new handoff arrives after the first load", () => {
    const first = nextArrivals(initialArrivalState(), synced([handoff("a")]));
    const second = nextArrivals(first.state, synced([handoff("a"), handoff("b", "Meet at noon")]));
    expect(second.alerts).toEqual([{ id: "b", title: "Office PC", body: "Meet at noon" }]);
    const third = nextArrivals(second.state, synced([handoff("a"), handoff("b", "Meet at noon")]));
    expect(third.alerts).toEqual([]);
  });

  it("keeps the seen set when a reload fails, so old rows do not alert again", () => {
    const first = nextArrivals(initialArrivalState(), synced([handoff("a")]));
    const failed = nextArrivals(first.state, { status: "offline", received: [], devices: [office] });
    expect(failed.alerts).toEqual([]);
    expect(failed.state.seen.has("a")).toBe(true);
    const again = nextArrivals(failed.state, synced([handoff("a")]));
    expect(again.alerts).toEqual([]);
  });
});
