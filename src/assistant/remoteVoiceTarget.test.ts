import { describe, expect, it } from "vitest";
import { selectRemoteVoiceTarget } from "@/assistant/remoteVoiceTarget";
import { resolveRemoteDevice, type RemoteDevice } from "@/assistant/remoteContext";

const now = Date.parse("2026-11-03T22:00:00Z");
const laptopId = "00000000-0000-4000-8000-000000000001";
const desktopId = "00000000-0000-4000-8000-000000000002";
const phoneId = "00000000-0000-4000-8000-000000000003";
const devices: RemoteDevice[] = [
  { id: laptopId, name: "Laptop", platform: "windows", lastSeen: new Date(now).toISOString() },
  { id: desktopId, name: "Desktop", platform: "windows", lastSeen: new Date(now).toISOString() },
  { id: phoneId, name: "Phone", platform: "android", lastSeen: new Date(now).toISOString() },
];

describe("phone remote-voice target selection", () => {
  it("uses exact immutable ID when a specific PC was named", () => {
    expect(selectRemoteVoiceTarget(devices, phoneId, desktopId, laptopId, now))
      .toMatchObject({ ok: true, device: { id: desktopId } });
    expect(resolveRemoteDevice(devices, phoneId, desktopId, now))
      .toMatchObject({ ok: true, device: { id: desktopId } });
  });
  it("uses the saved default only when the call does not select another device", () => {
    expect(selectRemoteVoiceTarget(devices, phoneId, null, laptopId, now))
      .toMatchObject({ ok: true, device: { id: laptopId } });
    expect(selectRemoteVoiceTarget(devices, phoneId, "Desktop", laptopId, now))
      .toMatchObject({ ok: true, device: { id: desktopId } });
  });
  it("never silently switches away from an offline explicitly named PC", () => {
    const offline = devices.map(d => d.id === laptopId ? { ...d, lastSeen: "2026-11-03T20:00:00Z" } : d);
    const result = selectRemoteVoiceTarget(offline, phoneId, laptopId, desktopId, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("offline");
  });
  it("rejects unknown IDs and duplicate friendly names rather than guessing", () => {
    const unknownId = "00000000-0000-4000-8000-000000000099";
    expect(selectRemoteVoiceTarget(devices, phoneId, unknownId, laptopId, now).ok).toBe(false);
    const duplicates = devices.map(d => d.id === desktopId ? { ...d, name: "Laptop" } : d);
    expect(selectRemoteVoiceTarget(duplicates, phoneId, "Laptop", null, now).ok).toBe(false);
    expect(selectRemoteVoiceTarget(devices, phoneId, null, null, now).ok).toBe(false);
  });
});
