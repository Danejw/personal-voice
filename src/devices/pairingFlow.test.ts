import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  invite: vi.fn(async () => ({ id: "invite-1", code: "12345678", expiresAt: "2099-01-01T00:00:00Z" })),
  claim: vi.fn(async () => "invite-1"),
  verified: vi.fn(async () => []),
  scan: vi.fn(async () => ({ code: "pv-pair:v1:12345678" })),
  show: vi.fn(async () => undefined),
  focus: vi.fn(async () => undefined),
}));

vi.mock("@/services/devicePairingService", () => ({ devicePairingApi: api }));
vi.mock("@/services/verifiedPairLinks", () => ({ verifiedPairLinks: api.verified }));
vi.mock("@/platform/android/voicePlatformPlugin", () => ({ callPlugin: api.scan }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ show: api.show, setFocus: api.focus }),
}));

import { pairingAction } from "@/devices/pairingFlow";

describe("agent-guided device pairing", () => {
  const events: unknown[] = [];
  beforeEach(() => {
    vi.clearAllMocks();
    events.length = 0;
    vi.stubGlobal("window", { dispatchEvent: (event: { detail: unknown }) => { events.push(event.detail); } });
    vi.stubGlobal("CustomEvent", class {
      detail: unknown;
      constructor(_name: string, options: { detail: unknown }) { this.detail = options.detail; }
    });
    vi.stubGlobal("navigator", { userAgent: "Android" });
  });

  it("shows an expiring signed QR invitation on Windows and does not approve it", async () => {
    vi.stubGlobal("navigator", { userAgent: "Windows" });
    const result = await pairingAction("pc", "windows", "show_code");
    expect(result).toContain("1234 5678");
    expect(api.invite).toHaveBeenCalledWith("pc");
    expect(events).toContainEqual({ kind: "invite", invite: expect.objectContaining({ code: "12345678" }) });
    expect(api.show).toHaveBeenCalled();
  });

  it("scans the existing Personal Voice QR and makes only a pending claim", async () => {
    const result = await pairingAction("phone", "android", "scan_qr");
    expect(result).toContain("Waiting");
    expect(api.scan).toHaveBeenCalledWith("scan_pairing_qr");
    expect(api.claim).toHaveBeenCalledWith("phone", "12345678");
    expect(events).toContainEqual({ kind: "joined", inviteId: "invite-1" });
  });

  it("rejects invalid codes, wrong platform actions and unregistered devices", async () => {
    await expect(pairingAction("phone", "android", "enter_code", "1234")).rejects.toThrow("eight-digit");
    await expect(pairingAction("pc", "windows", "scan_qr")).rejects.toThrow("Android");
    await expect(pairingAction(null, "android", "open")).rejects.toThrow("Sign in");
    expect(api.claim).not.toHaveBeenCalled();
  });
});
