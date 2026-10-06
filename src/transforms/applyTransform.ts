import { geminiTextAction } from "@/services/textActionService";
import type { TextAction } from "@/text/TextAction";
import type { TransformProfile } from "@/transforms/transformProfile";

const TRANSFORM_TIMEOUT_MS = 25_000;

/** Applies one saved profile through the existing provider-neutral text rewrite boundary. */
export async function applyTransform(
  text: string,
  profile: TransformProfile,
  action: TextAction = geminiTextAction,
): Promise<string> {
  const source = text.trim();
  if (!source) throw new Error("There is no text to transform.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRANSFORM_TIMEOUT_MS);
  try {
    return await action.transform({
      selection: source,
      instruction: profile.instruction,
    }, controller.signal);
  } catch (reason) {
    if (controller.signal.aborted) throw new Error("The transform timed out. Try again.", { cause: reason });
    throw reason;
  } finally {
    clearTimeout(timeout);
  }
}
