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
): Promise<string> {
  const resolved = resolveRemoteDevice(devices, requesterDeviceId, deviceName, clock.now());
  if (!resolved.ok) throw new Error(resolved.message);
  const id = await api.create(userId, requesterDeviceId, resolved.device.id, action, argument);
  const deadline = clock.now() + COMPUTER_REMOTE_TIMEOUT_MS;
  while (clock.now() < deadline) {
    const row = await api.get(userId, id);
    if (row && row.userId !== userId) {
      await api.remove(userId, id);
      throw new Error("That device is not on this account.");
    }
    if (row?.status === "answered" && row.result) {
      await api.remove(userId, id);
      return row.result;
    }
    if (row?.status === "denied") {
      const message = row.error ?? `${resolved.device.name} declined the action.`;
      await api.remove(userId, id);
      throw new Error(message);
    }
    await clock.sleep(COMPUTER_REMOTE_POLL_MS);
  }
  await api.remove(userId, id);
  throw new Error(`${resolved.device.name} didn't respond.`);
}

export interface ComputerFulfillment {
  action: "answered" | "denied" | "waiting";
  label?: string;
}

/**
 * The target runs the action only after a confirm plan and an explicit approval.
 * A denial does not call `execute`.
 */
export async function fulfillComputerAction(
  api: ComputerActionApi,
  row: ComputerActionRow,
  platform: string,
  remoteActions: boolean,
  approvedId: string | null,
  execute: (action: RemoteComputerAction, argument: string) => Promise<string>,
): Promise<ComputerFulfillment> {
  const plan = planRemoteComputerAction(row.action, row.argument, platform, remoteActions);
  if (plan.action === "deny") {
    await api.deny(row.userId, row.id, plan.message);
    return { action: "denied" };
  }
  if (approvedId !== row.id) return { action: "waiting", label: plan.label };
  try {
    const result = await execute(row.action as RemoteComputerAction, row.argument);
    await api.answer(row.userId, row.id, result);
    return { action: "answered" };
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "The action failed.";
    await api.deny(row.userId, row.id, message);
    return { action: "denied" };
  }
}
