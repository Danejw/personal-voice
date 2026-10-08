import type { ContextItem } from "@/context/ContextItem";
import type { AttachedHandoff, AttachedNote } from "@/assistant/accountContext";
import type { CameraPhoto } from "@/assistant/cameraPhoto";
import type { AssistantSource } from "@/assistant/grounding";
import type { ScreenSnapshot } from "@/assistant/snapshot";
import type { CameraFacing } from "@/platform/camera";

export type AssistantStatus = "IDLE" | "CONNECTING" | "READY" | "RESPONDING" | "ERROR";

export interface AssistantTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Omitted on a finished turn. Set when speech stopped before the turn finished. */
  status?: "interrupted";
  /** Present only when this reply was actually grounded. */
  sources?: AssistantSource[];
}

export interface AssistantSnapshot {
  status: AssistantStatus;
  turns: AssistantTurn[];
  /** In-progress user speech. Replaced by each interim transcript. */
  liveUser: string;
  /** Output transcription for the reply that is still being spoken. */
  liveText: string;
  /** Citations for the reply that is still being spoken. */
  liveSources: AssistantSource[];
  error: string | null;
  /** True while a dropped Live socket is being resumed. */
  resuming: boolean;
  /** Explicit highlight attached to Assistant. Null after remove or End. */
  selection: ContextItem | null;
  selectionError: string | null;
  /** An action waiting for Confirm or Cancel. The full text stays on the controller. */
  pendingAction: PendingAssistantAction | null;
  /** In-flight local tool call for nonintrusive desktop progress. */
  toolActivity: { id: string; title: string } | null;
  /** Shown after a clipboard copy, which does not ask for confirmation. */
  actionNotice: string | null;
  /** One explicit screenshot. Null after Remove or End. Not written to disk. */
  screen: ScreenSnapshot | null;
  screenError: string | null;
  /** One explicit camera still. Null after Remove or End. Not written to disk. */
  cameraPhoto: CameraPhoto | null;
  cameraPhotoError: string | null;
  /** Live Camera Context. Frames are not stored; only the active facing is. */
  cameraContextActive: boolean;
  cameraContextFacing: CameraFacing | null;
  cameraContextError: string | null;
  /** Voice notes the user attached for this session. Not a copy of the account. */
  notes: AttachedNote[];
  /** The one handoff the user attached for this session. */
  handoff: AttachedHandoff | null;
  accountError: string | null;
  /** Device name when this session was opened from a continuation. Not a resumed socket. */
  continuedFrom: string | null;
  /** A supervised screen task is in progress. Stop ends it before the next step. */
  computerRunning: boolean;
  /** Set when Computer Use asks the user to confirm one step. */
  computerPrompt: string | null;
  /** Unique approval id; prevents stale popup clicks from approving another step. */
  computerApprovalId: string | null;
  /** The phone could not enable echo cancellation, so the microphone pauses during playback. */
  echoFallback: boolean;
  /** Microphone audio is being withheld until playback and its echo tail finish. */
  playbackHeld: boolean;
}

export interface PendingAssistantAction {
  id: string;
  title: string;
  preview: string;
  working: boolean;
}

export type AssistantAction =
  | { type: "start" }
  | { type: "ready" }
  | { type: "blocked"; message: string }
  | { type: "send"; id: string; text: string }
  | { type: "userPartial"; text: string }
  | { type: "userFinal"; id: string; text: string; spokenId?: string }
  | { type: "assistantSpeaking" }
  | { type: "output"; text: string }
  | { type: "grounding"; sources: AssistantSource[] }
  | { type: "interrupt"; id: string }
  | { type: "turnComplete"; id: string }
  | { type: "reconnect"; id: string }
  | { type: "fail"; message: string; user?: { id: string; text: string }; assistant?: { id: string; text: string } }
  | { type: "end"; user?: { id: string; text: string }; assistant?: { id: string; text: string } }
  | { type: "replaceTurns"; turns: AssistantTurn[] }
  | { type: "attachSelection"; item: ContextItem }
  | { type: "detachSelection" }
  | { type: "selectionError"; message: string }
  | { type: "setPending"; pending: PendingAssistantAction }
  | { type: "toolActivity"; activity: { id: string; title: string } | null }
  | { type: "computer"; running: boolean; prompt: string | null; approvalId?: string }
  | { type: "clearPending" }
  | { type: "actionNotice"; message: string | null }
  | { type: "attachScreen"; screen: ScreenSnapshot }
  | { type: "detachScreen" }
  | { type: "screenError"; message: string }
  | { type: "attachCameraPhoto"; photo: CameraPhoto }
  | { type: "detachCameraPhoto" }
  | { type: "cameraPhotoError"; message: string }
  | { type: "cameraContext"; active: boolean; facing: CameraFacing | null }
  | { type: "cameraContextError"; message: string | null }
  | { type: "attachNote"; note: AttachedNote }
  | { type: "detachNote"; id: string }
  | { type: "attachHandoff"; handoff: AttachedHandoff }
  | { type: "detachHandoff" }
  | { type: "clearAccount" }
  | { type: "accountError"; message: string }
  | { type: "seed"; turns: AssistantTurn[]; from: string }
  | { type: "echo"; fallback: boolean; held: boolean };

