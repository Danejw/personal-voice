import { describe, expect, it } from "vitest";
import { leaseIsCurrent } from "@/assistant/lease";

describe("assistant lease", () => {
  const now = Date.parse("2026-09-30T12:00:00.000Z");
  const device = "33333333-3333-4333-8333-333333333333";

  it("is current only for this device before the expiry", () => {
    expect(leaseIsCurrent({
      leaseDeviceId: device,
      leaseExpiresAt: "2026-09-30T12:00:45.000Z",
      deviceId: device,
      now,
    })).toBe(true);
    expect(leaseIsCurrent({
      leaseDeviceId: device,
      leaseExpiresAt: "2026-09-30T12:00:00.000Z",
      deviceId: device,
      now,
    })).toBe(false);
    expect(leaseIsCurrent({
      leaseDeviceId: "55555555-5555-4555-8555-555555555555",
      leaseExpiresAt: "2026-09-30T12:00:45.000Z",
      deviceId: device,
      now,
    })).toBe(false);
    expect(leaseIsCurrent({
      leaseDeviceId: null,
      leaseExpiresAt: null,
      deviceId: device,
      now,
    })).toBe(false);
  });
});
