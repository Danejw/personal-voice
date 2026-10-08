import { selectionPreview } from "@/assistant/selectionContext";
import { parseMemoryCommand, type MemoryCommand } from "@/assistant/memory";
import { isRemoteKind, type RemoteKind } from "@/assistant/remoteContext";
import {
  isUnsupportedAction,
  planRemoteComputerAction,
  validateOpenApp,
  validateShortcut,
  type RemoteComputerAction,
} from "@/assistant/computerActions";
import { cameraFacingFromArgs, type CameraFacing } from "@/platform/camera";

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
      description: "Save text as a note on the user's account. Call this when the user asks to save a note. Do not ask them to click. Do not say notes are unavailable.",
      parameters: { type: "object", properties: { text: TEXT }, required: ["text"] },
    },
    {
      name: "list_voice_notes",
      description: "Read the user's notes. Call this when the user asks what their notes say. Inbox only unless include_archived is true. Answer from this result. Use an id from this list for archive, restore, or delete.",
      parameters: {
        type: "object",
        properties: {
          include_archived: { type: "boolean", description: "True to include archived notes. Omit to read the inbox only." },
        },
      },
    },
    {
      name: "archive_voice_note",
      description: "Archive one note. Call list_voice_notes first and pass that note's id. Call it when the user asks. Do not ask them to click. Do not say this is unavailable.",
      parameters: { type: "object", properties: { id: { type: "string", description: "The note id from list_voice_notes." } }, required: ["id"] },
    },
    {
      name: "restore_voice_note",
      description: "Move one archived note back to the inbox. Call list_voice_notes with include_archived first and pass that note's id. Call it when the user asks. Do not ask them to click.",
      parameters: { type: "object", properties: { id: { type: "string", description: "The note id from list_voice_notes." } }, required: ["id"] },
    },
    {
      name: "delete_voice_note",
      description: "Delete one note permanently. Call list_voice_notes first and pass that note's id. Call it when the user asks. Do not ask them to click. Do not delete unless the user asked.",
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
      name: "capture_camera_photo",
      description: "Take one still photo from this device's camera and attach it. Call this only when the user explicitly asks to use the camera, take a picture, or look through the camera. camera may be default, front, or back. Do not turn the camera on just because visual context might help. This is not a screenshot.",
      parameters: {
        type: "object",
        properties: {
          camera: { type: "string", description: "default, front, or back. Omit for default." },
        },
      },
    },
    {
      name: "start_camera_context",
      description: "Turn on live Camera Context so fresh camera frames are sent while the user keeps talking. Call this only when the user explicitly asks to turn the camera on, look through the camera with them, or use the front/back camera continuously. camera may be default, front, or back. Do not activate the camera without that request. This is not a screenshot and does not save frames.",
      parameters: {
        type: "object",
        properties: {
          camera: { type: "string", description: "default, front, or back. Omit for default." },
        },
      },
    },
    {
      name: "stop_camera_context",
      description: "Turn Camera Context off, release the camera, and stop sending frames. Call this when the user asks to turn the camera off, stop looking, or that they are done. The conversation and microphone stay active.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "inspect_active_app",
      description: "Windows only. When the user asks what is visible or to read the active app, inspect its accessible text without a screenshot. This is on-demand and read-only. Do not claim access to content not returned.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "send_remote_dictation",
      description: "Send already dictated or supplied text to an online paired device for insertion at its focused field. Requires confirmation and an exact device name. This is different from a handoff.",
      parameters: { type: "object", properties: { text: TEXT, device: { type: "string" } }, required: ["text", "device"] },
    },
    {
      name: "edit_voice_note",
      description: "Edit an existing note by id obtained from list_voice_notes. Replaces its full text, with confirmation.",
      parameters: { type: "object", properties: { id: { type: "string" }, text: TEXT }, required: ["id", "text"] },
    },
    {
      name: "create_transform",
      description: "Create a reusable text transform with a name and instruction. Requires user confirmation.",
      parameters: { type: "object", properties: { name: { type: "string" }, instruction: { type: "string" } }, required: ["name", "instruction"] },
    },
    {
      name: "add_dictionary_word",
      description: "Add a word or phrase to the personal dictionary. Requires user confirmation.",
      parameters: { type: "object", properties: { text: TEXT }, required: ["text"] },
    },
    {
      name: "read_usage_analytics",
      description: "Read the signed-in user's existing usage analytics and totals. Does not change settings.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "read_insights",
      description: "Read the existing usage insights and suggestions. Does not make any changes.",
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
      name: "list_windows",
      description: "Read visible Windows application window titles to navigate between them.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "navigate_window",
      description: "Activate an existing application window with the exact title from list_windows. Requires confirmation.",
      parameters: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
    },
    {
      name: "uia_control_action",
      description: "Windows accessibility action on an inspected, exact-name focused element. Operations: focus, invoke, select, expand, collapse, scroll-up, scroll-down, set-value. Confirm before acting. For set-value supply text. Never attempt passwords, destructive changes, submissions, purchases or OS settings.",
      parameters: { type: "object", properties: {
        action: { type: "string" }, name: { type: "string" }, value: { type: "string" }
      }, required: ["action", "name"] },
    },
    {
      name: "list_installed_apps",
      description: "Windows only. Discover installed apps by Start Menu shortcut name; use exact returned names to open apps.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "focus_accessible_control",
      description: "Windows only. Focus the currently inspected accessibility element by its exact name, with user confirmation.",
      parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    },
    {
      name: "invoke_accessible_control",
      description: "Windows only. Invoke the currently focused UI Automation control by its exact accessible name. Always inspect the control first, confirm with the user, and never use for payments, security changes, deletion, or submissions.",
      parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    },
    {
      name: "list_snippets",
      description: "Read saved voice snippets and their expansion text.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "create_snippet",
      description: "Create a snippet with voice trigger and expansion content, requiring confirmation.",
      parameters: { type: "object", properties: { trigger: { type: "string" }, content: { type: "string" } }, required: ["trigger", "content"] },
    },
    {
      name: "update_snippet",
      description: "Update an existing snippet by id from list_snippets, requiring confirmation.",
      parameters: { type: "object", properties: { id: { type: "string" }, trigger: { type: "string" }, content: { type: "string" } }, required: ["id", "trigger", "content"] },
    },
    {
      name: "open_app",
      description: "Open a named Windows executable application on this device when asked. Do not run commands, scripts, shell interpreters, or pass arguments.",
      parameters: { type: "object", properties: { app: { type: "string", description: "Application executable name, such as notepad, calc, or code." } }, required: ["app"] },
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
      name: "list_memories",
      description: "List what this account asked to remember. Call this before changing or forgetting when the key is unclear. Forgotten keys are listed so you do not teach them again. Answer from this result.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "remember_memory",
      description: "Remember one explicit preference or fact for this account, on every device. Call this when the user says to remember something, such as preferring short answers. Use a short key such as answer_length. Do not call this to change an existing key.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Stable key such as answer_length." },
          value: { type: "string", description: "The exact preference or fact, such as Prefer short answers." },
          kind: { type: "string", description: "preference or fact. Omit for preference." },
        },
        required: ["key", "value"],
      },
    },
    {
      name: "change_memory",
      description: "Replace one remembered preference or fact. Call list_memories first if the key is unclear. The new value wins over the old one. Do not invent a second key for the same preference.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "The existing key, such as answer_length." },
          value: { type: "string", description: "The corrected value." },
        },
        required: ["key", "value"],
      },
    },
    {
      name: "forget_memory",
      description: "Forget one remembered preference or fact. It leaves new sessions and is not learned again from the same conversation. This does not delete the conversation. Call list_memories first if the key is unclear.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "The key to forget, such as answer_length." },
        },
        required: ["key"],
      },
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
  | "focus_accessible_control"
  | "navigate_window"
  | "uia_control_action"
  | "invoke_accessible_control"
  | "create_snippet"
  | "update_snippet"
  | "send_remote_dictation"
  | "edit_voice_note"
  | "create_transform"
  | "add_dictionary_word"
  | "send_handoff"
  | "archive_voice_note"
  | "restore_voice_note"
  | "delete_voice_note"
  | "dismiss_handoff"
  | "open_app"
  | "press_shortcut"
  | "supervise_screen"
  | "remote_action"
  | "remember_memory"
  | "change_memory"
  | "forget_memory";

