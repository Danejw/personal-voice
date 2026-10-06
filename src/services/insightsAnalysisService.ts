import { getSupabase, supabaseConfig } from "@/services/supabase";
import {
  parseChunkInsight,
  parseFinalInsight,
  type ChunkInsightOutput,
  type FinalInsightOutput,
} from "@/insights/insightsModel";

const FUNCTION_NAME = "dictation-insights";

async function request(mode: "chunk" | "merge", input: string, signal?: AbortSignal): Promise<unknown> {
  const client = getSupabase();
  if (!client || !supabaseConfig) throw new Error("This build has no sign-in configuration.");
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in to analyze Insights.");

  let response: Response;
  try {
    response = await fetch(`${supabaseConfig.url}/functions/v1/${FUNCTION_NAME}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseConfig.publishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode, input }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("Couldn't connect to the Insights service. Check your internet connection and try again.", { cause: error });
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).error === "string"
      ? String((body as Record<string, unknown>).error)
      : `Insights analysis failed (error ${response.status}).`;
    throw new Error(message);
  }
  return body;
}

export interface InsightsAnalyzer {
  analyzeChunk(text: string, signal?: AbortSignal): Promise<ChunkInsightOutput>;
  merge(input: string, signal?: AbortSignal): Promise<FinalInsightOutput>;
}

export const insightsAnalyzer: InsightsAnalyzer = {
  async analyzeChunk(text, signal) {
    return parseChunkInsight(await request("chunk", text, signal));
  },
  async merge(input, signal) {
    return parseFinalInsight(await request("merge", input, signal));
  },
};