export const initialAssistantState: AssistantSnapshot = {
  status: "IDLE",
  turns: [],
  liveUser: "",
  liveText: "",
  liveSources: [],
  error: null,
  resuming: false,
  selection: null,
  selectionError: null,
  pendingAction: null,
  toolActivity: null,
  actionNotice: null,
  screen: null,
  screenError: null,
  cameraPhoto: null,
  cameraPhotoError: null,
  cameraContextActive: false,
  cameraContextFacing: null,
  cameraContextError: null,
  notes: [],
  handoff: null,
  accountError: null,
  continuedFrom: null,
  computerRunning: false,
  computerPrompt: null,
  computerApprovalId: null,
  echoFallback: false,
  playbackHeld: false,
};

/**
 * Joins output-transcription pieces.
 * A chunk that already contains the text so far replaces it. Anything else is appended.
 */
export function mergeTranscript(current: string, next: string): string {
  if (!next) return current;
  if (!current || next.startsWith(current)) return next;
  return current + next;
}

/** Explicit Assistant lifecycle. Late actions that do not match the current status are ignored. */
export function assistantReducer(state: AssistantSnapshot, action: AssistantAction): AssistantSnapshot {
  switch (action.type) {
    case "start":
      if (state.status === "CONNECTING" || state.status === "READY" || state.status === "RESPONDING") return state;
      return {
        ...state,
        status: "CONNECTING",
        liveUser: "",
        liveText: "",
        liveSources: [],
        error: null,
        resuming: false,
        pendingAction: null,
        toolActivity: null,
        actionNotice: null,
        echoFallback: false,
        playbackHeld: false,
      };
    case "ready":
      if (state.status !== "CONNECTING") return state;
      return { ...state, status: "READY", error: null, resuming: false };
    case "blocked":
      if (state.status !== "IDLE" && state.status !== "ERROR") return state;
      return { ...state, status: "ERROR", error: action.message, liveUser: "", liveText: "", liveSources: [], resuming: false, echoFallback: false, playbackHeld: false };
    case "send":
      if (state.status !== "READY") return state;
      return {
        ...state,
        status: "RESPONDING",
        liveUser: "",
        liveText: "",
        liveSources: [],
        turns: [...state.turns, { id: action.id, role: "user", text: action.text }],
      };
    case "userPartial":
      if (state.status !== "READY" && state.status !== "RESPONDING") return state;
      return { ...state, liveUser: action.text };
    case "userFinal": {
      if ((state.status !== "READY" && state.status !== "RESPONDING") || !action.text.trim()) return state;
      const spoken = state.status === "RESPONDING" ? replyTurn(state, action.spokenId ?? `${action.id}-spoken`, "interrupted") : null;
      return {
        ...state,
        status: "RESPONDING",
        liveUser: "",
        liveText: "",
        liveSources: [],
        turns: [
          ...state.turns,
          ...(spoken ? [spoken] : []),
          { id: action.id, role: "user" as const, text: action.text },
        ],
      };
    }
    case "assistantSpeaking":
      if (state.status !== "READY") return state;
      return { ...state, status: "RESPONDING" };
    case "output":
      if (state.status === "READY") return { ...state, status: "RESPONDING", liveText: action.text };
      if (state.status !== "RESPONDING") return state;
      return { ...state, liveText: mergeTranscript(state.liveText, action.text) };
    case "grounding":
      if (state.status !== "READY" && state.status !== "RESPONDING") return state;
      if (state.status === "READY") return attachSources(state, action.sources);
      return { ...state, liveSources: mergeSources(state.liveSources, action.sources) };
    case "interrupt": {
      if (state.status !== "RESPONDING") return state;
      const interrupted = replyTurn(state, action.id, "interrupted");
      return {
        ...state,
        status: "READY",
        liveText: "",
        liveSources: [],
        turns: interrupted ? [...state.turns, interrupted] : state.turns,
      };
    }
    case "turnComplete": {
      if (state.status !== "RESPONDING") return state;
      const finished = replyTurn(state, action.id);
      return {
        ...state,
        status: "READY",
        liveText: "",
        liveSources: [],
        turns: finished ? [...state.turns, finished] : state.turns,
      };
    }
    case "reconnect": {
      if (state.status === "IDLE" || state.status === "ERROR") return state;
      const resumed = replyTurn(state, action.id, "interrupted");
      return {
        ...state,
        status: "CONNECTING",
        resuming: true,
        liveText: "",
        liveSources: [],
        error: null,
        pendingAction: null,
        turns: resumed ? [...state.turns, resumed] : state.turns,
      };
    }
    case "fail":
      if (state.status === "IDLE") return state;
      return {
        ...state,
        status: "ERROR",
        error: action.message,
        turns: [...state.turns, ...sealedTurns(state, action)],
        liveUser: "",
        liveText: "",
        liveSources: [],
        resuming: false,
        pendingAction: null,
        toolActivity: null,
        actionNotice: null,
        echoFallback: false,
        playbackHeld: false,
      };
    case "end":
      if (state.status === "IDLE") return state;
      return {
        ...state,
        status: "IDLE",
        turns: [...state.turns, ...sealedTurns(state, action)],
        liveUser: "",
        liveText: "",
        liveSources: [],
        error: null,
        resuming: false,
        selection: null,
        selectionError: null,
        pendingAction: null,
        toolActivity: null,
        actionNotice: null,
        screen: null,
        screenError: null,
        cameraPhoto: null,
        cameraPhotoError: null,
        cameraContextActive: false,
        cameraContextFacing: null,
        cameraContextError: null,
        notes: [],
        handoff: null,
        accountError: null,
        continuedFrom: null,
        computerRunning: false,
        computerPrompt: null,
        computerApprovalId: null,
        echoFallback: false,
        playbackHeld: false,
      };
    case "attachSelection":
      return { ...state, selection: action.item, selectionError: null };
    case "detachSelection":
      return { ...state, selection: null, selectionError: null };
    case "selectionError":
      return { ...state, selectionError: action.message };
    case "toolActivity":
      return { ...state, toolActivity: action.activity };
    case "setPending":
      return { ...state, pendingAction: action.pending, actionNotice: null };
    case "clearPending":
      return { ...state, pendingAction: null };
    case "computer":
      return { ...state, computerRunning: action.running, computerPrompt: action.prompt, computerApprovalId: action.approvalId ?? null };
    case "actionNotice":
      return { ...state, actionNotice: action.message };
    case "attachScreen":
      return { ...state, screen: action.screen, screenError: null };
    case "detachScreen":
      return { ...state, screen: null, screenError: null };
    case "screenError":
      return { ...state, screenError: action.message };
    case "attachCameraPhoto":
      return { ...state, cameraPhoto: action.photo, cameraPhotoError: null };
    case "detachCameraPhoto":
      return { ...state, cameraPhoto: null, cameraPhotoError: null };
    case "cameraPhotoError":
      return { ...state, cameraPhotoError: action.message };
    case "cameraContext":
      return {
        ...state,
        cameraContextActive: action.active,
        cameraContextFacing: action.facing,
        cameraContextError: action.active ? null : state.cameraContextError,
      };
    case "cameraContextError":
      return { ...state, cameraContextError: action.message };
    case "attachNote":
      return { ...state, notes: [...state.notes, action.note], accountError: null };
    case "detachNote":
      return { ...state, notes: state.notes.filter((note) => note.id !== action.id), accountError: null };
    case "attachHandoff":
      return { ...state, handoff: action.handoff, accountError: null };
    case "detachHandoff":
      return { ...state, handoff: null, accountError: null };
    case "clearAccount":
      return {
        ...state,
        notes: [],
        handoff: null,
        accountError: null,
        selection: null,
        selectionError: null,
        screen: null,
        screenError: null,
        cameraPhoto: null,
        cameraPhotoError: null,
        cameraContextActive: false,
        cameraContextFacing: null,
        cameraContextError: null,
      };
    case "accountError":
      return { ...state, accountError: action.message };
    case "replaceTurns":
      if (state.status === "CONNECTING" || state.status === "READY" || state.status === "RESPONDING") return state;
      return {
        ...state,
        status: "IDLE",
        turns: action.turns,
        liveUser: "",
        liveText: "",
        liveSources: [],
        error: null,
        resuming: false,
        continuedFrom: null,
      };
    case "seed":
      if (state.status === "CONNECTING" || state.status === "READY" || state.status === "RESPONDING") return state;
      return { ...state, turns: action.turns, continuedFrom: action.from, liveUser: "", liveText: "", liveSources: [], error: null };
    case "echo":
      if (state.status === "IDLE" || state.status === "ERROR") return state;
      if (state.echoFallback === action.fallback && state.playbackHeld === action.held) return state;
      return { ...state, echoFallback: action.fallback, playbackHeld: action.held };
    default: {
      const unhandled: never = action;
      throw new Error(`Unhandled assistant action: ${JSON.stringify(unhandled)}`);
    }
  }
}

