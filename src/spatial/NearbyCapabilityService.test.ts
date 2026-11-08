import { beforeEach, describe, expect, it, vi } from "vitest";
import { NearbyCapabilityService } from "@/spatial/NearbyCapabilityService";
const mocked = vi.hoisted(() => vi.fn());
vi.mock("@/platform/android/voicePlatformPlugin", () => ({ callPlugin: mocked }));
const ip = "192.168.0.27";
const id = "lan-abcdef012345";
const scan = {
  networkLabel: "192.168.0.4/24",
  devices: [{ id, name: "Device " + ip, kind: "media", source: "lan", detail: "TCP 80", ipAddress: ip }],
};
const identity = {
  ipAddress: ip, name: "Media Renderer", manufacturer: "Example",
  model: "1", features: ["volume", "playback", "open_web"],
};

beforeEach(() => {
  mocked.mockReset();
  mocked.mockImplementation(async (command: string) => {
    if (command === "scan_nearby_devices") return scan;
    if (command === "inspect_nearby_device") return identity;
    if (command === "nearby_media_action") return { message: "Volume request accepted." };
    if (command === "open_nearby_web") return {};
    throw new Error("Unexpected command " + command);
  });
});

describe("shared nearby capability inventory", () => {
  it("reports observed devices with the exact eligible actions, but does not execute any", async () => {
    const service = new NearbyCapabilityService();
    const result = JSON.parse(await service.describe([], "local-phone", []));
    expect(result.observed).toBe("fresh_android_local_scan");
    expect(result.devices[0]).toMatchObject({
      id, identification: "inspected", manufacturer: "Example",
    });
    expect(result.devices[0].actions[0]).toMatchObject({
      name: "open_web", protocol: "web", authorization: "none",
    });
    expect(result.devices[0].actions.map((a: {name:string})=>a.name))
      .toEqual(["open_web", "volume_up", "volume_down", "play", "pause"]);
    expect(mocked).not.toHaveBeenCalledWith("nearby_media_action", expect.anything());
  });

  it("searches a named device and distinguishes saved bonds from live observations", async () => {
    mocked.mockImplementation(async (command: string) => {
      if (command === "scan_nearby_devices") return { devices: [
        { id: "bt-abcdef000001", name: "LG webOS TV", kind: "speaker",
          source: "bluetooth-paired", detail: "Paired Bluetooth", paired: true, observedNow: false },
        { id: "mdns-abcdef000002", name: "SpotifyConnect", kind: "speaker",
          source: "mdns", detail: "_spotify-connect._tcp.", observedNow: true },
        { ...scan.devices[0], observedNow: true },
      ] };
      if (command === "inspect_nearby_device") return identity;
      throw new Error("Unexpected action: " + command);
    });
    const service = new NearbyCapabilityService();
    const found = JSON.parse(await service.describe([], "phone", [], "LG"));
    expect(found.query).toBe("LG");
    expect(found.matching_devices).toBe(1);
    expect(found.live_observed).toBe(2);
    expect(found.saved_pairings_not_observed).toBe(1);
    expect(found.devices[0]).toMatchObject({
      name: "LG webOS TV", presence: "saved_pairing_not_observed", paired_with_android: true,
    });
    expect(found.devices[0].actions.map((a: {name: string}) => a.name))
      .toEqual(["bluetooth_settings"]);
  });

  it("requires last-scanned IDs and refuses invented IDs or unsupported controls", async () => {
    const service = new NearbyCapabilityService();
    await service.scan([], "phone", []);
    await expect(service.act("lan-000000000000", "volume_up")).rejects.toThrow("not returned");
    await expect(service.act(id, "home")).rejects.toThrow("not supported");
    expect(mocked).not.toHaveBeenCalledWith("nearby_media_action", expect.anything());
  });

  it("maps approved generic actions into the existing native protocol, never arbitrary URLs", async () => {
    const service = new NearbyCapabilityService();
    await service.scan([], "phone", []);
    expect(await service.act(id, "volume_up")).toBe("Volume request accepted.");
    expect(mocked).toHaveBeenCalledWith("nearby_media_action",
      { ipAddress: ip, action: "volume_up" });
    expect(await service.act(id, "open_web")).toContain("page");
    expect(mocked).toHaveBeenCalledWith("open_nearby_web", { ipAddress: ip });
  });

  it("does not offer control for an unaddressed service name", async () => {
    mocked.mockImplementation(async (command: string) => {
      if (command === "scan_nearby_devices") {
        return { devices: [{ id: "mdns-abcdef012345", source: "mdns", kind: "speaker",
          name: "SpotifyConnect", detail: "_spotify-connect._tcp." }] };
      }
      throw new Error("No native action available.");
    });
    const service = new NearbyCapabilityService();
    const report = JSON.parse(await service.describe([], "phone", []));
    expect(report.devices[0]).toMatchObject({ identification: "advertisement_only", actions: [] });
    await expect(service.act("mdns-abcdef012345", "play")).rejects.toThrow("not supported");
  });
});
