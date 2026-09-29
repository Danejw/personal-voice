import { ASSISTANT_ACCOUNT_LIMIT, ASSISTANT_NOTE_LIMIT } from "@/assistant/accountContext";
import { ASSISTANT_SELECTION_LIMIT } from "@/assistant/selectionContext";

/** Prefix that ordinary handoff text does not use. The JSON after it is version 1. */
export const CONTINUATION_PREFIX = "PV_ASSISTANT_CONTINUATION_V1\n";
export const CONTINUATION_VERSION = 1;
export const CONTINUATION_TURN_LIMIT = 12;
export const CONTINUATION_TURN_CHARS = 2_000;
export const CONTINUATION_PAYLOAD_LIMIT = 24_000;
const TITLE_CHARS = 120;

export interface ContinuationTurn {
  role: "user" | "assistant";
  text: string;
}

export interface ContinuationNote {
  id: string;
  text: string;
  createdAt: string;
}

export interface ContinuationHandoff {
  id: string;
  text: string;
  createdAt: string;
  sourceLabel: string;
}

export interface ContinuationScreen {
  source: "window" | "screen";
  sourceApp: string | null;
  capturedAt: string;
}

/** Application payload. No token, audio, resumption handle, or screenshot pixels. */
export interface AssistantContinuation {
  version: 1;
  title: string;
  turns: ContinuationTurn[];
  selection: { text: string; sourceApp: string | null; capturedAt: string } | null;
  notes: ContinuationNote[];
  handoff: ContinuationHandoff | null;
  screen: ContinuationScreen | null;
  sourceDeviceId: string;
  sourceDeviceName: string;
  createdAt: string;
}

export interface ContinuationDraft {
  turns: readonly { role: "user" | "assistant"; text: string }[];
  selection: { text: string; sourceApp?: string; capturedAt: string } | null;
  notes: readonly ContinuationNote[];
  handoff: ContinuationHandoff | null;
  screen: { source: "window" | "screen"; sourceApp?: string; capturedAt: string } | null;
  sourceDeviceId: string;
  sourceDeviceName: string;
  createdAt: string;
}

export type ClassifiedHandoff =
  | { kind: "text" }
  | { kind: "continuation"; payload: AssistantContinuation }
  | { kind: "malformed"; message: string };

/** Builds a bounded package and the handoff text that carries it. */
export function buildContinuation(
  draft: ContinuationDraft,
): { ok: true; payload: AssistantContinuation; text: string } | { ok: false; message: string } {
  const sourceDeviceId = draft.sourceDeviceId.trim();
  const sourceDeviceName = draft.sourceDeviceName.trim();
  if (!sourceDeviceId || !sourceDeviceName) return { ok: false, message: "This device is not ready to send a continuation." };
  const turns = clipTurns(draft.turns);
  if (!turns.length) return { ok: false, message: "Start a conversation before continuing it on another device." };
  const payload = fitPayload({
    version: CONTINUATION_VERSION,
    title: titleFrom(turns),
    turns,
    selection: clipSelection(draft.selection),
    notes: draft.notes
      .filter((note) => note.text.trim())
      .slice(0, ASSISTANT_NOTE_LIMIT)
      .map((note) => ({
        id: note.id,
        text: clip(note.text.trim(), ASSISTANT_ACCOUNT_LIMIT),
        createdAt: note.createdAt,
      })),
    handoff: draft.handoff
      ? { ...draft.handoff, text: clip(draft.handoff.text, ASSISTANT_ACCOUNT_LIMIT) }
      : null,
    screen: draft.screen
      ? {
          source: draft.screen.source,
          sourceApp: draft.screen.sourceApp?.trim() || null,
          capturedAt: draft.screen.capturedAt,
        }
      : null,
    sourceDeviceId,
    sourceDeviceName,
    createdAt: draft.createdAt,
  });
  if (!payload.turns.length || packed(payload).length > CONTINUATION_PAYLOAD_LIMIT) {
    return { ok: false, message: "That conversation is too large to continue on another device." };
  }
  return { ok: true, payload, text: packed(payload) };
}

/** Plain text stays plain. Only the prefix selects a continuation. */
export function classifyHandoffText(text: string): ClassifiedHandoff {
  if (!text.startsWith(CONTINUATION_PREFIX)) return { kind: "text" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(CONTINUATION_PREFIX.length));
  } catch {
    return { kind: "malformed", message: "This continuation could not be read." };
  }
  return readPayload(parsed);
}

