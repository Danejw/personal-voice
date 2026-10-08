import { getSupabase } from "@/services/supabase";
import { parseGraphSnapshot, type GraphSnapshot } from "@/memory-graph/graph";

/** Fetches only current-account nodes and edges through a consent-filtered RPC. */
export async function loadMemoryGraph(userId: string): Promise<GraphSnapshot> {
  const client = getSupabase();
  if (!client) throw new Error("Memory graph requires a connected account.");
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user || user.id !== userId) throw new Error("Sign in to view your memory graph.");
  const { data, error } = await client.rpc("get_assistant_memory_graph", {
    p_user_id: userId, p_limit: 180,
  });
  if (error) throw new Error(
    error.code === "PGRST202"
      ? "The Memory Graph migration is not deployed yet."
      : "Could not load your memory graph. Check the database migration and connection.",
  );
  return parseGraphSnapshot(data);
}
