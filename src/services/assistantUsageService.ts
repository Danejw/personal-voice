import { getSupabase, supabaseConfig } from "@/services/supabase";
import type { AssistantUsageEvent } from "@/usage/assistantUsage";

export interface AssistantUsageApi {
  write(event: AssistantUsageEvent): Promise<void>;
  list(epoch: number): Promise<AssistantUsageEvent[]>;
}
type Row = Record<string, unknown>;

async function call(path: string, init?: RequestInit): Promise<unknown> {
  if (!supabaseConfig) throw new Error("Assistant Analytics is not configured.");
  const client = getSupabase();
  if (!client) throw new Error("Assistant Analytics requires sign in.");
  const { data: { session } } = await client.auth.getSession();
  if (!session?.access_token) throw new Error("Assistant Analytics requires sign in.");
  const response = await fetch(`${supabaseConfig.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: supabaseConfig.publishableKey,
      Authorization: `Bearer ${session.access_token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`Assistant Analytics request failed (${response.status}).`);
  if (response.status === 204 || !response.headers.get("content-type")?.includes("json")) return null;
  return response.json() as Promise<unknown>;
}

function parse(row: Row): AssistantUsageEvent | null {
  if (typeof row.id !== "string" || typeof row.device_id !== "string" ||
      typeof row.session_id !== "string" || typeof row.occurred_at !== "string" ||
      typeof row.local_day !== "string" || typeof row.kind !== "string" ||
      typeof row.epoch !== "number") return null;
  if (!["session_started","user_turn","assistant_turn","active_interval","session_ended"].includes(row.kind)) return null;
  return {
    id: row.id, deviceId: row.device_id, sessionId: row.session_id,
    conversationId: typeof row.conversation_id === "string" ? row.conversation_id : null,
    occurredAt: row.occurred_at, localDay: row.local_day, epoch: row.epoch,
    kind: row.kind as AssistantUsageEvent["kind"],
    modality: row.modality === "voice" || row.modality === "typed" || row.modality === "unknown" ? row.modality : null,
    durationMs: typeof row.duration_ms === "number" ? row.duration_ms : null,
    endReason: row.end_reason === "explicit" || row.end_reason === "signout" ||
      row.end_reason === "idle" || row.end_reason === "error" ? row.end_reason : null,
  };
}

export const assistantUsageApi: AssistantUsageApi = {
  async write(event) {
    await call("rpc/write_assistant_usage_event", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        p_id: event.id, p_device_id: event.deviceId, p_session_id: event.sessionId,
        p_conversation_id: event.conversationId, p_occurred_at: event.occurredAt,
        p_local_day: event.localDay, p_epoch: event.epoch, p_kind: event.kind,
        p_modality: event.modality, p_duration_ms: event.durationMs,
        p_end_reason: event.endReason,
      }),
    });
  },
  async list(epoch) {
    // At most 12 months of metadata retained in the dashboard; page rather than silently truncate.
    const rows: AssistantUsageEvent[] = [];
    const selected = "id,device_id,session_id,conversation_id,occurred_at,local_day,epoch,kind,modality,duration_ms,end_reason";
    for (let offset = 0; offset < 20_000; offset += 1000) {
      const query = `assistant_usage_events?select=${selected}&epoch=eq.${encodeURIComponent(String(epoch))}&order=occurred_at.desc&limit=1000&offset=${offset}`;
      const response = await call(query);
      if (!Array.isArray(response)) throw new Error("Invalid Assistant Analytics response.");
      const page = response.flatMap((raw: unknown) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
        const event = parse(raw as Row);
        return event ? [event] : [];
      });
      rows.push(...page);
      if (response.length < 1000) return rows;
    }
    throw new Error("Assistant Analytics history exceeds the current page limit.");
  },
};
