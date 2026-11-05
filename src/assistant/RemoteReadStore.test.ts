import { beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteReadStore } from "@/assistant/RemoteReadStore";
import type { RemoteRequestRow } from "@/assistant/remoteContextChannel";
import type { PlatformAdapter } from "@/platform/PlatformAdapter";

const mocks = vi.hoisted(() => ({
  allowReads: true,
  allowActions: true,
  unlocked: true,
  paired: true,
  fulfill: vi.fn(async (_api: unknown, _row: unknown, _local: unknown) => ({ action: "answered" as const })),
}));

vi.mock("@/settings/deviceSettings", () => ({
  loadRemoteReads: () => mocks.allowReads,
  loadRemoteComputerActions: () => mocks.allowActions,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async () => mocks.unlocked,
}));
vi.mock("@/assistant/remoteVoiceProof", () => ({
  pairedPublicKey: async () => {
    if (!mocks.paired) throw new Error("Pairing revoked");
    return {};
  },
}));
vi.mock("@/assistant/remoteContextChannel", () => ({
  askRemote: vi.fn(),
  fulfillRemoteRequest: mocks.fulfill,
}));

function fixture() {
  const row: RemoteRequestRow = {
    id: "request", userId: "account", requesterDeviceId: "phone",
    targetDeviceId: "pc", kind: "screenshot", status: "pending",
    response: null, error: null, version: 2,
    requestSignature: "signed", responseSignature: null,
    expiresAt: "2099-01-01T00:00:00Z",
  };
  const api = {
    touch: vi.fn(async () => {}),
    listPending: vi.fn(async () => [row]),
    get: vi.fn(async () => row),
    create: vi.fn(async () => "request"),
    answer: vi.fn(async () => {}),
    deny: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  };
  const store = new RemoteReadStore(api, async () => [{
    id: "pc", name: "Laptop", platform: "windows", lastSeen: new Date().toISOString(),
  }], () => "pc", { platform: "windows" } as PlatformAdapter);
  return { store, api };
}

describe("signed paired Companion screenshots", () => {
  beforeEach(() => {
    mocks.allowReads = true;
    mocks.allowActions = true;
    mocks.unlocked = true;
    mocks.paired = true;
    mocks.fulfill.mockClear();
  });

  it("does not ask for Windows approval when both remote settings permit a verified paired read", async () => {
    const { store } = fixture();
    await store.poll("account");
    expect(store.getSnapshot().approval).toBeNull();
    expect(mocks.fulfill).toHaveBeenCalledTimes(1);
    expect(mocks.fulfill.mock.calls[0]?.[2]).toMatchObject({
      approvedScreenshotId: "request", remoteReads: true,
    });
  });

  it("retains explicit approval when remote control is not enabled", async () => {
    mocks.allowActions = false;
    const { store } = fixture();
    await store.poll("account");
    expect(store.getSnapshot().approval?.id).toBe("request");
    expect(mocks.fulfill).not.toHaveBeenCalled();
  });

  it("fails closed when Windows locks or a pairing is revoked", async () => {
    mocks.unlocked = false;
    const locked = fixture();
    await locked.store.poll("account");
    expect(mocks.fulfill).not.toHaveBeenCalled();
    expect(locked.store.getSnapshot().approval).toBeNull();

    mocks.unlocked = true;
    mocks.paired = false;
    const revoked = fixture();
    await revoked.store.poll("account");
    expect(mocks.fulfill).not.toHaveBeenCalled();
    expect(revoked.store.getSnapshot().approval).toBeNull();
  });
});
