import { describe, expect, it, vi } from "vitest";
import { localUsageDay, splitAssistantActivity, summarizeAssistantUsage, type AssistantUsageEvent } from "@/usage/assistantUsage";
import { AssistantUsageStore } from "@/usage/AssistantUsageStore";
import type { AssistantUsageApi } from "@/services/assistantUsageService";

function setup() {
  const files = new Map<string, string>();
  const storage = {
    getItem: (key: string) => files.get(key) ?? null,
    setItem: (key: string, value: string) => { files.set(key, value); },
    removeItem: (key: string) => { files.delete(key); },
  };
  const sent: AssistantUsageEvent[] = [];
  const api: AssistantUsageApi = {
    write: vi.fn(async (event) => { sent.push(event); }),
    list: vi.fn(async () => sent),
  };
  let time = new Date(2026, 9, 9, 10, 0).getTime();
  let index = 0;
  const clock = () => time;
  const uuid = () => `00000000-0000-4000-8000-${String(++index).padStart(12, "0")}`;
  const store = new AssistantUsageStore(api, storage, clock, uuid);
  const scope = { userId: "user-a", deviceId: "device-a", epoch: 0, enabled: true };
  const tick = (ms: number) => { time += ms; };
  return { store, storage, sent, api, scope, tick, files };
}

describe("Assistant Usage phase A", () => {
  it("starts on the first actual turn, ignores websocket reconnects and finalizes each modality", () => {
    const t = setup();
    t.store.setScope(t.scope);
    t.store.onStatus("READY"); // Opening the mic alone is not a session.
    expect(t.store.getPending()).toHaveLength(0);
    t.store.recordTurn({ id: "typed-1", role: "user", modality: "typed" }, "conversation-a");
    t.store.onStatus("CONNECTING"); // reconnect retains session ID
    t.store.onStatus("READY");
    t.tick(3000);
    t.store.recordTurn({ id: "answer-1", role: "assistant" }, "conversation-a");
    t.tick(1000);
    t.store.recordTurn({ id: "voice-1", role: "user", modality: "voice" }, "conversation-a");
    t.store.recordTurn({ id: "voice-1", role: "user", modality: "voice" }, "conversation-a"); // retry
    t.store.endSession("explicit");
    const rows = t.store.getPending();
    expect(rows.filter(e => e.kind === "session_started")).toHaveLength(1);
    expect(rows.filter(e => e.kind === "user_turn")).toHaveLength(2);
    expect(rows.filter(e => e.kind === "assistant_turn")).toHaveLength(1);
    expect(rows.filter(e => e.kind === "session_ended")).toHaveLength(1);
    expect(new Set(rows.map(e => e.sessionId)).size).toBe(1);
    expect(JSON.stringify(rows)).not.toContain("conversation transcript");
  });

  it("creates a new session after five minutes idle, but does not bill idle time as active", () => {
    const t = setup();
    t.store.setScope(t.scope);
    t.store.recordTurn({ id: "a", role: "user", modality: "typed" }, null);
    t.tick(6 * 60_000);
    t.store.recordTurn({ id: "b", role: "user", modality: "voice" }, null);
    const rows = t.store.getPending();
    expect(rows.filter(e => e.kind === "session_started")).toHaveLength(2);
    expect(rows.filter(e => e.kind === "session_ended")[0]?.endReason).toBe("idle");
    expect(rows.filter(e => e.kind === "active_interval").reduce((n,e) => n + (e.durationMs ?? 0), 0)).toBe(2000);
  });

  it("splits activity at local midnight without creating another session", () => {
    const from = new Date(2026, 9, 9, 23, 59, 59, 0);
    const parts = splitAssistantActivity(from, new Date(2026, 9, 10, 0, 0, 2, 0));
    expect(parts).toHaveLength(2);
    expect(parts.map(p => p.durationMs)).toEqual([1000, 2000]);
    expect(parts.map(p => p.day)).toEqual(["2026-10-09","2026-10-10"]);
    expect(localUsageDay(new Date(2026,9,10,6,0))).toBe("2026-10-10");
  });

  it("prevents analytics collection when disabled and clears stale queued epochs and owners", () => {
    const t = setup();
    t.store.setScope({ ...t.scope, enabled: false });
    t.store.recordTurn({ id: "off", role: "user", modality: "voice" }, null);
    expect(t.store.getPending()).toHaveLength(0);
    t.store.setScope(t.scope);
    t.store.recordTurn({ id: "a", role: "user", modality: "voice" }, null);
    t.store.setScope({ ...t.scope, epoch: 1 });
    expect(t.store.getPending()).toHaveLength(0);
    expect([...t.files.keys()].some(key => key.endsWith(".0"))).toBe(false);
    t.store.recordTurn({ id: "b", role: "user", modality: "typed" }, null);
    t.store.setScope({ userId: "user-b", deviceId: "device-b", epoch: 1, enabled: true });
    expect(t.store.getPending()).toHaveLength(0);
  });

  it("merges local and server records by event ID and reports truthful usage", () => {
    const at = "2026-10-09T10:00:00.000Z";
    const base: AssistantUsageEvent = {
      id: "a", deviceId: "device-1", sessionId: "session-1", conversationId: null,
      epoch: 0, occurredAt: at, localDay: "2026-10-09", kind: "session_started",
      modality: null, durationMs: null, endReason: null,
    };
    const rows: AssistantUsageEvent[] = [
      base, {...base, id:"b",kind:"user_turn",modality:"voice"},
      {...base, id:"c",kind:"assistant_turn"},
      {...base,id:"d",kind:"active_interval",durationMs:3000},
      {...base,id:"e",deviceId:"device-2",sessionId:"session-2",kind:"user_turn",modality:"typed",localDay:"2026-10-10"},
      {...base,id:"f",kind:"user_turn",modality:"unknown",localDay:"2026-10-10"},
    ];
    expect(summarizeAssistantUsage(rows, "2026-10-09","2026-10-10")).toMatchObject({
      sessions: 1, userTurns: 3, assistantTurns: 1, activeMs: 3000, voiceTurns: 1,
      typedTurns: 1, activeDays: 2,
    });
    expect(summarizeAssistantUsage(rows,"2026-10-10","2026-10-10").sessions).toBe(0);
  });
});
