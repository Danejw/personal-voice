import { describe, expect, it } from "vitest";
import { REMOTE_DICTATION_ONLINE_MS } from "@/remote-dictation/constants";
import {
  cycleRemoteTarget,
  eligibleRemoteTargets,
  resolveRemoteTarget,
  type RemoteDictationDevice,
} from "@/remote-dictation/targets";

const NOW = Date.parse("2026-10-03T20:00:00.000Z");

function device(id: string, name: string, ageMs: number | null): RemoteDictationDevice {
  return {
    id,
    name,
    platform: "windows",
    lastSeen: ageMs === null ? null : new Date(NOW - ageMs).toISOString(),
  };
}

describe("eligibleRemoteTargets", () => {
  it("excludes the current device", () => {
    const devices = [
      device("phone", "Phone", 0),
      device("laptop", "Laptop", 0),
      device("desktop", "Desktop", 0),
    ];
    expect(eligibleRemoteTargets(devices, "phone", NOW).map((d) => d.id)).toEqual(["desktop", "laptop"]);
  });

  it("excludes offline devices", () => {
    const devices = [
      device("phone", "Phone", 0),
      device("laptop", "Laptop", 0),
      device("desktop", "Desktop", REMOTE_DICTATION_ONLINE_MS + 1),
      device("office", "Office PC", null),
    ];
    expect(eligibleRemoteTargets(devices, "phone", NOW).map((d) => d.id)).toEqual(["laptop"]);
  });

  it("sorts deterministically by name then id", () => {
    const devices = [
      device("b", "Zebra", 0),
      device("a", "Apple", 0),
      device("c", "Apple", 0),
      device("phone", "Phone", 0),
    ];
    expect(eligibleRemoteTargets(devices, "phone", NOW).map((d) => d.id)).toEqual(["a", "c", "b"]);
  });
});

describe("resolveRemoteTarget", () => {
  it("keeps the saved target when still eligible", () => {
    const devices = [device("phone", "Phone", 0), device("laptop", "Laptop", 0), device("desktop", "Desktop", 0)];
    expect(resolveRemoteTarget(devices, "phone", "desktop", NOW)?.id).toBe("desktop");
  });

  it("recovers when the saved target is offline or removed", () => {
    const devices = [
      device("phone", "Phone", 0),
      device("laptop", "Laptop", 0),
      device("desktop", "Desktop", REMOTE_DICTATION_ONLINE_MS + 1),
    ];
    expect(resolveRemoteTarget(devices, "phone", "desktop", NOW)?.id).toBe("laptop");
    expect(resolveRemoteTarget(devices, "phone", "gone", NOW)?.id).toBe("laptop");
  });

  it("returns null when no eligible device exists", () => {
    expect(resolveRemoteTarget([device("phone", "Phone", 0)], "phone", null, NOW)).toBeNull();
  });
});

describe("cycleRemoteTarget", () => {
  it("cycles deterministically through multiple targets", () => {
    const devices = [
      device("phone", "Phone", 0),
      device("laptop", "Laptop", 0),
      device("desktop", "Desktop", 0),
      device("office", "Office PC", 0),
    ];
    const first = cycleRemoteTarget(devices, "phone", "laptop", NOW);
    expect(first.onlyOne).toBe(false);
    expect(first.target?.id).toBe("office");
    const second = cycleRemoteTarget(devices, "phone", first.target?.id ?? null, NOW);
    expect(second.target?.id).toBe("desktop");
    const third = cycleRemoteTarget(devices, "phone", second.target?.id ?? null, NOW);
    expect(third.target?.id).toBe("laptop");
  });

  it("stays on the only available device", () => {
    const devices = [device("phone", "Phone", 0), device("laptop", "Laptop", 0)];
    const result = cycleRemoteTarget(devices, "phone", "laptop", NOW);
    expect(result.onlyOne).toBe(true);
    expect(result.target?.id).toBe("laptop");
  });
});
