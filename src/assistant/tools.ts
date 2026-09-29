import { selectionPreview } from "@/assistant/selectionContext";
import { isRemoteKind, type RemoteKind } from "@/assistant/remoteContext";
import {
  isUnsupportedAction,
  planRemoteComputerAction,
  validateOpenApp,
  validateShortcut,
  type RemoteComputerAction,
} from "@/assistant/computerActions";

/**
 * Gemini 3.8 Live function calls, checked against the Live tools guide on 2026-09-15:
 * https://ai.google.dev/gemini-api/docs/live-api/tools
 *
 * The default is synchronous: the model waits until the client sends `toolResponse`.
 * `behavior: NON_BLOCKING` plus response `scheduling` exists, and the same page says
 * asynchronous calls are not supported on Gemini 3.1 Flash Live. These declarations
 * omit `behavior`, so confirmation finishes before Gemini continues. No `scheduling`
 * field is sent.
 *
 * `replace_selection` is not declared. Capture stores text and an optional app name,
 * not a field range. Windows insert pastes into whatever is focused now. Android
 * replaces a selection only while that field is still focused. After a conversation
 * that focus is gone, so a replace would write into the wrong place.
 */

export const ASSISTANT_TOOL_TEXT_LIMIT = 8_000;

const TEXT = {
  type: "string",
  description: "The exact text. Do not paraphrase it.",
};

