import { getSupabase, supabaseConfig } from "@/services/supabase";
import { isToolFailureKind, isToolOutcome, type AssistantToolAttempt } from "@/usage/assistantToolMetrics";
import type { ToolFamily } from "@/assistant/harness/toolIntelligence";

export interface AssistantToolMetricsApi {
  write(event: AssistantToolAttempt, userId: string): Promise<void>;
  list(epoch: number, userId: string, fromDay: string): Promise<AssistantToolAttempt[]>;
}

async function request(path: string, userId: string, init?: RequestInit): Promise<unknown> {
  if (!supabaseConfig) throw new Error("Tool Analytics is not configured.");
  const client = getSupabase();
  if (!client) throw new Error("Tool Analytics requires sign in.");
  const { data: { session } } = await client.auth.getSession();
  if (!session?.access_token || session.user.id !== userId) throw new Error("Tool Analytics account changed.");
  const response = await fetch(`${supabaseConfig.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: supabaseConfig.publishableKey,
      Authorization: `Bearer ${session.access_token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`Tool Analytics request failed (${response.status}).`);
  if (response.status === 204 || !response.headers.get("content-type")?.includes("json")) return null;
  return response.json() as Promise<unknown>;
}

const NAME = /^[a-z][a-z0-9_]{0,79}$/;
const FAMILIES = new Set<ToolFamily | "unknown">([
  "text","devices","visual","session","windows","memory","analytics","harness","unknown",
]);
function parse(raw: unknown): AssistantToolAttempt | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string,unknown>;
  if (typeof r.id !== "string" || typeof r.device_id !== "string" ||
    typeof r.epoch !== "number" || typeof r.occurred_at !== "string" ||
    typeof r.local_day !== "string" || typeof r.tool !== "string" || !NAME.test(r.tool) ||
    typeof r.family !== "string" || !FAMILIES.has(r.family as ToolFamily | "unknown") ||
    !isToolOutcome(r.outcome) || !isToolFailureKind(r.failure_kind) ||
    typeof r.elapsed_ms !== "number" || !Number.isFinite(r.elapsed_ms) || r.elapsed_ms < 0) return null;
  return {
    id:r.id, deviceId:r.device_id, epoch:r.epoch, occurredAt:r.occurred_at,
    localDay:r.local_day,tool:r.tool,family:r.family as AssistantToolAttempt["family"],
    outcome:r.outcome,failureKind:r.failure_kind,elapsedMs:r.elapsed_ms,
    goalVerified:null,
  };
}

export const assistantToolMetricsApi: AssistantToolMetricsApi = {
  async write(event,userId) {
    await request("rpc/write_assistant_tool_attempt", userId, {
      method:"POST",
      headers:{ "Content-Type":"application/json", Prefer:"return=minimal" },
      body: JSON.stringify({
        p_id:event.id,p_device_id:event.deviceId,p_epoch:event.epoch,
        p_occurred_at:event.occurredAt,p_local_day:event.localDay,p_tool:event.tool,
        p_family:event.family,p_outcome:event.outcome,
        p_failure_kind:event.failureKind,p_elapsed_ms:event.elapsedMs,
      }),
    });
  },
  async list(epoch,userId,fromDay) {
    const rows:AssistantToolAttempt[] = [];
    const selected = "id,device_id,epoch,occurred_at,local_day,tool,family,outcome,failure_kind,elapsed_ms";
    for (let offset=0;offset<20000;offset+=1000) {
      const query = `assistant_tool_attempts?select=${selected}&epoch=eq.${encodeURIComponent(String(epoch))}&local_day=gte.${encodeURIComponent(fromDay)}&order=occurred_at.desc&limit=1000&offset=${offset}`;
      const result = await request(query,userId);
      if (!Array.isArray(result)) throw new Error("Invalid tool metrics response.");
      rows.push(...result.flatMap(e=>{const parsed=parse(e);return parsed?[parsed]:[];}));
      if (result.length<1000) return rows;
    }
    throw new Error("Tool Analytics volume exceeds the current page limit.");
  },
};
