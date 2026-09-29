import {
  REMOTE_POLL_MS,
  REMOTE_TIMEOUT_MS,
  buildRemoteResponse,
  parseRemoteResponse,
  planRemoteRead,
  type RemoteKind,
  type RemoteResponse,
} from "@/assistant/remoteContext";

export interface RemoteRequestRow {
  id: string;
  userId: string;
  requesterDeviceId: string;
  targetDeviceId: string;
  kind: string;
  status: "pending" | "answered" | "denied";
  response: string | null;
  error: string | null;
}

export interface RemoteContextApi {
  create(userId: string, requesterDeviceId: string, targetDeviceId: string, kind: RemoteKind): Promise<string>;
  get(userId: string, id: string): Promise<RemoteRequestRow | null>;
  listPending(userId: string, targetDeviceId: string): Promise<RemoteRequestRow[]>;
  answer(userId: string, id: string, response: string): Promise<void>;
  deny(userId: string, id: string, message: string): Promise<void>;
  remove(userId: string, id: string): Promise<void>;
}

export interface AskClock {
  now(): number;
  sleep(ms: number): Promise<void>;
  timeoutMs?: number;
  pollMs?: number;
}

/** Sends one read and deletes the row after the answer, denial, or timeout. */
export async function askRemote(
  api: RemoteContextApi,
  userId: string,
  requesterDeviceId: string,
  targetDeviceId: string,
  targetName: string,
  kind: RemoteKind,
  clock: AskClock,
): Promise<RemoteResponse> {
  const id = await api.create(userId, requesterDeviceId, targetDeviceId, kind);
  const deadline = clock.now() + (clock.timeoutMs ?? REMOTE_TIMEOUT_MS);
  const poll = clock.pollMs ?? REMOTE_POLL_MS;
  while (clock.now() < deadline) {
    const row = await api.get(userId, id);
    if (row?.status === "answered") {
      const response = parseRemoteResponse(row.response);
      await api.remove(userId, id);
      if (!response) throw new Error(`${targetName} sent a response that could not be read.`);
      return response;
    }
    if (row?.status === "denied") {
      const message = row.error ?? `${targetName} declined the read.`;
      await api.remove(userId, id);
      throw new Error(message);
    }
    await clock.sleep(poll);
  }
  await api.remove(userId, id);
  throw new Error(`${targetName} didn't respond.`);
}

export interface RemoteFulfillment {
  action: "answered" | "denied" | "waiting";
}

/**
 * One pending request. `capture` runs only after the caller has already approved a screenshot.
 * A denied plan never calls `describe` or `capture`.
 */
export async function fulfillRemoteRequest(
  api: RemoteContextApi,
  row: RemoteRequestRow,
  local: {
    userId: string;
    deviceName: string;
    platform: string;
    remoteReads: boolean;
    approvedScreenshotId: string | null;
    describe(): Promise<{ active: string | null; windows: string[] }>;
    capture(): Promise<{ jpeg: string; sourceApp: string | null; width: number; height: number }>;
  },
): Promise<RemoteFulfillment> {
  const plan = planRemoteRead(row.kind, local.platform, local.remoteReads);
  if (plan.action === "deny") {
    await api.deny(local.userId, row.id, plan.message);
    return { action: "denied" };
  }
  if (plan.action === "approve-screenshot" && local.approvedScreenshotId !== row.id) {
    return { action: "waiting" };
  }
  if (plan.action === "answer-presence") {
    const built = buildRemoteResponse("presence", local.deviceName, local.platform, null, null);
    if (!built.ok) {
      await api.deny(local.userId, row.id, built.message);
      return { action: "denied" };
    }
    await api.answer(local.userId, row.id, built.json);
    return { action: "answered" };
  }
  if (plan.action === "approve-screenshot") {
    const shot = await local.capture();
    const built = buildRemoteResponse("screenshot", local.deviceName, local.platform, null, shot);
    if (!built.ok) {
      await api.deny(local.userId, row.id, built.message);
      return { action: "denied" };
    }
    await api.answer(local.userId, row.id, built.json);
    return { action: "answered" };
  }
  const report = await local.describe();
  const kind = row.kind === "windows" ? "windows" : "active_window";
  const built = buildRemoteResponse(kind, local.deviceName, local.platform, report, null);
  if (!built.ok) {
    await api.deny(local.userId, row.id, built.message);
    return { action: "denied" };
  }
  await api.answer(local.userId, row.id, built.json);
  return { action: "answered" };
}
