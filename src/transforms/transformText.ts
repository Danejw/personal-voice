import type { TextAction } from "@/text/TextAction";
import type { TransformProfile } from "@/transforms/transformProfile";

export async function transformText(
  action: TextAction,
  text: string,
  profile: TransformProfile,
  signal: AbortSignal = new AbortController().signal,
): Promise<string> {
  return action.transform({ selection: text, instruction: profile.instruction }, signal);
}