export type ToolDecision =
  | { kind: "ignore" }
  | { kind: "reject"; id: string; name: string; message: string }
  | { kind: "copy"; id: string; name: "copy_text"; text: string }
  | { kind: "capture"; id: string; name: "capture_screen" }
  | { kind: "cameraPhoto"; id: string; name: "capture_camera_photo"; facing: CameraFacing }
  | { kind: "cameraStart"; id: string; name: "start_camera_context"; facing: CameraFacing }
  | { kind: "cameraStop"; id: string; name: "stop_camera_context" }
  | { kind: "selection"; id: string; name: "capture_selection" }
  | { kind: "accessibility"; id: string; name: "inspect_active_app" }
  | { kind: "windows"; id: string; name: "list_windows" }
  | { kind: "apps"; id: string; name: "list_installed_apps" }
  | { kind: "snippets"; id: string; name: "list_snippets" }
  | { kind: "notes"; id: string; name: "list_voice_notes"; includeArchived: boolean }
  | { kind: "dashboard"; id: string; name: "read_usage_analytics" | "read_insights" }
  | { kind: "memories"; id: string; name: "list_memories" }
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
    memory: MemoryCommand | null;
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
    case "capture_camera_photo": {
      const facing = cameraFacingFromArgs(args);
      if (typeof facing === "object") return { kind: "reject", id: call.id, name: call.name, message: facing.error };
      return { kind: "cameraPhoto", id: call.id, name: "capture_camera_photo", facing };
    }
    case "start_camera_context": {
      const facing = cameraFacingFromArgs(args);
      if (typeof facing === "object") return { kind: "reject", id: call.id, name: call.name, message: facing.error };
      return { kind: "cameraStart", id: call.id, name: "start_camera_context", facing };
    }
    case "stop_camera_context":
      return { kind: "cameraStop", id: call.id, name: "stop_camera_context" };
    case "inspect_active_app":
      return { kind: "accessibility", id: call.id, name: "inspect_active_app" };
    case "capture_selection":
      return { kind: "selection", id: call.id, name: "capture_selection" };
    case "list_windows":
      return { kind: "windows", id: call.id, name: "list_windows" };
    case "list_installed_apps":
      return { kind: "apps", id: call.id, name: "list_installed_apps" };
    case "list_snippets":
      return { kind: "snippets", id: call.id, name: "list_snippets" };
    case "read_usage_analytics":
    case "read_insights":
      return { kind: "dashboard", id: call.id, name: call.name };
    case "list_voice_notes":
      return { kind: "notes", id: call.id, name: "list_voice_notes", includeArchived: args.include_archived === true || args.includeArchived === true };
    case "list_handoffs":
      return { kind: "handoffs", id: call.id, name: "list_handoffs" };
    case "list_memories":
      return { kind: "memories", id: call.id, name: "list_memories" };
    case "remember_memory":
    case "change_memory":
    case "forget_memory": {
      const memory = parseMemoryCommand(call.name, args);
      if ("error" in memory) return { kind: "reject", id: call.id, name: call.name, message: memory.error };
      const title = memory.action === "forget"
        ? `Forget ${memory.key}`
        : memory.action === "change"
          ? `Change ${memory.key}`
          : `Remember ${memory.key}`;
      const body = memory.action === "forget" ? memory.key : memory.value;
      return confirm(call.id, call.name, body, title, null, null, memory);
    }
    case "navigate_window": {
      if (typeof args.title !== "string" || !args.title.trim() || args.title.length > 120) {
        return { kind: "reject", id: call.id, name: call.name, message: "Provide an exact window title." };
      }
      return confirm(call.id, "navigate_window", args.title, "Switch to Windows application", null, null);
    }
    case "uia_control_action": {
      const choices = ["focus", "invoke", "select", "expand", "collapse", "scroll-up", "scroll-down", "set-value"];
      if (typeof args.action !== "string" || !choices.includes(args.action) ||
          typeof args.name !== "string" || !args.name.trim() || args.name.length > 280 ||
          (args.action === "set-value" && (typeof args.value !== "string" || args.value.length > 1000))) {
        return {kind: "reject", id: call.id, name: call.name, message: "Invalid accessibility control action."};
      }
      return confirm(call.id, "uia_control_action", JSON.stringify({
        action: args.action, name: args.name, value: args.action === "set-value" ? args.value : null
      }), "Control Windows accessibility element", null, null);
    }
    case "focus_accessible_control":
    case "invoke_accessible_control": {
      if (typeof args.name !== "string" || !args.name.trim() || args.name.length > 280) {
        return {kind: "reject", id: call.id, name: call.name, message: "Specify the exact accessible control name."};
      }
      return confirm(call.id, call.name, args.name, call.name === "focus_accessible_control" ? "Focus Windows control" : "Invoke focused Windows control", null, null);
    }
    case "create_snippet":
    case "update_snippet": {
      const id = call.name === "update_snippet" ? readId(args) : null;
      if (id && "error" in id) return {kind: "reject", id: call.id, name: call.name, message: id.error};
      if (typeof args.trigger !== "string" || !args.trigger.trim() || args.trigger.length > 120 ||
          typeof args.content !== "string" || !args.content.trim() || args.content.length > 20000) {
        return {kind: "reject", id: call.id, name: call.name, message: "Provide a valid snippet trigger and content."};
      }
      return confirm(call.id, call.name,
        JSON.stringify({ id: id && "id" in id ? id.id : null, trigger: args.trigger, content: args.content }),
        call.name === "create_snippet" ? "Create snippet" : "Update snippet", null, null);
    }
    case "send_remote_dictation": {
      const body = readText(args);
      const device = readDevice(args);
      if ("error" in body || "error" in device || !device.name) {
        return { kind: "reject", id: call.id, name: call.name, message: "Provide text and a device name." };
      }
      return confirm(call.id, "send_remote_dictation", JSON.stringify({ text: body.text, device: device.name }), "Send dictation to remote device", null, null);
    }
    case "edit_voice_note": {
      const id = readId(args);
      const body = readText(args);
      if ("error" in id || "error" in body) return { kind: "reject", id: call.id, name: call.name, message: "error" in id ? id.error : "error" in body ? body.error : "Invalid note." };
      return confirm(call.id, "edit_voice_note", JSON.stringify({ id: id.id, text: body.text }), "Edit this note", null, null);
    }
    case "create_transform": {
      if (typeof args.name !== "string" || !args.name.trim() || args.name.length > 80 || typeof args.instruction !== "string" || !args.instruction.trim() || args.instruction.length > 4000) {
        return { kind: "reject", id: call.id, name: call.name, message: "Provide a transform name and instruction." };
      }
      return confirm(call.id, "create_transform", JSON.stringify({ name: args.name.trim(), instruction: args.instruction.trim() }), "Create this transform", null, null);
    }
    case "add_dictionary_word": {
      const word = readText(args);
      if ("error" in word) return { kind: "reject", id: call.id, name: call.name, message: word.error };
      return confirm(call.id, "add_dictionary_word", word.text, "Add this dictionary word", null, null);
    }
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
    return confirm(call.id, "create_voice_note", text.text, "Save this note", null, null);
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
    case "archive_voice_note": return "Archive this note";
    case "restore_voice_note": return "Restore this note";
    case "delete_voice_note": return "Delete this note";
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
  memory: MemoryCommand | null = null,
): ToolDecision {
  return { kind: "confirm", id, name, text, title, preview: selectionPreview(text), deviceId, remote, memory };
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