/** Declarations sent in Live setup. No Search and no replace. */
export function assistantFunctionDeclarations() {
  return [
    {
      name: "copy_text",
      description: "Copy text to this device's clipboard. Does not change other apps or send it anywhere. Use only when the user asked to copy.",
      parameters: { type: "object", properties: { text: TEXT }, required: ["text"] },
    },
    {
      name: "insert_text",
      description: "Insert text into whichever app is focused now. Call this when the user asks. Do not ask them to click. This does not replace an earlier selection.",
      parameters: { type: "object", properties: { text: TEXT }, required: ["text"] },
    },
    {
      name: "create_voice_note",
      description: "Save text as a voice note on the user's account. Call this when the user asks to save a note. Do not ask them to click. Do not say voice notes are unavailable.",
      parameters: { type: "object", properties: { text: TEXT }, required: ["text"] },
    },
    {
      name: "list_voice_notes",
      description: "Read the user's voice notes. Call this when the user asks what their notes say. Inbox only unless include_archived is true. Answer from this result. Use an id from this list for archive, restore, or delete.",
      parameters: {
        type: "object",
        properties: {
          include_archived: { type: "boolean", description: "True to include archived notes. Omit to read the inbox only." },
        },
      },
    },
    {
      name: "archive_voice_note",
      description: "Archive one voice note. Call list_voice_notes first and pass that note's id. Call it when the user asks. Do not ask them to click. Do not say this is unavailable.",
      parameters: { type: "object", properties: { id: { type: "string", description: "The note id from list_voice_notes." } }, required: ["id"] },
    },
    {
      name: "restore_voice_note",
      description: "Move one archived voice note back to the inbox. Call list_voice_notes with include_archived first and pass that note's id. Call it when the user asks. Do not ask them to click.",
      parameters: { type: "object", properties: { id: { type: "string", description: "The note id from list_voice_notes." } }, required: ["id"] },
    },
    {
      name: "delete_voice_note",
      description: "Delete one voice note permanently. Call list_voice_notes first and pass that note's id. Call it when the user asks. Do not ask them to click. Do not delete unless the user asked.",
      parameters: { type: "object", properties: { id: { type: "string", description: "The note id from list_voice_notes." } }, required: ["id"] },
    },
    {
      name: "send_handoff",
      description: "Send text to another device on the user's account. Call this when the user asks to hand off or send to another device. Do not ask them to click. Omit device when one other device exists or a target is already selected. If several devices exist, call list_handoffs and pass the device name. Do not say handoffs are unavailable.",
      parameters: {
        type: "object",
        properties: {
          text: TEXT,
          device: { type: "string", description: "Optional name of the other device, such as Desktop." },
        },
        required: ["text"],
      },
    },
    {
      name: "list_handoffs",
      description: "Read received handoffs and the names of other devices this account can send to. Call this when the user asks what was handed off or which device to use. Answer from this result. Use an id from this list to dismiss one.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "dismiss_handoff",
      description: "Dismiss one received handoff. Call list_handoffs first and pass that handoff's id. Call it when the user asks. Do not ask them to click. This does not delete it on the other device.",
      parameters: { type: "object", properties: { id: { type: "string", description: "The handoff id from list_handoffs." } }, required: ["id"] },
    },
    {
      name: "capture_screen",
      description: "Capture what is on this device's screen right now and attach that still image. Call this when the user asks to look at, see, or check the screen, or to look again. Do not tell them to press a button. This does not click or type. Do not describe a screen until this tool has returned.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "capture_selection",
      description: "Read the text highlighted in the other app and attach it as context. Call this when the user asks what is selected or to use the selection. Do not describe a selection until this tool has returned. This does not change the other app.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "read_remote_device",
      description: "Read-only look at another device on this account. Kinds: presence, active_window, windows, screenshot. Never clicks, types, or changes that device. If the user did not name a device and more than one other device exists, ask which one. Do not guess. Answer only from this tool's result.",
      parameters: {
        type: "object",
        properties: {
          device: { type: "string", description: "Name of the other device, such as Desk PC. Omit only when one other device exists." },
          kind: { type: "string", description: "presence, active_window, windows, or screenshot." },
        },
        required: ["kind"],
      },
    },
    {
      name: "open_app",
      description: "Open Notepad or Calculator on this computer. Call this when the user asks. Do not ask them to click. No other application, and no shell.",
      parameters: { type: "object", properties: { app: { type: "string", description: "notepad or calculator." } }, required: ["app"] },
    },
    {
      name: "press_shortcut",
      description: "Press one allowlisted shortcut: copy, paste, select-all, undo, escape, or tab. Call this when the user asks. Do not ask them to click. Do not invent other shortcuts.",
      parameters: { type: "object", properties: { shortcut: { type: "string", description: "copy, paste, select-all, undo, escape, or tab." } }, required: ["shortcut"] },
    },
    {
      name: "supervise_screen",
      description: "Start a supervised screen task for a goal that needs seeing and clicking. A separate Computer Use model proposes each step. Call this when the user asks. Do not ask them to click. The user can stop it. This Live session does not move the mouse itself.",
      parameters: { type: "object", properties: { goal: { type: "string", description: "The harmless on-screen goal." } }, required: ["goal"] },
    },
    {
      name: "remote_action",
      description: "Ask another owned Windows device to open Notepad or Calculator, press an allowlisted shortcut, or insert text. No shell, delete, or click. The other device must allow remote actions and confirm. Name the device.",
      parameters: {
        type: "object",
        properties: {
          device: { type: "string", description: "Name of the other device." },
          action: { type: "string", description: "open_app, press_shortcut, or insert_text." },
          argument: { type: "string", description: "App id, shortcut id, or the exact text." },
        },
        required: ["device", "action", "argument"],
      },
    },
  ];
}

export interface ParsedToolCall {
  id: string | null;
  name: string;
  args: unknown;
}

export interface HandoffPlan {
  deviceId: string;
  label: string;
}

export type ConfirmToolName =
  | "insert_text"
  | "create_voice_note"
  | "send_handoff"
  | "archive_voice_note"
  | "restore_voice_note"
  | "delete_voice_note"
  | "dismiss_handoff"
  | "open_app"
  | "press_shortcut"
  | "supervise_screen"
  | "remote_action";

export type ToolDecision =
  | { kind: "ignore" }
  | { kind: "reject"; id: string; name: string; message: string }
  | { kind: "copy"; id: string; name: "copy_text"; text: string }
  | { kind: "capture"; id: string; name: "capture_screen" }
  | { kind: "selection"; id: string; name: "capture_selection" }
  | { kind: "notes"; id: string; name: "list_voice_notes"; includeArchived: boolean }
  | { kind: "handoffs"; id: string; name: "list_handoffs" }
  | {
    kind: "confirm";
    id: string;
    name: ConfirmToolName;
    text: string;
    title: string;
    preview: string;
    deviceId: string | null;
    remote: { action: RemoteComputerAction; device: string } | null;
  }
  | { kind: "remote"; id: string; name: "read_remote_device"; read: RemoteKind; device: string | null };