const SOURCE_LIMIT = 8;

function mergeSources(current: AssistantSource[], incoming: AssistantSource[]): AssistantSource[] {
  const seen = new Set(current.map((source) => source.url));
  const next = [...current];
  for (const source of incoming) {
    if (seen.has(source.url)) continue;
    seen.add(source.url);
    next.push(source);
    if (next.length >= SOURCE_LIMIT) break;
  }
  return next;
}

/** Keeps citations on the reply that was spoken. No text means no sourced turn. */
function replyTurn(state: AssistantSnapshot, id: string, status?: "interrupted"): AssistantTurn | null {
  if (!state.liveText) return null;
  return {
    id,
    role: "assistant",
    text: state.liveText,
    ...(status === "interrupted" ? { status } : {}),
    ...(state.liveSources.length ? { sources: state.liveSources } : {}),
  };
}

/** Keeps speech that was still on screen when the session stopped, marked interrupted. */
function sealedTurns(
  state: AssistantSnapshot,
  extra: { user?: { id: string; text: string }; assistant?: { id: string; text: string } },
): AssistantTurn[] {
  const turns: AssistantTurn[] = [];
  const assistant = extra.assistant?.text.trim();
  if (assistant && extra.assistant) {
    turns.push({
      id: extra.assistant.id,
      role: "assistant",
      text: assistant,
      status: "interrupted",
      ...(state.liveSources.length ? { sources: state.liveSources } : {}),
    });
  }
  const user = extra.user?.text.trim();
  if (user && extra.user) turns.push({ id: extra.user.id, role: "user", text: user, status: "interrupted" });
  return turns;
}

