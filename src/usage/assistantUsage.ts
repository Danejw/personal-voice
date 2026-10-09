/** Content-free Assistant usage records. Distinct from saved conversations and Live sockets. */
export type AssistantUsageKind =
  | "session_started" | "user_turn" | "assistant_turn" | "active_interval" | "session_ended";
export type AssistantUsageModality = "typed" | "voice" | "unknown";
export type AssistantUsageEnd = "explicit" | "idle" | "signout" | "error";

export interface AssistantUsageEvent {
  id: string;
  deviceId: string;
  sessionId: string;
  conversationId: string | null;
  epoch: number;
  occurredAt: string;
  localDay: string;
  kind: AssistantUsageKind;
  modality: AssistantUsageModality | null;
  durationMs: number | null;
  endReason: AssistantUsageEnd | null;
}

export interface AssistantUsageSummary {
  sessions: number;
  userTurns: number;
  assistantTurns: number;
  voiceTurns: number;
  typedTurns: number;
  activeMs: number;
  activeDays: number;
  byDay: { day: string; sessions: number; turns: number; activeMs: number }[];
  byDevice: { deviceId: string; turns: number }[];
}

export function localUsageDay(at: Date): string {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

/** Split measured activity at local midnight, without duplicating session starts. */
export function splitAssistantActivity(from: Date, to: Date): { day: string; durationMs: number; at: string }[] {
  if (!(from.getTime() < to.getTime())) return [];
  const result: { day: string; durationMs: number; at: string }[] = [];
  let cursor = from.getTime();
  const finish = Math.min(to.getTime(), cursor + 120_000);
  while (cursor < finish) {
    const date = new Date(cursor);
    const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
    const end = Math.min(midnight, finish);
    result.push({ day: localUsageDay(date), durationMs: end - cursor, at: date.toISOString() });
    cursor = end;
  }
  return result;
}

/** All values are measured events. No guessing prior session durations from old messages. */
export function summarizeAssistantUsage(events: readonly AssistantUsageEvent[], fromDay: string, throughDay: string): AssistantUsageSummary {
  const rows = events.filter(e => e.localDay >= fromDay && e.localDay <= throughDay);
  const sessionIds = new Set<string>();
  const active = new Set<string>();
  const days = new Map<string, { day: string; sessions: number; turns: number; activeMs: number }>();
  const devices = new Map<string, number>();
  let voiceTurns = 0;
  let typedTurns = 0;
  let userTurns = 0;
  let assistantTurns = 0;
  let activeMs = 0;
  for (const row of rows) {
    let day = days.get(row.localDay);
    if (!day) { day = { day: row.localDay, sessions: 0, turns: 0, activeMs: 0 }; days.set(row.localDay, day); }
    if (row.kind === "session_started") {
      sessionIds.add(row.sessionId);
      day.sessions += 1;
    } else if (row.kind === "user_turn") {
      userTurns += 1;
      day.turns += 1;
      active.add(row.localDay);
      devices.set(row.deviceId, (devices.get(row.deviceId) ?? 0) + 1);
      if (row.modality === "voice") voiceTurns += 1;
      if (row.modality === "typed") typedTurns += 1;
    } else if (row.kind === "assistant_turn") {
      assistantTurns += 1;
    } else if (row.kind === "active_interval") {
      const interval = Math.max(0, row.durationMs ?? 0);
      activeMs += interval;
      day.activeMs += interval;
    }
  }
  return {
    sessions: sessionIds.size, userTurns, assistantTurns, voiceTurns, typedTurns,
    activeMs, activeDays: active.size,
    byDay: [...days.values()].sort((a,b) => a.day.localeCompare(b.day)),
    byDevice: [...devices].map(([deviceId,turns]) => ({deviceId,turns})).sort((a,b) => b.turns - a.turns),
  };
}
