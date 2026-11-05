import { getSupabase } from "@/services/supabase";
import type { Database } from "@/types/database";

/** Small, non-sensitive event vocabulary. No prompts, screenshots or typed values. */
export type FlightStage = "queued" | "received" | "authorized" | "started" |
  "screen" | "model" | "acted" | "acknowledged" | "verified" | "unverified" |
  "stopped" | "blocked" | "failed" | "timeout";
export type FlightActor = "android" | "windows";
export type FlightFailure = "network" | "auth" | "locked" | "timeout" |
  "model" | "tool" | "capture" | "verification" | "unknown" |
  "refused" | "cancelled" | "unavailable";
export type FlightEvent = Database["public"]["Tables"]["computer_task_events"]["Row"];
type FlightInsert = Database["public"]["Tables"]["computer_task_events"]["Insert"];
export type FlightInput = {
  userId: string;
  deviceId: string;
  traceId: string;
  actor: FlightActor;
  stage: FlightStage;
  action?: string | null;
  step?: number | null;
  code?: FlightFailure | null;
};

const PREFIX = "personal-voice.flight.v1.";
const MAX_PENDING = 300;
const SAFE_ACTIONS = new Set([
  "click", "double_click", "move", "right_click", "drag", "drag_and_drop",
  "scroll", "type", "wait", "press_key", "hotkey", "take_screenshot",
  "open_app", "press_shortcut", "insert_text", "start_computer_goal",
  "computer_goal_status", "stop_computer_goal", "move_pointer",
  "click_pointer", "double_click_pointer", "right_click_pointer", "drag_pointer",
]);
const memoryQueue = new Map<string, FlightInsert[]>();
const uploading = new Set<string>();

export function flightActionName(action: string | null | undefined): string | null {
  if (!action) return null;
  return SAFE_ACTIONS.has(action) ? action : "unsupported";
}

export function flightFailureCode(reason: unknown, fallback: FlightFailure = "unknown"): FlightFailure {
  const message = reason instanceof Error ? reason.message : "";
  if (/locked|unlock/i.test(message)) return "locked";
  if (/expired|timed? out|didn't acknowledge|deadline/i.test(message)) return "timeout";
  if (/sign.in|auth|signature|pairing|revoked|claim/i.test(message)) return "auth";
  if (/network|fetch|connection|internet|offline|unreachable/i.test(message)) return "network";
  if (/screen|capture|snapshot/i.test(message)) return "capture";
  if (/model|rate.limit|computer.use.service/i.test(message)) return "model";
  if (/denied|blocked|not allowed/i.test(message)) return "refused";
  return fallback;
}

function readPending(userId: string): FlightInsert[] {
  try {
    const raw = localStorage.getItem(PREFIX + userId);
    const stored: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(stored)) return [];
    return stored.filter((v): v is FlightInsert =>
      typeof v === "object" && v !== null &&
      (v as FlightInsert).user_id === userId &&
      typeof (v as FlightInsert).id === "string" &&
      typeof (v as FlightInsert).trace_id === "string" &&
      typeof (v as FlightInsert).stage === "string").slice(-MAX_PENDING);
  } catch {
    return memoryQueue.get(userId) ?? [];
  }
}

function savePending(userId: string, queue: FlightInsert[]): void {
  const tail = queue.slice(-MAX_PENDING);
  memoryQueue.set(userId, tail);
  try { localStorage.setItem(PREFIX + userId, JSON.stringify(tail)); }
  catch { /* Events are retained in memory when storage is unavailable. */ }
}

export function recordComputerEvent(input: FlightInput): void {
  if (!input.userId || !input.deviceId || !input.traceId) return;
  const event: FlightInsert = {
    id: crypto.randomUUID(),
    user_id: input.userId,
    device_id: input.deviceId,
    trace_id: input.traceId,
    actor: input.actor,
    stage: input.stage,
    action_kind: flightActionName(input.action),
    step: typeof input.step === "number" && Number.isSafeInteger(input.step) && input.step >= 0 && input.step <= 240
      ? input.step : null,
    failure_code: input.code ?? null,
    occurred_at: new Date().toISOString(),
  };
  savePending(input.userId, [...readPending(input.userId), event]);
  // No telemetry failure may block a signed command, a pointer action or speech.
  void flushComputerEvents(input.userId).catch(() => undefined);
}

export async function flushComputerEvents(userId: string): Promise<void> {
  if (uploading.has(userId)) return;
  const client = getSupabase();
  if (!client) throw new Error("Sign in to sync the Flight Recorder.");
  uploading.add(userId);
  try {
    while (true) {
      const batch = readPending(userId).slice(0, 80);
      if (!batch.length) break;
      // Stable per-event UUIDs make resumed uploads idempotent. No UPDATE grant required.
      const { error } = await client.from("computer_task_events")
        .upsert(batch, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      const uploaded = new Set(batch.map(item => item.id));
      savePending(userId, readPending(userId).filter(item => !uploaded.has(item.id)));
    }
  } finally {
    uploading.delete(userId);
  }
}

export type FlightTimelineResult = { events: FlightEvent[]; synced: boolean };

/** The local pending queue is still readable while offline or before migrations apply. */
export async function readComputerTimeline(userId: string, limit = 160): Promise<FlightTimelineResult> {
  await flushComputerEvents(userId).catch(() => undefined);
  const local = readPending(userId) as FlightEvent[];
  const client = getSupabase();
  if (!client) return { events: local.slice(-limit), synced: false };
  const { data, error } = await client.from("computer_task_events")
    .select("id,user_id,trace_id,device_id,actor,stage,action_kind,step,failure_code,occurred_at,recorded_at")
    .eq("user_id", userId).order("occurred_at", { ascending: false }).limit(limit);
  if (error) return { events: local.slice(-limit), synced: false };
  const merged = new Map<string, FlightEvent>();
  for (const item of [...(data ?? []), ...local]) merged.set(item.id, item);
  return {
    events: [...merged.values()].sort((a, b) =>
      (b.occurred_at ?? "").localeCompare(a.occurred_at ?? "") || b.id.localeCompare(a.id)).slice(0, limit),
    synced: true,
  };
}

/** Never infer success from request acceptance or a native action receipt. */
export function flightDiagnosis(events: readonly Pick<FlightEvent, "stage" | "actor" | "failure_code">[]): string {
  if (!events.length) return "No events recorded";
  // A later Android status-read timeout must never override a Windows-verified outcome.
  if (events.some(e => e.stage === "verified" && e.actor === "windows")) return "Verified on Windows";
  const terminal = events.find(e => e.actor === "windows"
    && ["failed", "blocked", "unverified", "stopped"].includes(e.stage))
    ?? events.find(e => ["failed", "blocked", "unverified", "stopped", "timeout"].includes(e.stage));
  if (terminal) {
    const where = terminal.actor === "android" ? "Android" : "Windows";
    return `${where}: ${terminal.stage}${terminal.failure_code ? ` (${terminal.failure_code})` : ""}`;
  }
  const latest = events[0]!;
  return latest.stage === "queued" ? "Waiting for Windows"
    : latest.stage === "acknowledged" ? "Command acknowledged, result not verified"
      : "Task in progress";
}
