import { getSupabase, supabaseConfig } from "@/services/supabase";
import { textActionInputProblem } from "@/text/modelOutput";
import type { TextAction, TextActionInput } from "@/text/TextAction";

const FUNCTION_NAME = "text-action";

/** Maps the `text-action` Edge Function response to rewritten text or a user-facing error. */
export function parseTextActionResponse(status: number, body: unknown): string {
  const fields = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  if (status < 200 || status >= 300) {
    const message = typeof fields.error === "string" && fields.error
      ? fields.error
      : `Couldn't transform the text (error ${status}). Try again.`;
    throw new Error(message);
  }
  if (typeof fields.text !== "string" || !fields.text.trim()) throw new Error("The rewrite was empty.");
  return fields.text.trim();
}

/** Sends source text and a transform instruction to the signed-in text-action function. */
export async function requestTextAction(input: TextActionInput, signal: AbortSignal): Promise<string> {
  const problem = textActionInputProblem(input.selection, input.instruction);
  if (problem) throw new Error(problem);
  const client = getSupabase();
  if (!client || !supabaseConfig) throw new Error("This build has no sign-in configuration.");
  const { data } = await client.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("Sign in to transform text.");

  let response: Response;
  try {
    response = await fetch(`${supabaseConfig.url}/functions/v1/${FUNCTION_NAME}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: supabaseConfig.publishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ selection: input.selection, instruction: input.instruction }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error("Couldn't connect to transform the text. Check your internet connection and try again.", { cause: error });
  }
  return parseTextActionResponse(response.status, await response.json().catch(() => null));
}

/** Gemini text rewrite behind the provider-neutral `TextAction` boundary. */
export const geminiTextAction: TextAction = {
  transform: requestTextAction,
};