/** The row must be the device that created the package. Account ownership stays on the handoff row. */
export function acceptContinuation(
  payload: AssistantContinuation,
  row: { sourceDeviceId: string },
): { ok: true } | { ok: false; message: string } {
  if (payload.sourceDeviceId !== row.sourceDeviceId) {
    return { ok: false, message: "This continuation was not sent by that device." };
  }
  return { ok: true };
}

/** Title for lists and toasts. Plain handoffs keep their text. */
export function handoffDisplayText(text: string): string {
  const classified = classifyHandoffText(text);
  if (classified.kind === "continuation") return classified.payload.title;
  if (classified.kind === "malformed") return "Assistant continuation could not be read.";
  return text;
}

/** Told to the new session when the other device had a screenshot. The JPEG is not included. */
export function screenOmittedText(screen: ContinuationScreen): string {
  const where = screen.source === "window" ? "the active window" : "the screen";
  const app = screen.sourceApp ? ` (${screen.sourceApp})` : "";
  return `A screenshot of ${where}${app} was attached on the other device at ${screen.capturedAt}. The image was not transferred. This is a new Assistant session. Ask the user to capture the screen again if you need to see it.`;
}

function packed(payload: AssistantContinuation): string {
  return CONTINUATION_PREFIX + JSON.stringify(payload);
}

function clipTurns(turns: readonly { role: "user" | "assistant"; text: string }[]): ContinuationTurn[] {
  return turns
    .filter((turn) => turn.role === "user" || turn.role === "assistant")
    .map((turn) => ({ role: turn.role, text: clip(turn.text.trim(), CONTINUATION_TURN_CHARS) }))
    .filter((turn) => turn.text.length > 0)
    .slice(-CONTINUATION_TURN_LIMIT);
}

function clipSelection(
  selection: ContinuationDraft["selection"],
): AssistantContinuation["selection"] {
  if (!selection?.text.trim()) return null;
  return {
    text: clip(selection.text.trim(), ASSISTANT_SELECTION_LIMIT),
    sourceApp: selection.sourceApp?.trim() || null,
    capturedAt: selection.capturedAt,
  };
}

function titleFrom(turns: readonly ContinuationTurn[]): string {
  const first = turns.find((turn) => turn.role === "user") ?? turns[0];
  return clip(first?.text.replace(/\s+/g, " ").trim() || "Assistant task", TITLE_CHARS);
}

function fitPayload(payload: AssistantContinuation): AssistantContinuation {
  let next = payload;
  while (packed(next).length > CONTINUATION_PAYLOAD_LIMIT) {
    if (next.turns.length > 1) {
      const turns = next.turns.slice(1);
      next = { ...next, turns, title: titleFrom(turns) };
      continue;
    }
    if (next.screen) {
      next = { ...next, screen: null };
      continue;
    }
    if (next.handoff) {
      next = { ...next, handoff: null };
      continue;
    }
    if (next.notes.length) {
      next = { ...next, notes: next.notes.slice(0, -1) };
      continue;
    }
    if (next.selection) {
      next = { ...next, selection: null };
      continue;
    }
    const only = next.turns[0];
    if (only && only.text.length > 80) {
      const turns = [{ ...only, text: only.text.slice(0, Math.floor(only.text.length / 2)) }];
      next = { ...next, turns, title: titleFrom(turns) };
      continue;
    }
    break;
  }
  return next;
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit);
}

