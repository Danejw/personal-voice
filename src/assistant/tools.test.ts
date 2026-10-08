import { describe, expect, it } from "vitest";
import { resolveHandoffDevice } from "@/handoffs/handoff";
import {
  ASSISTANT_TOOL_TEXT_LIMIT,
  assistantFunctionDeclarations,
  decideToolCall,
  parseToolCallList,
  type HandoffPlan,
} from "@/assistant/tools";

const devices = [
  { id: "desk", name: "Desktop" },
  { id: "phone", name: "Phone" },
];

function plan(deviceName: string | null): HandoffPlan {
  const resolved = resolveHandoffDevice(devices, "desk", deviceName);
  if ("error" in resolved) throw new Error(resolved.error);
  return { deviceId: resolved.id, label: resolved.name };
}

describe("assistant tool schema", () => {
  it("declares the four safe actions and no replace or search", () => {
    const names = assistantFunctionDeclarations().map((tool) => tool.name);
    expect(names).toEqual([
      "copy_text",
      "insert_text",
      "create_voice_note",
      "list_voice_notes",
      "archive_voice_note",
      "restore_voice_note",
      "delete_voice_note",
      "send_handoff",
      "list_handoffs",
      "dismiss_handoff",
      "capture_screen",
      "end_assistant_session",
      "paste_camera_photo",
      "capture_camera_photo",
      "start_camera_context",
      "stop_camera_context",
      "inspect_active_app",
    "inspect_accessible_elements",
    "list_windows",
    "navigate_window",
    "uia_control_action",
    "list_installed_apps",
    "focus_accessible_control",
    "invoke_accessible_control",
    "list_snippets",
    "create_snippet",
    "update_snippet",
    "send_remote_dictation",
    "edit_voice_note",
    "create_transform",
    "add_dictionary_word",
    "read_usage_analytics",
    "read_insights",
    "capture_selection",
      "read_remote_device",
      "open_app",
      "press_shortcut",
      "supervise_screen",
      "list_memories",
      "remember_memory",
      "change_memory",
      "forget_memory",
      "remote_action",
    ]);
    expect(JSON.stringify(assistantFunctionDeclarations())).not.toContain("run_shell");
    expect(JSON.stringify(assistantFunctionDeclarations())).not.toContain("replace_selection");
    expect(JSON.stringify(assistantFunctionDeclarations())).not.toContain("NON_BLOCKING");
  });

  it("accepts session end and confirms a destination before pasting a camera photo", () => {
    expect(decideToolCall({ id: "bye", name: "end_assistant_session", args: {} }, plan)).toEqual({
      kind: "endSession", id: "bye", name: "end_assistant_session",
    });
    expect(decideToolCall({ id: "photo", name: "paste_camera_photo", args: {} }, plan)).toMatchObject({
      kind: "reject", id: "photo",
    });
    expect(decideToolCall({
      id: "photo", name: "paste_camera_photo", args: { window: "ChatGPT - Google Chrome" },
    }, plan)).toMatchObject({
      kind: "confirm", id: "photo", name: "paste_camera_photo", text: "ChatGPT - Google Chrome",
    });
  });

  it("keeps the call id and rejects malformed arguments before any action", () => {
    expect(parseToolCallList({ functionCalls: [{ name: "copy_text", args: { text: "hidden" } }] })).toEqual([
      { id: null, name: "copy_text", args: { text: "hidden" } },
    ]);
    expect(decideToolCall(
      { id: null, name: "copy_text", args: { text: "hidden" } },
      plan,
    )).toEqual({ kind: "ignore" });
    expect(decideToolCall({ id: "1", name: "copy_text", args: { text: 12 } }, plan)).toMatchObject({
      kind: "reject",
      id: "1",
      message: "Text has to be plain text.",
    });
    expect(decideToolCall({ id: "2", name: "copy_text", args: ["copied"] }, plan)).toMatchObject({
      kind: "reject",
      message: "The action arguments were not an object.",
    });
    expect(decideToolCall({ id: "3", name: "replace_selection", args: { text: "nope" } }, plan)).toMatchObject({
      kind: "reject",
      id: "3",
      message: "That action is not available.",
    });
    expect(decideToolCall({
      id: "4",
      name: "insert_text",
      args: { text: "x".repeat(ASSISTANT_TOOL_TEXT_LIMIT + 1) },
    }, plan)).toMatchObject({ kind: "reject", id: "4" });
  });

  it("copies without confirmation and confirms insert, notes, and handoff", () => {
    expect(decideToolCall({
      id: "copy",
      name: "copy_text",
      args: { text: " copied by assistant ", extra: true },
    }, plan)).toEqual({ kind: "copy", id: "copy", name: "copy_text", text: " copied by assistant " });
    expect(decideToolCall({
      id: "remote",
      name: "read_remote_device",
      args: { kind: "active_window", device: "Desk PC" },
    }, plan)).toEqual({
      kind: "remote",
      id: "remote",
      name: "read_remote_device",
      read: "active_window",
      device: "Desk PC",
    });
    expect(decideToolCall({ id: "notes", name: "list_voice_notes", args: {} }, plan)).toEqual({
      kind: "notes",
      id: "notes",
      name: "list_voice_notes",
      includeArchived: false,
    });
    expect(decideToolCall({ id: "archived", name: "list_voice_notes", args: { include_archived: true } }, plan)).toMatchObject({
      includeArchived: true,
    });
    expect(decideToolCall({ id: "box", name: "list_handoffs", args: {} }, plan)).toEqual({
      kind: "handoffs",
      id: "box",
      name: "list_handoffs",
    });
    expect(decideToolCall({ id: "sel", name: "capture_selection", args: {} }, plan)).toEqual({
      kind: "selection",
      id: "sel",
      name: "capture_selection",
    });
    expect(decideToolCall({ id: "drop", name: "delete_voice_note", args: {} }, plan)).toMatchObject({
      kind: "reject",
      message: "That id is required. List the items first and pass an id from that result.",
    });
    expect(decideToolCall({ id: "drop", name: "delete_voice_note", args: { id: "n1" } }, plan)).toMatchObject({
      kind: "confirm",
      name: "delete_voice_note",
      text: "n1",
      title: "Delete this note",
    });
    expect(decideToolCall({ id: "see", name: "capture_screen", args: {} }, plan)).toEqual({
      kind: "capture",
      id: "see",
      name: "capture_screen",
    });
    expect(decideToolCall({ id: "cam", name: "capture_camera_photo", args: { camera: "back" } }, plan)).toEqual({
      kind: "cameraPhoto",
      id: "cam",
      name: "capture_camera_photo",
      facing: "back",
    });
    expect(decideToolCall({ id: "live", name: "start_camera_context", args: { camera: "front" } }, plan)).toEqual({
      kind: "cameraStart",
      id: "live",
      name: "start_camera_context",
      facing: "front",
    });
    expect(decideToolCall({ id: "off", name: "stop_camera_context", args: {} }, plan)).toEqual({
      kind: "cameraStop",
      id: "off",
      name: "stop_camera_context",
    });
    expect(decideToolCall({ id: "bad", name: "capture_camera_photo", args: { camera: "side" } }, plan)).toMatchObject({
      kind: "reject",
      message: "Camera must be default, front, or back.",
    });
    expect(decideToolCall({ id: "click", name: "click", args: {} }, plan)).toMatchObject({ kind: "reject" });
    expect(decideToolCall({ id: "ins", name: "insert_text", args: "{\"text\":\"Hello\"}" }, plan)).toMatchObject({
      kind: "confirm",
      id: "ins",
      name: "insert_text",
      text: "Hello",
      title: "Insert this text into the focused app",
    });
    expect(decideToolCall({ id: "note", name: "create_voice_note", args: { text: "Assistant tool test." } }, plan)).toMatchObject({
      kind: "confirm",
      title: "Save this note",
      text: "Assistant tool test.",
    });
    expect(decideToolCall({ id: "send", name: "send_handoff", args: { text: "On the desktop" } }, plan)).toMatchObject({
      kind: "confirm",
      title: "Send this text to Desktop",
      deviceId: "desk",
    });
    expect(decideToolCall({ id: "phone", name: "send_handoff", args: { text: "On the phone", device: "Phone" } }, plan)).toMatchObject({
      deviceId: "phone",
      title: "Send this text to Phone",
    });
    expect(decideToolCall({ id: "missing", name: "send_handoff", args: { text: "Nowhere", device: "Laptop" } }, plan)).toMatchObject({
      kind: "reject",
      id: "missing",
      message: "No other device is named Laptop.",
    });
    expect(decideToolCall({ id: "mem", name: "remember_memory", args: { key: "Answer length", value: "Prefer short answers." } }, plan)).toMatchObject({
      kind: "confirm",
      name: "remember_memory",
      memory: { action: "remember", key: "answer_length", kind: "preference", value: "Prefer short answers." },
    });
    expect(decideToolCall({ id: "chg", name: "change_memory", args: { key: "answer_length", value: "Prefer long answers." } }, plan)).toMatchObject({
      kind: "confirm",
      memory: { action: "change", key: "answer_length", value: "Prefer long answers." },
    });
    expect(decideToolCall({ id: "gone", name: "forget_memory", args: { key: "answer_length" } }, plan)).toMatchObject({
      kind: "confirm",
      title: "Forget answer_length",
      memory: { action: "forget", key: "answer_length" },
    });
    expect(decideToolCall({ id: "bad", name: "forget_memory", args: { key: "!!!" } }, plan)).toMatchObject({ kind: "reject" });
    expect(decideToolCall({ id: "list", name: "list_memories", args: {} }, plan)).toEqual({
      kind: "memories",
      id: "list",
      name: "list_memories",
    });
  });

  it("uses the saved handoff target and refuses an unnamed or ambiguous device", () => {
    expect(resolveHandoffDevice(devices, null, null)).toEqual({ error: "Choose a device in Handoffs first." });
    expect(resolveHandoffDevice([...devices, { id: "other", name: "Phone" }], "desk", "Phone")).toEqual({
      error: "More than one device is named Phone.",
    });
  });
});
