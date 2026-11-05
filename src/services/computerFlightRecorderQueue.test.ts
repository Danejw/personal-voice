import { afterEach, describe, expect, it, vi } from "vitest";

const cloud = vi.hoisted(() => ({
  online: false,
  events: new Map<string, Record<string, unknown>>(),
}));
vi.mock("@/services/supabase", () => ({
  getSupabase: () => ({
    from: () => ({
      upsert: async (rows: Array<{ id: string; occurred_at: string }>) => {
        if (!cloud.online) return { error: { message: "Connection unavailable" } };
        for (const row of rows) {
          cloud.events.set(row.id, { ...row, recorded_at: row.occurred_at });
        }
        return { error: null };
      },
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: async () => ({
              data: [...cloud.events.values()],
              error: cloud.online ? null : { message: "Network unavailable" },
            }),
          }),
        }),
      }),
    }),
  }),
}));
import {
  flushComputerEvents, readComputerTimeline, recordComputerEvent,
} from "@/services/computerFlightRecorder";

afterEach(() => {
  vi.unstubAllGlobals();
  cloud.events.clear();
  cloud.online = false;
});

describe("flight recorder offline recovery", () => {
  it("preserves queued events through a disconnect, replays only telemetry IDs, and never sends text", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    });
    recordComputerEvent({
      userId: "offline-user", deviceId: "windows-device", traceId: "task-id",
      actor: "windows", stage: "screen", step: 0,
    });
    recordComputerEvent({
      userId: "offline-user", deviceId: "windows-device", traceId: "task-id",
      actor: "windows", stage: "acted", action: "type private text", step: 1,
    });
    await vi.waitFor(() => {
      const pending = JSON.parse(values.get("personal-voice.flight.v1.offline-user") ?? "[]");
      expect(pending).toHaveLength(2);
    });
    expect(cloud.events.size).toBe(0);
    cloud.online = true;
    await vi.waitFor(async () => {
      await flushComputerEvents("offline-user");
      expect(cloud.events.size).toBe(2);
    });
    const result = await readComputerTimeline("offline-user");
    expect(result.synced).toBe(true);
    expect(result.events).toHaveLength(2);
    expect(result.events.map(e => e.trace_id)).toEqual(["task-id", "task-id"]);
    expect(result.events.find(e => e.stage === "acted")?.action_kind).toBe("unsupported");
    expect(JSON.stringify([...cloud.events.values()])).not.toContain("private text");
    expect(JSON.parse(values.get("personal-voice.flight.v1.offline-user") ?? "[]")).toHaveLength(0);
  });
});
