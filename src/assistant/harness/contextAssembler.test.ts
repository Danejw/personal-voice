import { describe, expect, it } from "vitest";
import {
  assembleTaskGuidance,
  deviceToolGuidance,
  selectTaskPlaybook,
  UNKNOWN_DEVICE_CONTEXT,
  type AssistantTaskContext,
} from "@/assistant/harness/contextAssembler";
import { TOOL_PLAYBOOK_IDS } from "@/assistant/harness/playbooks";

const windows: AssistantTaskContext = {
  platform: "windows", otherDeviceCount: 2,
  selectionAttached: false, screenAttached: false, cameraContextActive: false,
};
const android: AssistantTaskContext = { ...windows, platform: "android" };

describe("context-aware assistant harness", () => {
  it("only claims device capabilities derived from the platform and synced inventory", () => {
    expect(deviceToolGuidance(UNKNOWN_DEVICE_CONTEXT)).toBeNull();
    const win = deviceToolGuidance(windows) ?? "";
    expect(win).toContain("Windows");
    expect(win).toContain("UI Automation");
    expect(win).toContain("2 other registered devices");
    expect(win).toContain("online status and capabilities are not verified");
    expect(win).toContain("Existing approval settings still apply.");
    const mobile = deviceToolGuidance(android) ?? "";
    expect(mobile).toContain("Android");
    expect(mobile).toContain("not available here");
    expect(mobile).not.toContain("This device is Windows");
    expect(deviceToolGuidance({ platform: "android", otherDeviceCount: 0 })).toContain("no other registered devices");
    expect(deviceToolGuidance({ platform: "windows", otherDeviceCount: null })).toContain("not known");
    expect(deviceToolGuidance({ platform: "android", otherDeviceCount: -2 })).toContain("not known");
  });

  it("does not load guidance for simple single-tool turns or ordinary conversation", () => {
    for (const request of [
      "Copy these words",
      "Save this as a note",
      "What's on my screen?",
      "What is 14 times 3?",
      "Hello, how are you?",
      "Take a camera photo",
      "Open Notepad",
      "What does async mean?",
    ]) {
      expect(assembleTaskGuidance(request, windows), request).toBeNull();
    }
    expect(assembleTaskGuidance("Type a note", android)).toBeNull();
  });

  it.each([
    ["Find our earlier conversation about keyboards and continue it", "memory_recall"],
    ["Find the archived note and then restore it", "notes_workflow"],
    ["Take a screenshot and add it to a note", "notes_workflow"],
    ["Attach my PDF file to the research note", "notes_workflow"],
    ["Open Notepad and then click the Save button", "windows_control"],
    ["Look at my screenshot then check what's under the pointer", "screen_understanding"],
    ["Send this message to the other device and then type it there", "cross_device"],
    ["Copy the selected text and then paste it into a field", "content_delivery"],
    ["Take a camera photo and then show me what is in it", "camera_context"],
  ] as const)("selects relevant brief guidance for '%s'", (request, expected) => {
    const guide = assembleTaskGuidance(request, windows);
    expect(guide?.playbookId).toBe(expected);
    expect(guide?.text).toContain(expected);
    expect(guide?.text).toContain("not user content");
    expect(guide?.text).toContain("optional");
    expect(guide?.text.length).toBeLessThan(800);
  });

  it("does not suggest Windows UI execution on Android", () => {
    expect(selectTaskPlaybook("Open Notepad and then click the Save button", android))
      .not.toBe("windows_control");
    expect(deviceToolGuidance(android)).toContain("remote-device tools");
  });

  it("uses attachments as known state, never copies untrusted request data into guidance", () => {
    const request = "Look at my screenshot then check what's under the pointer. SECRET-PHRASE-123";
    const withSelection = assembleTaskGuidance(request, { ...windows, selectionAttached: true });
    expect(withSelection?.text).toContain("selection attached");
    expect(withSelection?.text).not.toContain("SECRET-PHRASE-123");
    const withScreen = assembleTaskGuidance(request, { ...windows, screenAttached: true });
    expect(withScreen?.text).toContain("screenshot is already attached");
    const withCamera = assembleTaskGuidance("Take a camera photo and then explain it",
      { ...windows, cameraContextActive: true });
    expect(withCamera?.text).toContain("already active");
    expect(assembleTaskGuidance("What does my secret mean?", windows)).toBeNull();
  });

  it("never introduces unknown tool playbooks or additional tool calls", () => {
    for (const request of [
      "Find an older thread then read it", "Find a note and then edit it",
      "Open Calculator then navigate to my other window", "Copy the message then send it",
    ]) {
      const result = assembleTaskGuidance(request, windows);
      if (!result) continue;
      expect(TOOL_PLAYBOOK_IDS).toContain(result.playbookId);
      expect(result.text).not.toContain("execute(");
      expect(result.text).not.toContain("run_shell");
    }
  });
});
