import { describe, expect, it } from "vitest";
import type { NearbyDevice } from "@/spatial/spatialDevices";
import type { DeviceIdentity } from "@/spatial/deviceCapabilities";
import { availableNearbyActions } from "@/spatial/deviceActionRegistry";

const device: NearbyDevice = {
  id: "lan-abcd123456", name: "TV", kind: "display",
  source: "lan", ipAddress: "192.168.0.27", detail: "TCP 3001",
};
const identity: DeviceIdentity = {
  ipAddress: "192.168.0.27", name: "LG webOS TV", manufacturer: "LG",
  model: "C4", features: ["lg_remote"], lgFingerprint: "a".repeat(64),
  lgPaired: false, samsungPaired: false,
};

describe("universal local capability mapping", () => {
  it("never infers remote control from an IP, a name or Bluetooth", () => {
    expect(availableNearbyActions(device, null)).toEqual([]);
    expect(availableNearbyActions({ ...device, source: "bluetooth", ipAddress: undefined }, identity)
      .map(a => a.action)).toEqual(["bluetooth_settings"]);
    expect(availableNearbyActions({ ...device, pairedDeviceId: "signed-id" }, identity)).toEqual([]);
  });

  it("requires matching verified native identity before offering actions", () => {
    expect(availableNearbyActions(device, { ...identity, ipAddress: "192.168.0.1" })).toEqual([]);
    expect(availableNearbyActions(device, { ...identity, lgFingerprint: undefined })).toEqual([]);
    expect(availableNearbyActions(device, identity).find(a => a.action === "pair"))
      .toMatchObject({ protocol: "lg-webos", authorization: "tv-approval" });
    expect(availableNearbyActions(device, { ...identity, lgPaired: true }).find(a => a.action === "volume_up"))
      .toMatchObject({ protocol: "lg-webos", authorization: "paired-tv" });
  });

  it("selects the supported native adapter, preferring TV control over UPnP duplicates", () => {
    const combined = { ...identity, features: ["lg_remote", "volume", "playback", "open_web"] as DeviceIdentity["features"] };
    const actions = availableNearbyActions(device, combined);
    expect(actions.find(a => a.action === "volume_up")?.protocol).toBe("lg-webos");
    expect(actions.find(a => a.action === "play")?.protocol).toBe("lg-webos");
    expect(actions.find(a => a.action === "open_web")?.protocol).toBe("web");
    expect(actions.find(a => a.action === "show_message")?.protocol).toBe("lg-webos");
  });

  it("offers only UPnP actions when no TV remote protocol was verified", () => {
    const actions = availableNearbyActions(device, {
      ...identity, features: ["volume", "playback"], lgFingerprint: undefined,
    });
    expect(actions.map(a => a.action).sort()).toEqual(["pause", "play", "volume_down", "volume_up"]);
    expect(actions.every(a => a.protocol === "upnp")).toBe(true);
  });
});