function readPayload(parsed: unknown): ClassifiedHandoff {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { kind: "malformed", message: "This continuation could not be read." };
  }
  const record = parsed as Record<string, unknown>;
  const allowed = new Set([
    "version", "title", "turns", "selection", "notes", "handoff", "screen",
    "sourceDeviceId", "sourceDeviceName", "createdAt",
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    return { kind: "malformed", message: "This continuation could not be read." };
  }
  if (typeof record.version !== "number") return { kind: "malformed", message: "This continuation could not be read." };
  if (record.version !== CONTINUATION_VERSION) {
    return { kind: "malformed", message: "This continuation is from a newer Personal Voice and cannot be opened here." };
  }
  if (packedLength(record) > CONTINUATION_PAYLOAD_LIMIT) {
    return { kind: "malformed", message: "This continuation is too large to open." };
  }
  const turns = readTurns(record.turns);
  const selection = readSelection(record.selection);
  const notes = readNotes(record.notes);
  const handoff = readHandoff(record.handoff);
  const screen = readScreen(record.screen);
  if (
    !turns
    || selection === undefined
    || !notes
    || handoff === undefined
    || screen === undefined
    || typeof record.title !== "string"
    || !record.title.trim()
    || typeof record.sourceDeviceId !== "string"
    || !record.sourceDeviceId.trim()
    || typeof record.sourceDeviceName !== "string"
    || !record.sourceDeviceName.trim()
    || typeof record.createdAt !== "string"
    || !record.createdAt.trim()
  ) {
    return { kind: "malformed", message: "This continuation could not be read." };
  }
  return {
    kind: "continuation",
    payload: {
      version: 1,
      title: record.title,
      turns,
      selection,
      notes,
      handoff,
      screen,
      sourceDeviceId: record.sourceDeviceId,
      sourceDeviceName: record.sourceDeviceName,
      createdAt: record.createdAt,
    },
  };
}

function packedLength(record: Record<string, unknown>): number {
  return CONTINUATION_PREFIX.length + JSON.stringify(record).length;
}

function readTurns(value: unknown): ContinuationTurn[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > CONTINUATION_TURN_LIMIT) return null;
  const turns: ContinuationTurn[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const turn = item as Record<string, unknown>;
    if (Object.keys(turn).some((key) => key !== "role" && key !== "text")) return null;
    if ((turn.role !== "user" && turn.role !== "assistant") || typeof turn.text !== "string") return null;
    if (!turn.text.trim() || turn.text.length > CONTINUATION_TURN_CHARS) return null;
    turns.push({ role: turn.role, text: turn.text });
  }
  return turns;
}

function readSelection(value: unknown): AssistantContinuation["selection"] | undefined {
  if (value === null) return null;
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "text" && key !== "sourceApp" && key !== "capturedAt")) return undefined;
  if (typeof record.text !== "string" || !record.text.trim() || record.text.length > ASSISTANT_SELECTION_LIMIT) return undefined;
  if (typeof record.capturedAt !== "string") return undefined;
  if (record.sourceApp !== null && typeof record.sourceApp !== "string") return undefined;
  return { text: record.text, sourceApp: typeof record.sourceApp === "string" ? record.sourceApp : null, capturedAt: record.capturedAt };
}

function readNotes(value: unknown): ContinuationNote[] | null {
  if (!Array.isArray(value) || value.length > ASSISTANT_NOTE_LIMIT) return null;
  const notes: ContinuationNote[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const note = item as Record<string, unknown>;
    if (Object.keys(note).some((key) => key !== "id" && key !== "text" && key !== "createdAt")) return null;
    if (typeof note.id !== "string" || typeof note.text !== "string" || typeof note.createdAt !== "string") return null;
    if (!note.text.trim() || note.text.length > ASSISTANT_ACCOUNT_LIMIT) return null;
    notes.push({ id: note.id, text: note.text, createdAt: note.createdAt });
  }
  return notes;
}

function readHandoff(value: unknown): ContinuationHandoff | null | undefined {
  if (value === null) return null;
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["id", "text", "createdAt", "sourceLabel"].includes(key))) return undefined;
  if (typeof record.id !== "string" || typeof record.text !== "string" || typeof record.createdAt !== "string" || typeof record.sourceLabel !== "string") return undefined;
  if (!record.text.trim() || record.text.length > ASSISTANT_ACCOUNT_LIMIT) return undefined;
  return { id: record.id, text: record.text, createdAt: record.createdAt, sourceLabel: record.sourceLabel };
}

function readScreen(value: unknown): ContinuationScreen | null | undefined {
  if (value === null) return null;
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "source" && key !== "sourceApp" && key !== "capturedAt")) return undefined;
  if (record.source !== "window" && record.source !== "screen") return undefined;
  if (typeof record.capturedAt !== "string") return undefined;
  if (record.sourceApp !== null && typeof record.sourceApp !== "string") return undefined;
  return {
    source: record.source,
    sourceApp: typeof record.sourceApp === "string" ? record.sourceApp : null,
    capturedAt: record.capturedAt,
  };
}
