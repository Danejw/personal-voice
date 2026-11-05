/** Minimal Windows-local crash journal for a single authenticated remote Computer Use goal.
 * The model/tool loop is owned by Windows; this journal never replays actions.
 * Sensitive screenshots and goal text are intentionally not stored.
 */
export type JournalGoalStatus =
  | "starting" | "running" | "stopping" | "stopped"
  | "completed" | "failed" | "interrupted" | "needs_review";

export interface JournalGoal {
  jobId: string;
  requesterDeviceId: string;
  status: JournalGoalStatus;
  steps: number;
  lastAction: string;
  result: string;
  updatedAt: number;
}

const PREFIX = "personal-voice.remote-goal.v1";
const ACTIVE = new Set<JournalGoalStatus>(["starting", "running", "stopping"]);

export function remoteGoalJournalKey(userId: string, deviceId: string): string {
  return `${PREFIX}.${userId}.${deviceId}`;
}

export function saveRemoteGoal(
  storage: Pick<Storage, "setItem">, userId: string, deviceId: string, state: JournalGoal,
): void {
  // No screenshots or full requested goal leave the existing Windows model path.
  storage.setItem(remoteGoalJournalKey(userId, deviceId), JSON.stringify({
    ...state, lastAction: state.lastAction.slice(0, 200), result: state.result.slice(0, 1000),
    updatedAt: Date.now(),
  }));
}

export function restoreRemoteGoal(
  storage: Pick<Storage, "getItem" | "setItem">, userId: string, deviceId: string,
): JournalGoal | null {
  const key = remoteGoalJournalKey(userId, deviceId);
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const v = value as Record<string, unknown>;
    if (typeof v.jobId !== "string" || !v.jobId || typeof v.requesterDeviceId !== "string"
      || typeof v.status !== "string" || !["starting", "running", "stopping", "stopped", "completed", "failed", "interrupted", "needs_review"].includes(v.status)
      || typeof v.steps !== "number" || !Number.isSafeInteger(v.steps) || v.steps < 0
      || typeof v.lastAction !== "string" || typeof v.result !== "string"
      || typeof v.updatedAt !== "number") return null;
    const record: JournalGoal = {
      jobId: v.jobId, requesterDeviceId: v.requesterDeviceId,
      status: v.status as JournalGoalStatus, steps: v.steps,
      lastAction: v.lastAction.slice(0, 200), result: v.result.slice(0, 1000),
      updatedAt: v.updatedAt,
    };
    if (ACTIVE.has(record.status)) {
      record.status = "interrupted";
      record.result = "Windows restarted before this task was verified. Inspect the current desktop before continuing; actions were not replayed.";
      saveRemoteGoal(storage, userId, deviceId, record);
    }
    return record;
  } catch { return null; }
}
