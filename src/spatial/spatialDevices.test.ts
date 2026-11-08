import { describe, expect, it } from "vitest";
import type { OwnedDevice } from "@/handoffs/handoff";
import {
  clampPosition, mergePersonalVoicePeers, observedThisScan, parseNearbyScan, readPositions, nearbyGroup,
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

describe("observed vs remembered hardware", () => {
  it("does not treat a stored Android pairing as a live radio observation", () => {
    const scan = parseNearbyScan({ devices: [
      { id: "bt-111111aaaaaa", source: "bluetooth-paired", name: "LG webOS TV",
        kind: "speaker", detail: "Paired Bluetooth", paired: true, observedNow: false },
      { id: "bt-222222aaaaaa", source: "bluetooth-classic", name: "Headphones",
        kind: "speaker", detail: "Bluetooth Classic", observedNow: true },
    ] });
    expect(observedThisScan(scan.devices[0]!)).toBe(false);
    expect(observedThisScan(scan.devices[1]!)).toBe(true);
    expect(scan.devices[0]?.paired).toBe(true);
    expect(scan.devices[0]?.observedNow).toBe(false);
  });
});

describe("expanded device inventory", () => {
  it("accepts LAN, paired Bluetooth and Classic Bluetooth with bounded native metadata", () => {
    const scan = parseNearbyScan({
      networkLabel: "192.168.1.55/24 · 253 addresses checked",
      networkLimited: true,
      bluetoothPermissionRequired: false,
      devices: [
        { id: "lan-abcdef012345", name: "Device 192.168.1.7", kind: "computer", source: "lan",
          detail: "TCP 445", ipAddress: "192.168.1.7" },
        { id: "bt-abcdef012345", name: "Headphones", kind: "speaker", source: "bluetooth-paired",
          detail: "Paired Bluetooth", signalDbm: -47, paired: true },
        { id: "bt-abcdef012346", name: "Nearby phone", kind: "phone", source: "bluetooth-classic",
          detail: "Bluetooth Classic", signalDbm: -70 },
      ],
    });
    expect(scan.devices).toHaveLength(3);
    expect(scan.devices[0]?.ipAddress).toBe("192.168.1.7");
    expect(scan.devices[1]?.paired).toBe(true);
    expect(scan.devices[1]?.signalDbm).toBe(-47);
    expect(nearbyGroup(scan.devices[0]!.source)).toBe("network");
    expect(nearbyGroup(scan.devices[1]!.source)).toBe("bluetooth");
    expect(scan.networkLimited).toBe(true);
    expect(scan.networkLabel).toContain("253 addresses checked");
  });

  it("refuses fabricated public IP addresses and out-of-range signal data", () => {
    const scan = parseNearbyScan({ devices: [
      { id: "lan-abcdef012345", name: "External", kind: "server", source: "lan",
        detail: "TCP 443", ipAddress: "8.8.8.8", signalDbm: 999 },
    ]});
    expect(scan.devices).toHaveLength(1);
    expect(scan.devices[0]?.ipAddress).toBeUndefined();
    expect(scan.devices[0]?.signalDbm).toBeUndefined();
    expect(scan.networkLabel).toBe("");
  });

  it("does not grant control to ordinary LAN hosts or Bluetooth pairs", () => {
    const scan = parseNearbyScan({ devices: [
      { id: "lan-abcdef012345", name: "LAN PC", kind: "computer", source: "lan",
        detail: "TCP 3389", ipAddress: "10.0.0.6" },
      { id: "bt-abcdef012346", name: "TV", kind: "display", source: "bluetooth-paired",
        detail: "Paired Bluetooth", paired: true },
    ]});
    expect(scan.devices.every(device => device.pairedDeviceId === undefined)).toBe(true);
  });
});
