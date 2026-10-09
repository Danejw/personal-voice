/**
 * Gemini 3.8 Live wire format for typed Assistant turns.
 * Verified against:
 * https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live
 * https://ai.google.dev/api/live
 * https://ai.google.dev/gemini-api/docs/live-api/capabilities
 * (docs updated 2026-09-15).
 *
 * The websocket setup is the proto `BidiGenerateContentSetup`. Audio output
 * belongs in `generationConfig.responseModalities`. The get-started guide
 * shows that field on `setup` itself; the server rejects that name with 1007.
 *
 * A completed typed turn uses `clientContent` with `turnComplete: true`.
 * On this model that starts a reply for the whole session. `realtimeInput.text`
 * does not mark the end of a typed turn.
 *
 * Function calls use the Live tools guide (2026-09-15). Declarations omit
 * `behavior`, so the call stays synchronous and the model waits for `toolResponse`.
 */

import { ASSISTANT_SEARCH_GUIDANCE, sourcesFromGrounding, type AssistantSource } from "@/assistant/grounding";
import { assistantFunctionDeclarations, parseToolCallList, type ParsedToolCall } from "@/assistant/tools";
import { ASSISTANT_TOOL_SELECTION_GUIDANCE } from "@/assistant/harness/toolIntelligence";
import { ASSISTANT_PLAYBOOK_GUIDANCE } from "@/assistant/harness/playbooks";
import { ASSISTANT_RESULT_GUIDANCE, type ToolResultAssessment } from "@/assistant/harness/toolResults";

export const ASSISTANT_MODEL = "gemini-3.8-live";
/** Microphone audio sent to Live: little-endian PCM16 mono. Capture already emits this at 16 kHz. */
export const ASSISTANT_INPUT_RATE = 16_000;
export const ASSISTANT_INPUT_MIME = "audio/pcm;rate=16000";
/** Model audio is raw little-endian PCM16 mono. */
export const ASSISTANT_PCM_RATE = 24_000;
/** Same constrained v1alpha path as dictation; ephemeral tokens close with 1011 on v1beta here. */
export const ASSISTANT_ENDPOINT =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

/**
 * First Live message. Automatic voice activity detection stays at the API default.
 * Input and output audio are both transcribed.
 */
export function assistantSetupMessage(
  resumeHandle?: string | null,
  options?: { search?: boolean },
) {
  const search = options?.search !== false;
  return {
    setup: {
      model: `models/${ASSISTANT_MODEL}`,
      generationConfig: { responseModalities: ["AUDIO"] },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      // Default sliding window. Without it, audio sessions end around 15 minutes.
      contextWindowCompression: { slidingWindow: {} },
      // Empty handle starts a session. A later handle resumes it. Kept in memory only.
      sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
      // Client setup, not the token lock. Synchronous: no NON_BLOCKING behavior.
      // Search is available for public information. The model chooses when to use it.
      tools: [
        { functionDeclarations: assistantFunctionDeclarations() },
        ...(search ? [{ googleSearch: {} }] : []),
      ],
      systemInstruction: { parts: [{ text: `${ASSISTANT_SEARCH_GUIDANCE}\n\n${ASSISTANT_TOOL_SELECTION_GUIDANCE}\n\n${ASSISTANT_PLAYBOOK_GUIDANCE}\n\n${ASSISTANT_RESULT_GUIDANCE}` }] },
    },
  };
}

/** One still screenshot. Live accepts it as a single JPEG video frame, not a stream. */
export function assistantSnapshotFrame(jpegBase64: string) {
  return {
    realtimeInput: {
      video: { data: jpegBase64, mimeType: "image/jpeg" },
    },
  };
}

/** One microphone chunk. `pcm` is already base64 PCM16 at 16 kHz. */
export function assistantAudioChunk(base64: string) {
  return {
    realtimeInput: {
      audio: { data: base64, mimeType: ASSISTANT_INPUT_MIME },
    },
  };
}

/** One finished user turn. Selection, notes, and personal context stay separate from the instruction. */
export function assistantUserTurn(
  text: string,
  selectionText?: string | null,
  accountText?: string | null,
  personalText?: string | null,
  toolGuidance?: string | null,
) {
  const parts = [
    ...(selectionText ? [{ text: selectionText }] : []),
    ...(accountText ? [{ text: accountText }] : []),
    ...(personalText ? [{ text: personalText }] : []),
    ...(toolGuidance ? [{ text: toolGuidance }] : []),
    { text },
  ];
  return {
    clientContent: {
      turns: [{ role: "user", parts }],
      turnComplete: true,
    },
  };
}

/** Returns a real result. `ok` false uses `error` and does not include `result`. */
export function assistantToolResponse(items: { id: string; name: string; ok: boolean; message: string; interpretation?: ToolResultAssessment }[]) {
  return {
    toolResponse: {
      functionResponses: items.map((item) => ({
        id: item.id,
        name: item.name,
        response: {
          ...(item.ok ? { result: item.message } : { error: item.message }),
          ...(item.interpretation ? { interpretation: item.interpretation } : {}),
        },
      })),
    },
  };
}

/**
 * Prior turns for a new Live session. `turnComplete` stays false so Gemini does not reply yet.
 * This is not a resumed socket.
 */
