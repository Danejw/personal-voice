import { getSupabase, supabaseConfig } from "@/services/supabase";

const FUNCTION_NAME = "memory-learn";

/**
 * Asks the memory-learn function to read this account's eligible Assistant lines.
 * Returns true only when that function already committed. A missing function returns false
 * so the device can commit the same batch itself. Message text is not sent from here.
 */
export async function requestMemoryLearn(): Promise<boolean> {
  const client = getSupabase();
  if (!client || !supabaseConfig) return false;
  const { data } = await client.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) return false;
  try {
    const response = await fetch(`${supabaseConfig.url}/functions/v1/${FUNCTION_NAME}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: supabaseConfig.publishableKey,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(25_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
