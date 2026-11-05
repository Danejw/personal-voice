import { getSupabase } from "@/services/supabase";
import { pairServerAction } from "@/services/devicePairingService";
import type { Database } from "@/types/database";

/** Durable metadata only. No screenshots, audio, credentials, or action arguments. */
export type ComputerJob = Database["public"]["Tables"]["computer_jobs"]["Row"];
export type ComputerJobStatus = ComputerJob["status"];
export type ComputerJobPhase = ComputerJob["phase"];
export type JobCheckpoint = {
  status: ComputerJobStatus;
  phase: ComputerJobPhase;
  steps: number;
  lastAction: string;
  result?: string;
  evidence?: string | null;
};

function jobRow(value: unknown): ComputerJob {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid durable Computer Use job response.");
  }
  const row = value as ComputerJob;
  if (typeof row.id !== "string" || typeof row.goal !== "string" ||
      typeof row.requester_device_id !== "string" || typeof row.target_device_id !== "string" ||
      typeof row.status !== "string" || typeof row.phase !== "string" ||
      typeof row.steps !== "number") {
    throw new Error("Incomplete durable Computer Use job response.");
  }
  return row;
}

async function mutate(pcDeviceId: string, args: Record<string, unknown>): Promise<ComputerJob> {
  return jobRow(await pairServerAction<unknown>(pcDeviceId, "job_mutate", args));
}

export const computerJobsApi = {
  /** Called before acknowledging the signed start request. The database copies the verified goal. */
  create(pcDeviceId: string, requestId: string): Promise<ComputerJob> {
    return mutate(pcDeviceId, { event: "create", requestId });
  },
  /** Only a signed, acknowledged Windows request may become an executing job. */
  activate(pcDeviceId: string, requestId: string): Promise<ComputerJob> {
    return mutate(pcDeviceId, { event: "activate", requestId });
  },
  cancelPending(pcDeviceId: string, requestId: string): Promise<ComputerJob> {
    return mutate(pcDeviceId, { event: "cancel_pending", requestId });
  },
  checkpoint(pcDeviceId: string, requestId: string, token: string, point: JobCheckpoint): Promise<ComputerJob> {
    return mutate(pcDeviceId, {
      event: "checkpoint", requestId, token, status: point.status, phase: point.phase,
      steps: point.steps, lastAction: point.lastAction,
      result: point.result ?? "", evidence: point.evidence ?? null,
    });
  },
  requestStop(pcDeviceId: string, requestId: string, token: string): Promise<ComputerJob> {
    return mutate(pcDeviceId, { event: "request_stop", requestId, token });
  },
  heartbeat(pcDeviceId: string, requestId: string, token: string): Promise<ComputerJob> {
    return mutate(pcDeviceId, { event: "heartbeat", requestId, token });
  },
  async reconcile(pcDeviceId: string, canResume: boolean): Promise<{
    resumed: boolean; job: ComputerJob;
  } | null> {
    const result = await pairServerAction<unknown>(pcDeviceId, "job_mutate", {
      event: "reconcile", canResume,
    });
    if (result === null) return null;
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error("Invalid durable Computer Use recovery response.");
    }
    const response = result as { resumed?: unknown; job?: unknown };
    if (typeof response.resumed !== "boolean") throw new Error("Invalid recovery decision.");
    return { resumed: response.resumed, job: jobRow(response.job) };
  },
  /** Owner-scoped read. A phone cannot write or forge a Windows completion state. */
  async latest(userId: string, pcDeviceId: string): Promise<ComputerJob | null> {
    const client = getSupabase();
    if (!client) throw new Error("Sign in to view Computer Use jobs.");
    const { data, error } = await client.from("computer_jobs").select("*")
      .eq("user_id", userId).eq("target_device_id", pcDeviceId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error("Computer Use job status is unavailable.");
    return data ? jobRow(data) : null;
  },
};