export function assistantHistorySeed(turns: { role: "user" | "model"; text: string }[]) {
  return {
    clientContent: {
      turns: turns.map((turn) => ({ role: turn.role, parts: [{ text: turn.text }] })),
      turnComplete: false,
    },
  };
}

/** Adds context without asking Gemini to reply. Used for attach and detach. */
export function assistantContextNote(text: string) {
  return {
    clientContent: {
      turns: [{ role: "user", parts: [{ text }] }],
      turnComplete: false,
    },
  };
}

export type AssistantWireEvent =
  | { type: "setupComplete" }
  | { type: "audio"; base64: string }
  | { type: "inputTranscription"; text: string; partial: boolean }
  | { type: "outputTranscription"; text: string }
  | { type: "turnComplete" }
  | { type: "interrupted" }
  | { type: "goAway" }
  | { type: "resumption"; handle: string }
  | { type: "toolCalls"; calls: ParsedToolCall[] }
  | { type: "grounding"; sources: AssistantSource[] }
  | { type: "refused"; message: string };

/**
 * Keeps the newest handle that can actually resume. A non-resumable update
 * leaves the previous handle in place. Handles are not stored on disk.
 */
export function nextResumeHandle(
  current: string | null,
  update: { resumable?: unknown; newHandle?: unknown },
): string | null {
  if (update.resumable !== true || typeof update.newHandle !== "string" || !update.newHandle) return current;
  return update.newHandle;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function isOutputPcm(mime: unknown): boolean {
  if (typeof mime !== "string" || !mime) return true;
  return mime.startsWith("audio/pcm") || mime.startsWith("audio/l16");
}

/**
 * Normalizes one server JSON message into ordered application events.
 * Transcription is emitted before `turnComplete` when both arrive together,
 * so the readable reply is not dropped. A tool call becomes `toolCalls` and does not
 * close the session. A call list that is not an array is ignored.
 */
export function parseAssistantServerMessage(raw: unknown): AssistantWireEvent[] {
  const message = record(raw);
  if (message.setupComplete) return [{ type: "setupComplete" }];
  if (message.toolCall) {
    const calls = parseToolCallList(message.toolCall);
    return calls && calls.length > 0 ? [{ type: "toolCalls", calls }] : [];
  }
  if (message.error) {
    const detail = record(message.error).message;
    return [{ type: "refused", message: typeof detail === "string" ? detail : "Assistant refused the session." }];
  }
  const prelude: AssistantWireEvent[] = [];
  if (message.sessionResumptionUpdate) {
    const handle = nextResumeHandle(null, record(message.sessionResumptionUpdate));
    if (handle) prelude.push({ type: "resumption", handle });
  }
  if (message.goAway) prelude.push({ type: "goAway" });
  if (!message.serverContent) return prelude;
  const content = record(message.serverContent);
  const events: AssistantWireEvent[] = [];
  const interim = record(content.interimInputTranscription).text;
  if (typeof interim === "string" && interim) events.push({ type: "inputTranscription", text: interim, partial: true });
  const spoken = record(content.inputTranscription).text;
  if (typeof spoken === "string" && spoken) events.push({ type: "inputTranscription", text: spoken, partial: false });
  const parts = record(content.modelTurn).parts;
  if (Array.isArray(parts)) {
    for (const part of parts) {
      const inline = record(record(part).inlineData);
      if (typeof inline.data !== "string" || !inline.data || !isOutputPcm(inline.mimeType)) continue;
      events.push({ type: "audio", base64: inline.data });
    }
  }
  const transcript = record(content.outputTranscription).text;
  if (typeof transcript === "string" && transcript) {
    events.push({ type: "outputTranscription", text: transcript });
  }
  const sources = sourcesFromGrounding(content.groundingMetadata);
  if (sources.length) events.push({ type: "grounding", sources });
  if (content.interrupted === true) events.push({ type: "interrupted" });
  if (content.turnComplete === true) events.push({ type: "turnComplete" });
  return [...prelude, ...events];
}

/** Encodes bytes the way the Live socket expects `inline` audio. */
export function encodeBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let index = 0; index < view.length; index += 0x8000) {
    binary += String.fromCharCode(...view.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

/** Decodes a standard base64 payload. Throws on malformed input. */
export function decodeBase64(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Appends `incoming` after any odd leftover byte and splits off whole PCM16 samples.
 * The returned `carry` is either empty or the one trailing byte.
 */
export function takePcm16(
  incoming: Uint8Array<ArrayBuffer>,
  carry: Uint8Array<ArrayBuffer>,
): { pcm: Uint8Array<ArrayBuffer>; carry: Uint8Array<ArrayBuffer> } {
  const combined = new Uint8Array(carry.length + incoming.length);
  combined.set(carry, 0);
  combined.set(incoming, carry.length);
  const even = combined.length - (combined.length % 2);
  const pcm = new Uint8Array(even);
  pcm.set(combined.subarray(0, even));
  const nextCarry = new Uint8Array(combined.length - even);
  nextCarry.set(combined.subarray(even));
  return { pcm, carry: nextCarry };
}

/** Google API keys and ephemeral tokens must never reach the UI. */
export function redactSecrets(text: string): string {
  return text.replace(/AIza[0-9A-Za-z_-]{20,}|auth_tokens\/[0-9A-Za-z_-]+/g, "[redacted]").slice(0, 200);
}
