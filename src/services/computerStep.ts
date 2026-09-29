import { getSupabase, supabaseConfig } from "@/services/supabase";

const FUNCTION_NAME = "computer-step";

/**
 * One Interactions request for the supervised Computer Use worker.
 * The edge function owns the API key and sets the desktop tool itself.
 */
export async function proposeComputerStep(body: Record<string, unknown>): Promise<unknown> {
  const client = getSupabase();
  if (!client || !supabaseConfig) throw new Error("This build has no sign-in configuration.");
  const { data } = await client.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("Sign in to use a supervised screen task.");
  let response: Response;
  try {
    response = await fetch(`${supabaseConfig.url}/functions/v1/${FUNCTION_NAME}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: supabaseConfig.publishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't reach Computer Use. Check your internet connection and try again.");
  }
  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  if (!response.ok) {
    const message = payload && typeof payload.error === "string" ? payload.error : "Computer Use could not be reached.";
    throw new Error(message);
  }
  return payload;
}
