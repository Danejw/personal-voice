import { describe, expect, it } from "vitest";
import { parseDeviceLinkWake } from "@/device-link/cloudSignaling";
import { parseDiscoveredPeer } from "@/device-link/androidLan";

const userId = "00000000-0000-4000-8000-000000000000";
const sender = "00000000-0000-4000-8000-000000000001";
const target = "00000000-0000-4000-8000-000000000002";
const id = "00000000-0000-4000-8000-000000000003";
const requestId = "00000000-0000-4000-8000-000000000004";

describe("DeviceLink untrusted discovery and cloud events", () => {
  it("accepts fresh target-scoped hints and rejects wrong ownership", () => {
    const now = Date.now();
    const hint = {
      id, user_id: userId, sender_device_id: sender,
      target_device_id: target, request_id: requestId,
      family: "remote-dictation",
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + 30_000).toISOString(),
    };
    expect(parseDeviceLinkWake(hint, userId, target, now)).toMatchObject({ requestId, senderDeviceId: sender });
    expect(parseDeviceLinkWake(hint, userId, sender, now)).toBeNull();
    expect(parseDeviceLinkWake(hint, sender, target, now)).toBeNull();
    expect(parseDeviceLinkWake({ ...hint, family: "cursor" }, userId, target, now)).toBeNull();
    expect(parseDeviceLinkWake({ ...hint, expires_at: new Date(now - 1).toISOString() }, userId, target, now)).toBeNull();
  });
  it("only accepts LAN discovery from private IPv4 addresses", () => {
    const original = { deviceId: sender, host: "192.168.1.30", port: 42001 };
    expect(parseDiscoveredPeer(original)).toEqual(original);
    expect(parseDiscoveredPeer({ ...original, host: "8.8.8.8" })).toBeNull();
    expect(parseDiscoveredPeer({ ...original, host: "http://192.168.1.30" })).toBeNull();
    expect(parseDiscoveredPeer({ ...original, port: 80 })).toBeNull();
    expect(parseDiscoveredPeer({ ...original, deviceId: "../other" })).toBeNull();
  });
});
