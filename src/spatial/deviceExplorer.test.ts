import { describe, expect, it } from "vitest";
import { deviceSubtitle, isUnidentifiedBluetooth, listDevices } from "@/spatial/deviceExplorer";
import type { NearbyDevice } from "@/spatial/spatialDevices";

const device = (id: string, name: string, source: NearbyDevice["source"],
  overrides: Partial<NearbyDevice> = {}): NearbyDevice => ({
    id, name, source, detail: source, kind: "unknown", ...overrides,
  });
const records = [
  device("bt-123456", "Bluetooth device", "bluetooth-classic", { signalDbm: -81 }),
  device("bt-123457", "Bluetooth LE device", "bluetooth"),
  device("bt-123458", "LG webOS TV", "bluetooth-paired", { paired: true }),
  device("lan-123456", "Device 192.168.0.1", "lan", { ipAddress: "192.168.0.1", detail: "TCP 80" }),
  device("lan-123457", "Samsung-advertised device", "lan", { ipAddress: "192.168.0.27", detail: "TCP 443 · UPnP" }),
  device("mdns-123456", "SpotifyConnect", "mdns", { detail: "_spotify-connect._tcp." }),
  device("pv-123456", "Desktop", "device-link", {
    kind: "computer", pairedDeviceId: "abcdefgh-1234", detail: "Authenticated Windows PC",
  }),
];

describe("nearby device inventory", () => {
  it("opens with meaningful network targets before advertisements", () => {
    const result = listDevices(records, "network", "", false);
    expect(result.items.map(item => item.name)).toEqual([
      "Desktop", "Samsung-advertised device", "Device 192.168.0.1", "SpotifyConnect",
    ]);
    expect(result.hiddenCount).toBe(0);
  });

  it("prioritizes paired named radios and hides only unidentified Bluetooth noise", () => {
    const result = listDevices(records, "bluetooth", "", false);
    expect(result.items.map(item => item.name)).toEqual(["LG webOS TV"]);
    expect(result.matches).toBe(3);
    expect(result.hiddenCount).toBe(2);
    expect(listDevices(records, "bluetooth", "", true).items).toHaveLength(3);
    expect(isUnidentifiedBluetooth(records[0]!)).toBe(true);
    expect(isUnidentifiedBluetooth(records[3]!)).toBe(false);
  });

  it("searches IPs, names and protocol details without presenting remote control as proven", () => {
    expect(listDevices(records, "all", "192.168.0.27", false).items.map(d => d.name))
      .toEqual(["Samsung-advertised device"]);
    expect(listDevices(records, "network", "spotify", false).items.map(d => d.name))
      .toEqual(["SpotifyConnect"]);
    expect(listDevices(records, "network", "TCP 80", false).items.map(d => d.name))
      .toEqual(["Device 192.168.0.1"]);
  });

  it("separates authenticated Personal Voice sessions from ordinary network discoveries", () => {
    expect(deviceSubtitle(records[6]!)).toBe("Personal Voice · Connected");
    expect(deviceSubtitle(records[4]!)).toContain("192.168.0.27");
    expect(records[4]!.pairedDeviceId).toBeUndefined();
    expect(deviceSubtitle(records[2]!)).toBe("Bluetooth · Paired");
  });
});
