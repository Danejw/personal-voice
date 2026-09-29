import type { AssistantSource } from "@/assistant/grounding";
import type { ParsedToolCall } from "@/assistant/tools";

/** Application events from one Assistant Live session. Raw Gemini JSON never crosses this type. */
export type AssistantEvent =
  | { type: "ready" }
  | { type: "audio"; pcm: ArrayBuffer }
  | { type: "inputTranscription"; text: string; partial: boolean }
  | { type: "outputTranscription"; text: string }
  | { type: "turnComplete" }
  | { type: "interrupted" }
  | { type: "goAway" }
  | { type: "disconnected" }
  | { type: "resumption"; handle: string }
  | { type: "toolCalls"; calls: ParsedToolCall[] }
  | { type: "grounding"; sources: AssistantSource[] }
  | { type: "notice"; message: string }
  | { type: "error"; message: string; retryable: boolean };