/** Reads `toolCall.functionCalls`. Returns null when the field is not a list. */
export function parseToolCallList(toolCall: unknown): ParsedToolCall[] | null {
  if (typeof toolCall !== "object" || toolCall === null) return null;
  const calls = (toolCall as { functionCalls?: unknown }).functionCalls;
  if (!Array.isArray(calls)) return null;
  const parsed: ParsedToolCall[] = [];
  for (const call of calls) {
    if (typeof call !== "object" || call === null) continue;
    const row = call as { id?: unknown; name?: unknown; args?: unknown };
    if (typeof row.name !== "string" || !row.name) continue;
    parsed.push({
      id: typeof row.id === "string" && row.id ? row.id : null,
      name: row.name,
      args: row.args ?? {},
    });
  }
  return parsed;
}

/**
 * Validates one call. Unknown names, missing ids, and bad arguments never run.
 * `planHandoff` is called only for a well-formed send, and its error becomes a rejection.
 */
export function decideToolCall(
  call: ParsedToolCall,
  planHandoff: (deviceName: string | null) => HandoffPlan,
): ToolDecision {
  if (!call.id) return { kind: "ignore" };
  const args = plainArgs(call.args);
  if (!args) {
    return { kind: "reject", id: call.id, name: call.name, message: "The action arguments were not an object." };
  }
  switch (call.name) {
    case "read_remote_device": {
      const read = readKind(args);
      if ("error" in read) return { kind: "reject", id: call.id, name: call.name, message: read.error };
      const device = readDevice(args);
      if ("error" in device) return { kind: "reject", id: call.id, name: call.name, message: device.error };
      return { kind: "remote", id: call.id, name: "read_remote_device", read: read.kind, device: device.name };
    }
    case "capture_screen":
      return { kind: "capture", id: call.id, name: "capture_screen" };
    case "capture_selection":
      return { kind: "selection", id: call.id, name: "capture_selection" };
    case "list_voice_notes":
      return { kind: "notes", id: call.id, name: "list_voice_notes", includeArchived: args.include_archived === true || args.includeArchived === true };
    case "list_handoffs":
      return { kind: "handoffs", id: call.id, name: "list_handoffs" };
    case "archive_voice_note":
    case "restore_voice_note":
    case "delete_voice_note":
    case "dismiss_handoff": {
      const item = readId(args);
      if ("error" in item) return { kind: "reject", id: call.id, name: call.name, message: item.error };
      return confirm(call.id, call.name, item.id, confirmTitle(call.name), null, null);
    }
    case "open_app": {
      const app = validateOpenApp(args.app);
      if (!app.ok) return { kind: "reject", id: call.id, name: call.name, message: app.message };
      return confirm(call.id, "open_app", app.id, `Open ${app.label}`, null, null);
    }
    case "press_shortcut": {
      const shortcut = validateShortcut(args.shortcut);
      if (!shortcut.ok) return { kind: "reject", id: call.id, name: call.name, message: shortcut.message };
      return confirm(call.id, "press_shortcut", shortcut.id, `Press ${shortcut.label}`, null, null);
    }
    case "supervise_screen": {
      const goal = readGoal(args);
      if ("error" in goal) return { kind: "reject", id: call.id, name: call.name, message: goal.error };
      return confirm(call.id, "supervise_screen", goal.text, "Start a supervised screen task", null, null);
    }
    case "remote_action": {
      const remote = readRemoteAction(args);
      if ("error" in remote) return { kind: "reject", id: call.id, name: call.name, message: remote.error };
      const device = readDevice(args);
      if ("error" in device || !device.name) {
        return { kind: "reject", id: call.id, name: call.name, message: "error" in device ? device.error : "Name the other device." };
      }
      return confirm(call.id, "remote_action", remote.argument, remote.label, null, { action: remote.action, device: device.name });
    }
    case "copy_text":
    case "insert_text":
    case "create_voice_note":
    case "send_handoff":
      break;
    default:
      return {
        kind: "reject",
        id: call.id,
        name: call.name,
        message: isUnsupportedAction(call.name) ? "That action is not available." : "That action is not available.",
      };
  }
  const text = readText(args);
  if ("error" in text) return { kind: "reject", id: call.id, name: call.name, message: text.error };
  if (call.name === "copy_text") return { kind: "copy", id: call.id, name: "copy_text", text: text.text };
  if (call.name === "insert_text") {
    return confirm(call.id, "insert_text", text.text, "Insert this text into the focused app", null, null);
  }
  if (call.name === "create_voice_note") {
    return confirm(call.id, "create_voice_note", text.text, "Save this voice note", null, null);
  }
  const device = readDevice(args);
  if ("error" in device) return { kind: "reject", id: call.id, name: call.name, message: device.error };
  try {
    const plan = planHandoff(device.name);
    return confirm(call.id, "send_handoff", text.text, `Send this text to ${plan.label}`, plan.deviceId, null);
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "The handoff could not be prepared.";
    return { kind: "reject", id: call.id, name: call.name, message };
  }
}

