import { describe, expect, it } from "vitest";
import { consolidateNearbyDevices, parseDeviceIdentity } from "@/spatial/deviceCapabilities";
import type { NearbyDevice } from "@/spatial/spatialDevices";

const lan: NearbyDevice = {
  id: "lan-012345abcd", name: "Device 192.168.0.27", kind: "unknown",
  source: "lan", detail: "TCP 80", ipAddress: "192.168.0.27",
};
const upnp: NearbyDevice = {
  id: "ssdp-1234567890", name: "SHP, UPnP/1.0, Samsung UPnP SDK/1.0",
  kind: "media", source: "ssdp", detail: "UPnP / DIAL", ipAddress: "192.168.0.27",
};
const dial: NearbyDevice = {
  ...upnp, id: "ssdp-543219876", kind: "display",
};

describe("evidence-linked device identity", () => {
  it("merges LAN and Samsung UPnP sightings only by the identical observed IP", () => {
    const entries = consolidateNearbyDevices([upnp, lan, dial]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: lan.id, ipAddress: "192.168.0.27", name: "Samsung-advertised device",
    });
    expect(entries[0]?.detail).toContain("TCP 80");
    expect(entries[0]?.detail).toContain("UPnP / DIAL");
    expect(entries[0]?.pairedDeviceId).toBeUndefined();
  });

  it("does not merge different IPs, unaddressed DNS-SD names or Bluetooth radios", () => {
    const entries = consolidateNearbyDevices([
      lan,
      { ...upnp, id: "ssdp-other", ipAddress: "192.168.0.28" },
      { ...upnp, id: "mdns-anon", ipAddress: undefined, source: "mdns", name: "Samsung" },
      { ...upnp, id: "bt-anon", ipAddress: undefined, source: "bluetooth", name: "Samsung" },
    ]);
    expect(entries).toHaveLength(4);
  });

  it("merges a printer's HTTP, IPP and printer DNS-SD services only after each resolves to the same private IP", () => {
    const ip = "192.168.0.35";
    const names = ["_http._tcp.", "_ipp._tcp.", "_printer._tcp."];
    const entries = consolidateNearbyDevices(names.map((service, i) => ({
      id: "mdns-123456" + i, name: "HP Color LaserJet M277dw",
      kind: "printer" as const, source: "mdns" as const,
      detail: service, ipAddress: ip,
    })));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toContain("HP Color LaserJet");
    expect(entries[0]?.detail).toContain("_ipp._tcp.");
    const unresolved = consolidateNearbyDevices(names.map((service, i) => ({
      id: "mdns-123456" + i, name: "HP Color LaserJet M277dw",
      kind: "printer" as const, source: "mdns" as const,
      detail: service,
    })));
    expect(unresolved).toHaveLength(3);
  });

  it("never grants Companion based on brand, Wi-Fi IP or matching name", () => {
    const entries = consolidateNearbyDevices([lan, upnp]);
    expect(entries.every(item => item.pairedDeviceId === undefined)).toBe(true);
  });
});

describe("native capability parsing", () => {
  const ip = "192.168.0.27";
  const verified = {
    ipAddress: ip, name: "Living Room", manufacturer: "Samsung",
    model: "QN55", features: ["open_web", "volume", "samsung_remote"],
    samsungFingerprint: "f".repeat(64), samsungPaired: true,
  };

  it("accepts only whitelisted actions and correctly shaped TV identity", () => {
    const identity = parseDeviceIdentity({ ...verified, features: [
      ...verified.features, "factory_reset", "open_web",
    ] }, ip);
    expect(identity.features).toEqual(["open_web", "volume", "samsung_remote"]);
    expect(identity.samsungFingerprint).toBe("f".repeat(64));
    expect(identity.samsungPaired).toBe(true);
  });

  it("rejects a different IP or public address before device actions", () => {
    expect(() => parseDeviceIdentity({ ...verified, ipAddress: "192.168.0.1" }, ip)).toThrow();
    expect(() => parseDeviceIdentity({ ...verified, ipAddress: "8.8.8.8" }, "8.8.8.8")).toThrow();
  });

  it("does not expose remote control when a certificate fingerprint is missing", () => {
    const identity = parseDeviceIdentity({
      ...verified, samsungFingerprint: "invalid", features: ["samsung_remote"],
    }, ip);
    expect(identity.features).toEqual([]);
    expect(identity.samsungPaired).toBe(false);
  });
});

describe("LG webOS remote capability", () => {
  const ip = "192.168.0.45";
  const base = {
    ipAddress: ip, name: "LG webOS TV", manufacturer: "LG",
    model: "OLED65C4AUA", features: ["lg_remote", "factory_reset"],
    lgFingerprint: "a".repeat(64), lgPaired: true,
  };

  it("exposes only the verified LG control feature with a valid native certificate", () => {
    const identity = parseDeviceIdentity(base, ip);
    expect(identity.features).toEqual(["lg_remote"]);
    expect(identity.lgFingerprint).toBe("a".repeat(64));
    expect(identity.lgPaired).toBe(true);
  });

  it("never accepts an LG remote without a valid fingerprint", () => {
    const identity = parseDeviceIdentity({ ...base, lgFingerprint: "invalid" }, ip);
    expect(identity.features).toEqual([]);
    expect(identity.lgPaired).toBe(false);
  });

  it("rejects an LG TV identification for a different network host", () => {
    expect(() => parseDeviceIdentity(base, "192.168.0.9")).toThrow();
  });
});

describe("Roku companion feature validation", () => {
  it("allows only the fixed official-app handoff feature, not unverified ECP remote keys", () => {
    const ip = "192.168.0.14";
    const value = parseDeviceIdentity({
      ipAddress: ip, name: "Roku device", manufacturer: "Roku",
      model: "", features: ["roku_companion", "roku_remote", "factory_reset"],
    }, ip);
    expect(value.features).toEqual(["roku_companion"]);
  });
});
