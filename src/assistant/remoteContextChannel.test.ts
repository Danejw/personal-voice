import { describe, expect, it, vi } from "vitest";
import { askRemote, fulfillRemoteRequest, type RemoteContextApi, type RemoteRequestRow } from "@/assistant/remoteContextChannel";
import { resolveRemoteDevice, type RemoteDevice } from "@/assistant/remoteContext";

const now = Date.parse("2026-09-28T12:00:00.000Z");

function device(id: string, name: string, platform: string, lastSeen: string | null): RemoteDevice {
  return { id, name, platform, lastSeen };
}

function memoryApi() {
  const rows: RemoteRequestRow[] = [];
  let sequence = 0;
  const api: RemoteContextApi = {
    async create(userId, requesterDeviceId, targetDeviceId, kind) {
      sequence += 1;
      const id = `read-${sequence}`;
      rows.push({
        id,
        userId,
        requesterDeviceId,
        targetDeviceId,
        kind,
        status: "pending",
        response: null,
        error: null,
      });
      return id;
    },
    async get(userId, id) {
      return rows.find((row) => row.userId === userId && row.id === id) ?? null;
    },
    async listPending(userId, targetDeviceId) {
      return rows.filter((row) => row.userId === userId && row.targetDeviceId === targetDeviceId && row.status === "pending");
    },
    async answer(userId, id, response) {
      const row = rows.find((item) => item.userId === userId && item.id === id);
      if (!row || row.status !== "pending") return;
      row.status = "answered";
      row.response = response;
    },
    async deny(userId, id, message) {
      const row = rows.find((item) => item.userId === userId && item.id === id);
      if (!row || row.status !== "pending") return;
      row.status = "denied";
      row.error = message;
    },
    async remove(userId, id) {
      const index = rows.findIndex((row) => row.userId === userId && row.id === id);
      if (index >= 0) rows.splice(index, 1);
    },
  };
  return { api, rows };
}

describe("remote device routing", () => {
  const devices = [
    device("desk", "Desk PC", "windows", "2026-09-28T12:00:00.000Z"),
    device("phone", "Phone", "android", "2026-09-28T11:59:40.000Z"),
    device("laptop", "Laptop", "windows", "2026-09-28T11:00:00.000Z"),
  ];

  it("asks which device when several are online and refuses another account's name", () => {
    expect(resolveRemoteDevice(devices, "phone", null, now)).toMatchObject({
      ok: false,
      message: "Which device should I check? You have Desk PC and Laptop.",
    });
    expect(resolveRemoteDevice(devices, "phone", "Desk PC", now)).toMatchObject({ ok: true, device: { id: "desk" } });
    expect(resolveRemoteDevice(devices, "phone", "Not mine", now).ok).toBe(false);
  });

  it("reports an offline device instead of waiting", () => {
    const result = resolveRemoteDevice(devices, "phone", "Laptop", now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("offline");
  });
});

describe("remote request channel", () => {
  it("returns a bounded window read and deletes the row", async () => {
    const { api, rows } = memoryApi();
    let time = 0;
    const pending = askRemote(api, "user-1", "phone", "desk", "Desk PC", "active_window", {
      now: () => time,
      sleep: async () => {
        time += 1_000;
        const row = rows[0];
        if (row?.status === "pending") {
          await fulfillRemoteRequest(api, row, {
            userId: "user-1",
            deviceName: "Desk PC",
            platform: "windows",
            remoteReads: true,
            approvedScreenshotId: null,
            describe: async () => ({ active: "Cursor", windows: ["Cursor"] }),
            capture: async () => { throw new Error("capture"); },
          });
        }
      },
      timeoutMs: 5_000,
      pollMs: 1_000,
    });
    await expect(pending).resolves.toMatchObject({ kind: "active_window", text: expect.stringContaining("Cursor") });
    expect(rows).toEqual([]);
  });

  it("does not capture when remote reads are off, on Android, or before screenshot approval", async () => {
    const { api } = memoryApi();
    const capture = vi.fn(async () => ({ jpeg: "/9j/abc", sourceApp: "Cursor", width: 2, height: 2 }));
    const describe = vi.fn(async () => ({ active: "Cursor", windows: ["Cursor"] }));
    const id = await api.create("user-1", "phone", "desk", "screenshot");
    const row = await api.get("user-1", id);
    if (!row) throw new Error("missing");
    await fulfillRemoteRequest(api, row, {
      userId: "user-1", deviceName: "Desk PC", platform: "windows", remoteReads: false,
      approvedScreenshotId: null, describe, capture,
    });
    expect(capture).not.toHaveBeenCalled();
    expect(describe).not.toHaveBeenCalled();
    expect((await api.get("user-1", id))?.error).toContain("turned off");

    const androidId = await api.create("user-1", "desk", "phone", "windows");
    const android = await api.get("user-1", androidId);
    if (!android) throw new Error("missing");
    await fulfillRemoteRequest(api, android, {
      userId: "user-1", deviceName: "Phone", platform: "android", remoteReads: true,
      approvedScreenshotId: null, describe, capture,
    });
    expect(capture).not.toHaveBeenCalled();
    expect((await api.get("user-1", androidId))?.error).toContain("can't share");

    const waitingId = await api.create("user-1", "phone", "desk", "screenshot");
    const waiting = await api.get("user-1", waitingId);
    if (!waiting) throw new Error("missing");
    const held = await fulfillRemoteRequest(api, waiting, {
      userId: "user-1", deviceName: "Desk PC", platform: "windows", remoteReads: true,
      approvedScreenshotId: null, describe, capture,
    });
    expect(held.action).toBe("waiting");
    expect(capture).not.toHaveBeenCalled();
    await fulfillRemoteRequest(api, waiting, {
      userId: "user-1", deviceName: "Desk PC", platform: "windows", remoteReads: true,
      approvedScreenshotId: waitingId, describe, capture,
    });
    expect(capture).toHaveBeenCalledTimes(1);
    const answered = await api.get("user-1", waitingId);
    expect(answered?.response).toContain("one-time screenshot");
    expect(answered?.response).not.toContain("click");
  });

  it("times out, hides the row from another account, and refuses a huge screenshot", async () => {
    const { api, rows } = memoryApi();
    let time = 0;
    await expect(askRemote(api, "user-1", "phone", "desk", "Desk PC", "windows", {
      now: () => time,
      sleep: async (ms) => { time += ms; },
      timeoutMs: 3_000,
      pollMs: 1_000,
    })).rejects.toThrow("didn't respond");
    expect(rows).toEqual([]);

    await api.create("user-1", "phone", "desk", "presence");
    expect(await api.listPending("user-2", "desk")).toEqual([]);
    expect(await api.listPending("user-1", "desk")).toHaveLength(1);

    const shotId = await api.create("user-1", "phone", "desk", "screenshot");
    const shot = await api.get("user-1", shotId);
    if (!shot) throw new Error("missing");
    const huge = await fulfillRemoteRequest(api, shot, {
      userId: "user-1",
      deviceName: "Desk PC",
      platform: "windows",
      remoteReads: true,
      approvedScreenshotId: shotId,
      describe: async () => ({ active: null, windows: [] }),
      capture: async () => ({ jpeg: `/9j/${"a".repeat(300_001)}`, sourceApp: null, width: 2, height: 2 }),
    });
    expect(huge.action).toBe("denied");
    expect((await api.get("user-1", shotId))?.error).toContain("too large");
  });
});