function confirmTitle(name: "archive_voice_note" | "restore_voice_note" | "delete_voice_note" | "dismiss_handoff"): string {
  switch (name) {
    case "archive_voice_note": return "Archive this voice note";
    case "restore_voice_note": return "Restore this voice note";
    case "delete_voice_note": return "Delete this voice note";
    case "dismiss_handoff": return "Dismiss this handoff";
  }
}

function confirm(
  id: string,
  name: ConfirmToolName,
  text: string,
  title: string,
  deviceId: string | null,
  remote: { action: RemoteComputerAction; device: string } | null,
): ToolDecision {
  return { kind: "confirm", id, name, text, title, preview: selectionPreview(text), deviceId, remote };
}

function plainArgs(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return plainArgs(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readId(args: Record<string, unknown>): { id: string } | { error: string } {
  if (typeof args.id !== "string" || !args.id.trim()) {
    return { error: "That id is required. List the items first and pass an id from that result." };
  }
  return { id: args.id.trim() };
}

function readText(args: Record<string, unknown>): { text: string } | { error: string } {
  if (typeof args.text !== "string") return { error: "Text has to be plain text." };
  if (!args.text.trim()) return { error: "Text is required." };
  if (args.text.trim().length > ASSISTANT_TOOL_TEXT_LIMIT) {
    return { error: `That text is ${args.text.trim().length.toLocaleString()} characters. Use a shorter text.` };
  }
  return { text: args.text };
}

function readKind(args: Record<string, unknown>): { kind: RemoteKind } | { error: string } {
  if (!isRemoteKind(args.kind)) return { error: "That read is not available." };
  return { kind: args.kind };
}

function readGoal(args: Record<string, unknown>): { text: string } | { error: string } {
  if (typeof args.goal !== "string" || !args.goal.trim()) return { error: "Say what the screen task should do." };
  if (args.goal.trim().length > 500) return { error: "That goal is too long." };
  return { text: args.goal.trim() };
}

function readRemoteAction(
  args: Record<string, unknown>,
): { action: RemoteComputerAction; argument: string; label: string } | { error: string } {
  if (typeof args.action !== "string" || typeof args.argument !== "string") {
    return { error: "That action is not available." };
  }
  const plan = planRemoteComputerAction(args.action, args.argument, "windows", true);
  if (plan.action === "deny") return { error: plan.message };
  return { action: args.action as RemoteComputerAction, argument: args.argument.trim(), label: plan.label };
}

function readDevice(args: Record<string, unknown>): { name: string | null } | { error: string } {
  if (args.device === undefined || args.device === null || args.device === "") return { name: null };
  if (typeof args.device !== "string") return { error: "Device has to be a name." };
  return { name: args.device };
}
