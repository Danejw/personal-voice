import { planRemoteComputerAction, type RemoteComputerAction } from "@/assistant/computerActions";
import { resolveRemoteDevice, type RemoteDevice } from "@/assistant/remoteContext";

export const COMPUTER_REMOTE_TIMEOUT_MS = 30_000;
export const COMPUTER_REMOTE_POLL_MS = 2_000;

export interface ComputerActionRow {
  id: string;
  userId: string;
  requesterDeviceId: string;
  targetDeviceId: string;
  action: string;
  argument: string;
  status: "pending" | "answered" | "denied";
  result: string | null;
  error: string | null;
  version: number;
  expiresAt: string;
  requestSignature: string | null;
  responseSignature: string | null;
}

export interface ComputerActionApi {
  create(
    userId: string,
    requesterDeviceId: string,
    targetDeviceId: string,
    action: RemoteComputerAction,
    argument: string,
  ): Promise<string>;
  get(userId: string, id: string): Promise<ComputerActionRow | null>;
  listPending(userId: string, targetDeviceId: string): Promise<ComputerActionRow[]>;
  answer(userId: string, id: string, result: string): Promise<void>;
  deny(userId: string, id: string, message: string): Promise<void>;
  remove(userId: string, id: string): Promise<void>;
}

export interface ComputerClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

/** Receipt updates are informational. Only a signed response can confirm acceptance. */
export type RemoteCommandReceipt = { requestId: string; stage: "queued" | "answered" | "denied" | "timed_out" };

function retryableReadFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // Authentication, signing, and pairing failures must never be retried as network errors.
  return error instanceof TypeError || /(?:network|fetch|connection|timed? out|temporarily unavailable|HTTP 5[0-9][0-9])/i.test(error.message);
}

/**
 * Asks one owned device. Does not insert a row when the device is offline or not on the account.
 * The returned text is the target's result, or an error when it denies or times out.
 */
export async function askComputerAction(
  api: ComputerActionApi,
  userId: string,
  requesterDeviceId: string,
  devices: readonly RemoteDevice[],
  deviceName: string,
  action: RemoteComputerAction,
  argument: string,
  clock: ComputerClock,
  onReceipt?: (receipt: RemoteCommandReceipt) => void,
): Promise<string> {
  const resolved = resolveRemoteDevice(devices, requesterDeviceId, deviceName, clock.now());
  if (!resolved.ok) throw new Error(resolved.message);
  const id = await api.create(userId, requesterDeviceId, resolved.device.id, action, argument);
  onReceipt?.({ requestId: id, stage: "queued" });
  const deadline = clock.now() + COMPUTER_REMOTE_TIMEOUT_MS;
  while (clock.now() < deadline) {
    let row: ComputerActionRow | null;
    try {
      row = await api.get(userId, id);
    } catch (error) {
      if (!retryableReadFailure(error)) throw error;
      // Retry reading the SAME signed request. Never create/execute a second command.
      await clock.sleep(COMPUTER_REMOTE_POLL_MS);
      continue;
    }
    if (row && row.userId !== userId) {
      await api.remove(userId, id);
      throw new Error("That device is not on this account.");
    }
    if (row?.status === "answered" && row.result) {
      onReceipt?.({ requestId: id, stage: "answered" });
      // An expired cleanup request must not turn an authenticated result into a failure.
      await api.remove(userId, id).catch(() => undefined);
      return row.result;
    }
    if (row?.status === "denied") {
      onReceipt?.({ requestId: id, stage: "denied" });
      const message = row.error ?? `${resolved.device.name} declined the action.`;
      await api.remove(userId, id).catch(() => undefined);
      throw new Error(message);
    }
    await clock.sleep(COMPUTER_REMOTE_POLL_MS);
  }
  onReceipt?.({ requestId: id, stage: "timed_out" });
  await api.remove(userId, id).catch(() => undefined);
  throw new Error(`${resolved.device.name} didn't acknowledge the command. Its outcome is unknown; check task status before trying again.`);
}

export interface ComputerFulfillment {
  action: "answered" | "denied" | "waiting";
  label?: string;
  failureKind?: "policy" | "execution";
  reason?: string;
}

export interface TrustedRemoteExecution {
  /** A server-atomic claim; 'already' means NEVER offer a second approval. */
  claim(): Promise<"none" | "claimed" | "already">;
}

/**
 * Only an explicit local PC approval OR a one-use remote grant claim permits
 * execution. Unavailable grants fall back to the existing confirmation UI.
 * An already-claimed request must not execute twice or be offered for approval.
 */
export async function fulfillComputerAction(
  api: ComputerActionApi,
  row: ComputerActionRow,
  platform: string,
  remoteActions: boolean,
  approvedId: string | null,
  execute: (action: RemoteComputerAction, argument: string, trusted: boolean) => Promise<string>,
  trustedExecution?: TrustedRemoteExecution | null,
): Promise<ComputerFulfillment> {
  const plan = planRemoteComputerAction(row.action, row.argument, platform, remoteActions);
  if (plan.action === "deny") {
    await api.deny(row.userId, row.id, plan.message);
    return { action: "denied", failureKind: "policy", reason: plan.message };
  }
  let trusted = false;
  if (approvedId !== row.id) {
    if (!trustedExecution) return { action: "waiting", label: plan.label };
    let claimed: "none" | "claimed" | "already";
    try { claimed = await trustedExecution.claim(); }
    catch { return { action: "waiting", label: plan.label }; }
    if (claimed === "already") return { action: "waiting" };
    if (claimed !== "claimed") return { action: "waiting", label: plan.label };
    trusted = true;
  }
  try {
    const result = await execute(row.action as RemoteComputerAction, row.argument, trusted);
    await api.answer(row.userId, row.id, result);
    return { action: "answered" };
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "The action failed.";
    await api.deny(row.userId, row.id, message);
    return { action: "denied", failureKind: "execution", reason: message };
  }
}
