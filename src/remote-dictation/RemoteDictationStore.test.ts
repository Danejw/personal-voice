import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteDictationStore } from "@/remote-dictation/RemoteDictationStore";
import type { RemoteDictationRequest } from "@/remote-dictation/types";
import type { RemoteDictationApi } from "@/services/remoteDictationService";
import { bindDeviceSettings, loadRemoteDictation, saveRemoteDictation, saveRemoteDictationTargetDeviceId } from "@/settings/deviceSettings";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => { values.clear(); },
    key: () => null,
    get length() { return values.size; },
  };
}

function mockApi(overrides: Partial<RemoteDictationApi> = {}): RemoteDictationApi {
  return {
    touch: vi.fn().mockResolvedValue(undefined),
    create: vi.fn(),
    get: vi.fn(),
    listPending: vi.fn().mockResolvedValue([]),
    claim: vi.fn(),
    complete: vi.fn(),
    remove: vi.fn(),
    ...overrides,
  };
}

function request(partial: Partial<RemoteDictationRequest> & Pick<RemoteDictationRequest, "id" | "status">): RemoteDictationRequest {
  return {
    userId: "user-1",
    sourceDeviceId: "phone",
    targetDeviceId: "laptop",
    text: "hello",
    error: null,
    createdAt: "2026-10-03T20:00:00.000Z",
    expiresAt: "2026-10-03T20:00:06.000Z",
    completedAt: null,
    ...partial,
  };
}

describe("RemoteDictationStore", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
  });

  it("cycles targets without starting dictation and persists per source device", async () => {
    bindDeviceSettings("phone");
    const api = mockApi();
    const store = new RemoteDictationStore(
      api,
      async () => [
        { id: "phone", name: "Phone", platform: "android", lastSeen: new Date().toISOString() },
        { id: "laptop", name: "Laptop", platform: "windows", lastSeen: new Date().toISOString() },
        { id: "desktop", name: "Desktop", platform: "windows", lastSeen: new Date().toISOString() },
      ],
      () => "phone",
      vi.fn(),
      { subscribe: () => () => undefined },
    );
    await store.setUser("user-1");
    expect(store.getSnapshot().targetDeviceId).toBeTruthy();
    const first = store.getSnapshot().targetDeviceId;
    store.cycleTarget();
    const second = store.getSnapshot().targetDeviceId;
    expect(second).not.toBe(first);
    expect(api.create).not.toHaveBeenCalled();
    await store.setUser(null);
  });

  it("rejects disabled receivers and preserves the source transcript path via failed complete", async () => {
    bindDeviceSettings("laptop");
    saveRemoteDictation(false);
    expect(loadRemoteDictation()).toBe(false);

    const complete = vi.fn().mockResolvedValue(true);
    const claim = vi.fn().mockResolvedValue(request({ id: "r1", status: "pending" }));
    const insert = vi.fn();
    const api = mockApi({ claim, complete });
    const store = new RemoteDictationStore(
      api,
      async () => [{ id: "laptop", name: "Laptop", platform: "windows", lastSeen: new Date().toISOString() }],
      () => "laptop",
      insert,
      { subscribe: () => () => undefined },
    );
    await store.setUser("user-1");
    await store.handleRequest("r1");
    expect(insert).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledWith("r1", "laptop", false, expect.stringMatching(/turned off/i));
    await store.setUser(null);
  });

  it("claims once so duplicate events cannot insert twice", async () => {
    bindDeviceSettings("laptop");
    saveRemoteDictation(true);
    let claimed = false;
    const insert = vi.fn().mockResolvedValue(undefined);
    const api = mockApi({
      claim: vi.fn(async () => {
        if (claimed) return null;
        claimed = true;
        return request({ id: "r1", status: "processing" });
      }),
      complete: vi.fn().mockResolvedValue(true),
    });
    const store = new RemoteDictationStore(
      api,
      async () => [{ id: "laptop", name: "Laptop", platform: "windows", lastSeen: new Date().toISOString() }],
      () => "laptop",
      insert,
      { subscribe: () => () => undefined },
    );
    await store.setUser("user-1");
    await Promise.all([store.handleRequest("r1"), store.handleRequest("r1")]);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(api.complete).toHaveBeenCalledWith("r1", "laptop", true);
    await store.setUser(null);
  });

  it("locks a specific target id for the utterance", async () => {
    bindDeviceSettings("phone");
    saveRemoteDictationTargetDeviceId("laptop");
    const api = mockApi();
    const store = new RemoteDictationStore(
      api,
      async () => [
        { id: "phone", name: "Phone", platform: "android", lastSeen: new Date().toISOString() },
        { id: "laptop", name: "Laptop", platform: "windows", lastSeen: new Date().toISOString() },
        { id: "desktop", name: "Desktop", platform: "windows", lastSeen: new Date().toISOString() },
      ],
      () => "phone",
      vi.fn(),
      { subscribe: () => () => undefined },
    );
    await store.setUser("user-1");
    const locked = store.lockTarget("desktop");
    expect(locked).toEqual({ id: "desktop", name: "Desktop" });
    store.cycleTarget();
    expect(store.getSnapshot().targetDeviceId).not.toBe("desktop");
    expect(locked.id).toBe("desktop");
    await store.setUser(null);
  });
});
