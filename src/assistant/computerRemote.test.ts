import { describe, expect, it } from "vitest";
import { askComputerAction, fulfillComputerAction, type ComputerActionApi, type ComputerActionRow } from "@/assistant/computerRemote";
import type { RemoteDevice } from "@/assistant/remoteContext";

function memoryApi(rows: ComputerActionRow[] = []): ComputerActionApi & { rows: ComputerActionRow[] } {
  const store: ComputerActionRow[] = [...rows];
  return {
    rows: store,
    async create(userId, requesterDeviceId, targetDeviceId, action, argument) {
      const row: ComputerActionRow = {
        id: `row-${store.length + 1}`,
        userId,
        requesterDeviceId,
        targetDeviceId,
        action,
        argument,
        status: "pending",
        result: null,
        error: null,
      };
      store.push(row);
      return row.id;
    },
    async get(userId, id) {
      return store.find((row) => row.id === id && row.userId === userId) ?? null;
    },
    async listPending(userId, targetDeviceId) {
      return store.filter((row) => row.userId === userId && row.targetDeviceId === targetDeviceId && row.status === "pending");
    },
    async answer(userId, id, result) {
      const row = store.find((item) => item.id === id && item.userId === userId);
      if (row) {
        row.status = "answered";
        row.result = result;
      }
    },
    async deny(userId, id, message) {
      const row = store.find((item) => item.id === id && item.userId === userId);
      if (row) {
        row.status = "denied";
        row.error = message;
      }
    },
    async remove(userId, id) {
      const index = store.findIndex((row) => row.id === id && row.userId === userId);
      if (index >= 0) store.splice(index, 1);
    },
  };
}

const devices: RemoteDevice[] = [
  { id: "pc", name: "Desk PC", platform: "windows", lastSeen: "2026-09-28T12:00:00.000Z" },
  { id: "phone", name: "Phone", platform: "android", lastSeen: "2026-09-28T12:00:00.000Z" },
];

describe("remote computer actions", () => {
  it("does not insert a row for an offline device", async () => {
    const api = memoryApi();
    const clock = { now: () => Date.parse("2026-09-28T12:02:00.000Z"), sleep: async () => {} };
    await expect(askComputerAction(
      api,
      "user-1",
      "phone",
      [{ id: "pc", name: "Desk PC", platform: "windows", lastSeen: "2026-09-28T11:00:00.000Z" }],
      "Desk PC",
      "open_app",
      "notepad",
      clock,
    )).rejects.toThrow(/offline/);
    expect(api.rows).toHaveLength(0);
  });

  it("returns the target's result and removes the row", async () => {
    const api = memoryApi();
    let time = Date.parse("2026-09-28T12:00:10.000Z");
    const clock = {
      now: () => time,
      sleep: async () => {
        time += 2_000;
        const row = api.rows[0];
        if (row) {
          row.status = "answered";
          row.result = "Opened Notepad.";
        }
      },
    };
    await expect(askComputerAction(api, "user-1", "phone", devices, "Desk PC", "open_app", "notepad", clock)).resolves.toBe("Opened Notepad.");
    expect(api.rows).toHaveLength(0);
  });

  it("does not execute when remote actions are off or the action is a shell", async () => {
    const api = memoryApi();
    const id = await api.create("user-1", "phone", "pc", "open_app", "notepad");
    expect(await api.get("other-user", id)).toBeNull();
    const row = await api.get("user-1", id);
    if (!row) throw new Error("missing");
    const ran: string[] = [];
    const denied = await fulfillComputerAction(api, row, "windows", false, id, async (action) => {
      ran.push(action);
      return "no";
    });
    expect(denied.action).toBe("denied");
    expect(ran).toEqual([]);
    const shell = { ...row, id: "shell", action: "run_shell", status: "pending" as const };
    api.rows.push(shell);
    await fulfillComputerAction(api, shell, "windows", true, "shell", async (action) => {
      ran.push(action);
      return "no";
    });
    expect(ran).toEqual([]);
  });

  it("executes only the approved allowlisted action", async () => {
    const api = memoryApi();
    const id = await api.create("user-1", "phone", "pc", "open_app", "notepad");
    const row = await api.get("user-1", id);
    if (!row) throw new Error("missing");
    const waiting = await fulfillComputerAction(api, row, "windows", true, null, async () => "Opened Notepad.");
    expect(waiting).toEqual({ action: "waiting", label: "Open Notepad" });
    const done = await fulfillComputerAction(api, row, "windows", true, id, async () => "Opened Notepad.");
    expect(done.action).toBe("answered");
    expect(api.rows[0]?.result).toBe("Opened Notepad.");
  });
});
