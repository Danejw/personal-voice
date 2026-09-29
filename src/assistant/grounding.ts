/**
 * Google Search grounding for Assistant only.
 * Live setup uses `googleSearch: {}` on the session tools list
 * (https://ai.google.dev/gemini-api/docs/live-api/tools, 2026-09-15).
 * Citations arrive as `serverContent.groundingMetadata`
 * (https://ai.google.dev/api/live and GroundingMetadata on
 * https://ai.google.dev/api/generate-content).
 * The Interactions API `{"type":"google_search"}` shape is a different endpoint.
 *
 * Search is available, not required. The model decides when public information
 * is needed. Ordinary conversation is not marked as sourced.
 */

export const ASSISTANT_SOURCE_LIMIT = 8;

/** Tells the model when Search is appropriate. It does not force a search. */
export const ASSISTANT_SEARCH_GUIDANCE =
  "Google Search is available for changing public information. Do not search for ordinary conversation, arithmetic, or other questions you can answer directly. Do not include attached selections, voice notes, screenshots, or other private text in a search unless the user explicitly asks you to look up that public information. Another device's screen is private: call read_remote_device and answer from its result. Do not guess what is open there. Personal context, when a later note provides it, is the only source for this user's dictation habits. Do not invent shares, triggers, apps, dictionary terms, or pace. Voice notes: list_voice_notes reads them, create_voice_note saves one, archive_voice_note archives one, restore_voice_note puts one back, delete_voice_note deletes one. Handoffs: list_handoffs reads received handoffs and device names, send_handoff sends text, dismiss_handoff removes a received handoff. Highlighted text: capture_selection reads it and attaches it. Call these tools as soon as the user asks. Do not ask them to click or confirm first. Do not say they are unavailable. Auto mode runs the action. Review mode confirms it in the app. When the user asks to look at, see, or check the screen, or to look again, call capture_screen. Do not tell them to press a button. Do not describe a screen that was not captured. A screenshot is one still image until capture_screen is called again. Desktop changes use open_app, press_shortcut, or supervise_screen. supervise_screen is a separate Computer Use model. Do not claim you moved the mouse yourself. Never request a shell, a delete, an install, or a purchase.";

/** Shown when Search quota closes the socket and the session continues without it. */
export const ASSISTANT_SEARCH_UNAVAILABLE =
  "Google Search is over its quota, so Assistant is continuing without it.";

export interface AssistantSource {
  title: string;
  url: string;
}

/** Web citations only. HTML search widgets and other raw fields are dropped. */
export function sourcesFromGrounding(metadata: unknown): AssistantSource[] {
  if (typeof metadata !== "object" || metadata === null) return [];
  const chunks = (metadata as { groundingChunks?: unknown }).groundingChunks;
  if (!Array.isArray(chunks)) return [];
  const sources: AssistantSource[] = [];
  for (const chunk of chunks) {
    const source = sourceFromChunk(chunk);
    if (!source || sources.some((item) => item.url === source.url)) continue;
    sources.push(source);
    if (sources.length >= ASSISTANT_SOURCE_LIMIT) break;
  }
  return sources;
}

function sourceFromChunk(chunk: unknown): AssistantSource | null {
  if (typeof chunk !== "object" || chunk === null) return null;
  const web = (chunk as { web?: unknown }).web;
  if (typeof web !== "object" || web === null) return null;
  const uri = (web as { uri?: unknown }).uri;
  if (typeof uri !== "string" || !uri) return null;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const rawTitle = (web as { title?: unknown }).title;
  const title = typeof rawTitle === "string" ? rawTitle.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  return { title: title || url.hostname, url: url.toString() };
}
