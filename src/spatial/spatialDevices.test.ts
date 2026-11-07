import { describe, expect, it } from "vitest";
import type { OwnedDevice } from "@/handoffs/handoff";
import {
  clampPosition, mergePersonalVoicePeers, parseNearbyScan, readPositions,
} from "@/spatial/spatialDevices";

const pcId = "ec1ab9a2-5341-49e1-a0af-dfdc30b827b8";
const strangerId = "16f73d24-b9d9-4dd1-a0c2-41cc56561bc0";
const devices: OwnedDevice[] = [
  { id: pcId, name: "My Desktop", platform: "windows", lastSeen: null },
  { id: strangerId, name: "Old Tablet", platform: "android", lastSeen: null },
];

describe("spatial nearby discovery", () => {
  it("accepts only bounded known native discovery records", () => {
    const result = parseNearbyScan({
      devices: [
        { id: "mdns-cafe02", name: " Living TV ", kind: "display", source: "mdns", detail: "_airplay._tcp." },
        { id: "mdns-cafe02", name: "Duplicate", kind: "display", source: "mdns", detail: "duplicate" },
        { id: "bad://url", name: "Unknown", kind: "display", source: "mdns", detail: "unsafe" },
        { id: "ble-12babe", name: "Speaker", kind: "speaker", source: "bluetooth", detail: "BLE" },
        { id: "mdns-af0134", name: "Invalid", kind: "admin", source: "mdns", detail: "invalid kind" },
        { id: "ssdp-ace123", name: "Wrong", kind: "media", source: "remote", detail: "wrong source" },
      ],
      bluetoothPermissionRequired: true,
    });
    expect(result.devices.map(item => item.name)).toEqual(["Living TV", "Speaker"]);
    expect(result.bluetoothPermissionRequired).toBe(true);
  });

  it("does not treat cloud-synced devices or unsolicited LAN identities as nearby", () => {
    const result = mergePersonalVoicePeers([], [pcId, strangerId, "not-owned"], devices, "my-phone");
    expect(result).toEqual([{
      id: "pv-" + pcId, name: "My Desktop", kind: "computer",
      source: "device-link", detail: "Paired Windows PC on local network", pairedDeviceId: pcId,
    }]);
  });

  it("cannot duplicate a scanned media service via PC merging", () => {
    const discovered = parseNearbyScan({ devices: [
      { id: "mdns-111111", name: "TV", kind: "media", source: "mdns", detail: "cast" },
    ] }).devices;
    const merged = mergePersonalVoicePeers(discovered, [pcId], devices, "my-phone");
    expect(merged).toHaveLength(2);
  });
});

describe("user-placed room sketch", () => {
  it("rejects malformed storage and untrusted coordinates", () => {
    expect(readPositions("{broken")).toEqual({});
    expect(readPositions('{"bogus":{"x":"1","y":0.5}}')).toEqual({});
    expect(readPositions('{"../path":{"x":0.1,"y":0.2}}')).toEqual({});
  });

  it("bounds user taps and recalled positions", () => {
    expect(clampPosition(-3, 5)).toEqual({ x: 0.08, y: 0.88 });
    expect(readPositions('{"mdns-cafe02":{"x":-4,"y":7}}')).toEqual({
      "mdns-cafe02": { x: 0.08, y: 0.88 },
    });
  });
});
