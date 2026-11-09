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
  it("declares bounded tools without shell execution or selection replacement", () => {
    const names = assistantFunctionDeclarations().map((tool) => tool.name);
    expect(names).toEqual([
      "copy_text",
      "insert_text",
      "create_note",
      "list_notes",
      "archive_note",
      "restore_note",
      "delete_note",
      "send_handoff",
      "list_nearby_devices",
      "control_nearby_device",
      "device_environment_status",
      "route_assistant_audio",
      "manage_screen_share",
      "list_handoffs",
      "dismiss_handoff",
      "capture_screen",
      "end_assistant_session",
      "paste_camera_photo",
      "capture_camera_photo",
      "start_camera_context",
      "stop_camera_context",
      "capture_pointer_target",
      "inspect_pointer_context",
      "inspect_active_app",
      "send_remote_dictation",
      "edit_note",
      "attach_file_to_note",
      "create_transform",
      "add_dictionary_word",
      "read_usage_analytics",
      "read_insights",
      "capture_selection",
      "read_remote_device",
      "inspect_accessibility_tree",
      "accessibility_pattern_action",
      "start_accessibility_watch",
      "stop_accessibility_watch",
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
      "open_app",
      "press_shortcut",
      "supervise_screen",
      "list_past_conversations",
      "read_past_conversation",
      "list_conversation_sessions",
      "continue_past_conversation",
      "list_memories",
      "search_memory",
      "remember_memory",
      "change_memory",
      "forget_memory",
      "get_tool_playbook",
      "pair_device",
      "remote_computer_goal",
      "remote_action",
    ]);
    expect(JSON.stringify(assistantFunctionDeclarations())).not.toContain("run_shell");
    expect(JSON.stringify(assistantFunctionDeclarations())).not.toContain("replace_selection");
    expect(JSON.stringify(assistantFunctionDeclarations())).not.toContain("NON_BLOCKING");
  });

  it("confirms newly allowlisted document shortcuts rather than executing arbitrary keys", () => {
    for (const shortcut of ["save", "save-as", "open-file", "find",
      "address-bar", "new-tab", "switch-window"]) {
      expect(decideToolCall({ id: shortcut, name: "press_shortcut",
        args: { shortcut } }, plan)).toMatchObject({ kind: "confirm", name: "press_shortcut" });
    }
    expect(decideToolCall({ id: "bad", name: "press_shortcut",
      args: { shortcut: "alt+f4" } }, plan)).toMatchObject({ kind: "reject" });
  });

  it("validates Android audio/display actions and never accepts arbitrary output IDs", () => {
    expect(decideToolCall({id:"status",name:"device_environment_status",args:{}}, plan))
      .toMatchObject({kind:"deviceEnvironment"});
    expect(decideToolCall({id:"route",name:"route_assistant_audio",
      args:{output_id:"audio:42"}}, plan)).toMatchObject({
        kind:"audioRoute", outputId:"audio:42",
      });
    expect(decideToolCall({id:"route",name:"route_assistant_audio",
      args:{output_id:"system"}}, plan)).toMatchObject({kind:"audioRoute"});
    for (const output_id of ["bt-abcdef", "audio:2/foo", "audio:-9", "", 123]) {
      expect(decideToolCall({id:"bad",name:"route_assistant_audio",
        args:{output_id}}, plan).kind).toBe("reject");
    }
    expect(decideToolCall({id:"share",name:"manage_screen_share",
      args:{action:"start"}}, plan)).toMatchObject({kind:"confirm",name:"manage_screen_share"});
    expect(decideToolCall({id:"stop",name:"manage_screen_share",
      args:{action:"stop"}}, plan)).toMatchObject({kind:"screenStop"});
    for(const action of ["status","cast","",undefined]){
      expect(decideToolCall({id:"bad",name:"manage_screen_share",
        args:{action}},plan).kind).toBe("reject");
    }
  });

  it("validates nearby discovery and rejects invented or unsafe device commands", () => {
    expect(decideToolCall({ id: "list", name: "list_nearby_devices", args: {} }, plan))
      .toMatchObject({ kind: "nearbyDevices", query: "" });
    expect(decideToolCall({ id: "find", name: "list_nearby_devices",
      args: { query: "LG webOS TV" } }, plan))
      .toMatchObject({ kind: "nearbyDevices", query: "LG webOS TV" });
    for (const query of [123, "a".repeat(81), { ip: "192.168.0.1" }]) {
      expect(decideToolCall({ id: "bad-search", name: "list_nearby_devices",
        args: { query } }, plan).kind).toBe("reject");
    }
    const id = "lan-123456789abc";
    const speakerId = "bt-abcdef012345abcdef012345";
    expect(decideToolCall({ id: "speaker", name: "control_nearby_device",
      args: { device_id: speakerId, action: "connect_and_use" } }, plan))
      .toMatchObject({ kind: "confirm", name: "control_nearby_device",
        text: JSON.stringify({ deviceId: speakerId, action: "connect_and_use" }) });
    expect(decideToolCall({ id: "run", name: "control_nearby_device",
      args: { device_id: id, action: "volume_up" } }, plan))
      .toMatchObject({ kind: "confirm", name: "control_nearby_device",
        text: JSON.stringify({ deviceId: id, action: "volume_up" }) });
    for (const args of [
      { device_id: "192.168.0.27", action: "volume_up" },
      { device_id: id, action: "factory_reset" },
      { device_id: id },
      { device_id: "", action: "play" },
    ]) {
      expect(decideToolCall({ id: "bad", name: "control_nearby_device", args }, plan).kind)
        .toBe("reject");
    }
  });

  it("validates pairing tool actions and eight-digit codes", () => {
    expect(decideToolCall({ id: "code", name: "pair_device", args: { action: "show_code" } }, plan))
      .toMatchObject({ kind: "pairing", action: "show_code" });
    expect(decideToolCall({ id: "scan", name: "pair_device", args: { action: "scan_qr" } }, plan))
      .toMatchObject({ kind: "pairing", action: "scan_qr" });
    expect(decideToolCall({ id: "enter", name: "pair_device", args: { action: "enter_code", code: "12345678" } }, plan))
      .toMatchObject({ kind: "pairing", action: "enter_code", code: "12345678" });
    expect(decideToolCall({ id: "bad", name: "pair_device", args: { action: "enter_code", code: "1234" } }, plan).kind).toBe("reject");
    expect(decideToolCall({ id: "bad", name: "pair_device", args: { action: "approve" } }, plan).kind).toBe("reject");
  });

  it("routes complete remote desktop goals without asking for individual mouse steps", () => {
    expect(decideToolCall({ id: "g", name: "remote_computer_goal",
      args: { action: "start", goal: "Open Chrome and organize my notes." } }, plan))
      .toMatchObject({ kind: "remoteComputerGoal", action: "start", device: null });
    expect(decideToolCall({ id: "s", name: "remote_computer_goal",
      args: { action: "status" } }, plan))
      .toMatchObject({ kind: "remoteComputerGoal", action: "status", goal: "current" });
    expect(decideToolCall({ id: "bad", name: "remote_computer_goal",
      args: { action: "start", goal: "" } }, plan).kind).toBe("reject");
    expect(decideToolCall({ id: "pause", name: "remote_computer_goal",
      args: { action: "pause" } }, plan)).toMatchObject({ kind: "remoteComputerGoal", action: "pause", goal: "current" });
    expect(decideToolCall({ id: "resume", name: "remote_computer_goal",
      args: { action: "resume" } }, plan)).toMatchObject({ kind: "remoteComputerGoal", action: "resume", goal: "current" });
    expect(decideToolCall({ id: "redirect", name: "remote_computer_goal",
      args: { action: "redirect", goal: "Open Calculator." } }, plan))
      .toMatchObject({ kind: "remoteComputerGoal", action: "redirect", goal: "Open Calculator." });
    expect(decideToolCall({ id: "bad-redirect", name: "remote_computer_goal",
      args: { action: "redirect", goal: "" } }, plan).kind).toBe("reject");
    expect(decideToolCall({ id: "bad-pause", name: "remote_computer_goal",
      args: { action: "pause", goal: "Open Calculator." } }, plan).kind).toBe("reject");
  });

  it("validates note image source and keeps old text-only calls compatible", () => {
    expect(decideToolCall({id: "new", name: "create_note",
      args: {text: "Bug report", attachment_source: "screenshot"}}, plan)).toMatchObject({
      kind: "confirm", name: "create_note", title: "Save note with attachment",
      text: JSON.stringify({text: "Bug report", attachment_source: "screenshot"}),
    });
    expect(decideToolCall({id: "local", name: "attach_file_to_note",
      args: { id: "note-1", attachment_source: "selected_file" }}, plan)).toMatchObject({
      kind: "confirm", name: "attach_file_to_note", title: "Attach file to note",
    });
    expect(decideToolCall({id: "edit", name: "edit_note",
      args: {id: "note-1", text: "Updated", attachment_source: "camera_photo"}}, plan)).toMatchObject({
      kind: "confirm", name: "edit_note", title: "Edit note and attach file",
    });
    expect(decideToolCall({id: "attach", name: "attach_file_to_note",
      args: {id: "note-1", attachment_source: "screenshot"}}, plan)).toMatchObject({
      kind: "confirm", name: "attach_file_to_note",
      text: JSON.stringify({id: "note-1", attachment_source: "screenshot"}),
    });
    for (const bad of ["file:///etc/passwd", "camera", "screenshot.png", "", null]) {
      expect(decideToolCall({id: "bad", name: "attach_file_to_note",
        args: {id: "note-1", attachment_source: bad}}, plan)).toMatchObject({kind: "reject"});
    }
    expect(decideToolCall({id: "missing", name: "attach_file_to_note", args: {id: "note-1"}}, plan)).toMatchObject({kind: "reject"});
    expect(decideToolCall({id: "bad", name: "create_note",
      args: {text: "Keep", attachment_source: "local_file"}}, plan)).toMatchObject({kind: "reject"});
    expect(decideToolCall({id: "plain", name: "create_note", args: {text: "Keep"}}, plan))
      .toMatchObject({kind: "confirm", text: "Keep", title: "Save this note"});
  });

  it("routes mouse pointer inspection read-only, rejecting missing tool ids", () => {
    expect(decideToolCall({ id: "pointer-1", name: "inspect_pointer_context", args: {} }, plan))
      .toEqual({ kind: "pointer", id: "pointer-1", name: "inspect_pointer_context" });
    expect(decideToolCall({ id: "picture-1", name: "capture_pointer_target", args: {} }, plan))
      .toEqual({ kind: "pointerSnapshot", id: "picture-1", name: "capture_pointer_target" });
    expect(decideToolCall({ id: null, name: "inspect_pointer_context", args: {} }, plan).kind)
      .toBe("ignore");
  });

  it("validates read-only, account-scoped prior conversation tool calls", () => {
    const id = "33333333-3333-4333-8333-333333333333";
    expect(decideToolCall({ id: "list", name: "list_past_conversations", args: { query: "bike" } }, plan))
      .toEqual({ kind: "conversations", id: "list", name: "list_past_conversations", query: "bike", cursor: null, count: 20, archivedOnly: false });
    expect(decideToolCall({ id: "last-five", name: "list_past_conversations", args: { count: 5 } }, plan))
      .toMatchObject({ kind: "conversations", count: 5, query: "" });
    expect(decideToolCall({ id: "bad-count", name: "list_past_conversations", args: { count: 21 } }, plan).kind)
      .toBe("reject");
    expect(decideToolCall({ id: "read", name: "read_past_conversation", args: { conversation_id: id } }, plan))
      .toEqual({ kind: "conversationRead", id: "read", name: "read_past_conversation", conversationId: id,
        afterSeq: 0, count: 5, sessionId: null, from: null, to: null });
    expect(decideToolCall({ id: "resume", name: "continue_past_conversation", args: { conversation_id: id } }, plan))
      .toEqual({ kind: "conversationContinue", id: "resume", name: "continue_past_conversation", conversationId: id });
    expect(decideToolCall({ id: "wrong", name: "continue_past_conversation", args: { conversation_id: "invalid" } }, plan).kind)
      .toBe("reject");
    expect(decideToolCall({ id: "bad", name: "read_past_conversation", args: { conversation_id: "invalid" } }, plan).kind)
      .toBe("reject");
    expect(decideToolCall({ id: "bad-search", name: "list_past_conversations", args: { query: "x".repeat(161) } }, plan).kind)
      .toBe("reject");
  });

  it("validates and routes bounded semantic memory search", () => {
    expect(decideToolCall({ id: "s1", name: "search_memory", args: { query: "project details" } }, plan)).toEqual({
      kind: "memorySearch", id: "s1", name: "search_memory", query: "project details",
    });
    expect(decideToolCall({ id: "s2", name: "search_memory", args: { query: " " } }, plan).kind).toBe("reject");
  });

  it("requires a complete UIA locator and confirms changes", () => {
    const base = { window: "Untitled - Notepad", path: "0.1.0", name: "Editor",
      automationId: "Editor", controlType: 50004, action: "set-value", text: "Hello" };
    expect(decideToolCall({id:"target",name:"accessibility_pattern_action",args:base},plan)).toMatchObject({
      kind:"confirm",name:"accessibility_pattern_action",
    });
    expect(decideToolCall({id:"missing",name:"accessibility_pattern_action",
      args:{...base,path:"0..1"}},plan)).toMatchObject({kind:"reject"});
    expect(decideToolCall({id:"range",name:"accessibility_pattern_action",
      args:{...base,action:"set-range",number:Number.NaN}},plan)).toMatchObject({kind:"reject"});
  });

  it("keeps Windows monitoring explicitly opt-in and allows immediate stop", () => {
    expect(decideToolCall({id:"on",name:"start_accessibility_watch",args:{}},plan)).toMatchObject({
      kind:"confirm",name:"start_accessibility_watch",
    });
    expect(decideToolCall({id:"off",name:"stop_accessibility_watch",args:{}},plan)).toEqual({
      kind:"watchStop",id:"off",name:"stop_accessibility_watch",
    });
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

  it("routes an exact paired PC by ID or the saved default without changing the model tool", () => {
    const targetId = "00000000-0000-4000-8000-000000000001";
    expect(decideToolCall({
      id: "remote-id", name: "remote_action",
      args: { device_id: targetId, action: "open_app", argument: "calculator" },
    }, plan)).toMatchObject({ kind: "confirm", remote: { action: "open_app", device: targetId } });
    expect(decideToolCall({
      id: "remote-default", name: "remote_action",
      args: { action: "open_app", argument: "notepad" },
    }, plan)).toMatchObject({ kind: "confirm", remote: { action: "open_app", device: null } });
    expect(decideToolCall({
      id: "read-id", name: "read_remote_device",
      args: { device_id: targetId, kind: "active_window" },
    }, plan)).toMatchObject({ kind: "remote", device: targetId });
    expect(decideToolCall({
      id: "ambiguous-args", name: "remote_action",
      args: { device: "Laptop", device_id: targetId, action: "open_app", argument: "notepad" },
    }, plan)).toMatchObject({ kind: "reject", message: expect.stringContaining("either") });
    expect(decideToolCall({
      id: "invalid-id", name: "read_remote_device",
      args: { device_id: "../other", kind: "presence" },
    }, plan)).toMatchObject({ kind: "reject" });
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
    expect(decideToolCall({ id: "notes", name: "list_notes", args: {} }, plan)).toEqual({
      kind: "notes",
      id: "notes",
      name: "list_notes",
      includeArchived: false,
    });
    expect(decideToolCall({ id: "archived", name: "list_notes", args: { include_archived: true } }, plan)).toMatchObject({
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
    expect(decideToolCall({ id: "drop", name: "delete_note", args: {} }, plan)).toMatchObject({
      kind: "reject",
      message: "That id is required. List the items first and pass an id from that result.",
    });
    expect(decideToolCall({ id: "drop", name: "delete_note", args: { id: "n1" } }, plan)).toMatchObject({
      kind: "confirm",
      name: "delete_note",
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
    expect(decideToolCall({ id: "note", name: "create_note", args: { text: "Assistant tool test." } }, plan)).toMatchObject({
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