/** A citation that arrives after the reply is already on screen stays with that reply. */
function attachSources(state: AssistantSnapshot, sources: AssistantSource[]): AssistantSnapshot {
  const last = state.turns.at(-1);
  if (!last || last.role !== "assistant") {
    return { ...state, liveSources: mergeSources(state.liveSources, sources) };
  }
  const turns = state.turns.slice(0, -1);
  turns.push({ ...last, sources: mergeSources(last.sources ?? [], sources) });
  return { ...state, turns, liveSources: [] };
}

/** Short status line for the Assistant header. */
export function assistantStatusLabel(snapshot: AssistantSnapshot, signedIn: boolean): string {
  if (!signedIn && snapshot.status === "IDLE") return "Sign in to use Assistant";
  switch (snapshot.status) {
    case "IDLE": return "Not started";
    case "CONNECTING": return snapshot.resuming ? "Reconnecting…" : "Connecting…";
    case "READY":
      return snapshot.echoFallback && snapshot.playbackHeld ? "Mic paused briefly" : "Listening";
    case "RESPONDING": return "Responding…";
    case "ERROR": return snapshot.error ?? "Assistant failed";
    default: {
      const unhandled: never = snapshot.status;
      throw new Error(`Unhandled assistant status: ${String(unhandled)}`);
    }
  }
}
