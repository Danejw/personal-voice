import { playbookStep, type ToolPlaybook } from "@/assistant/harness/playbooks/types";

export const CONTENT_DELIVERY: ToolPlaybook = {
  id: "content_delivery",
  title: "Deliver text or a captured camera photo to the intended destination",
  platform: "all",
  useWhen: "A multi-step request specifies text or image content and where it should end up.",
  skipWhen: "User asks only to draft or explain content without moving it, or copy_text alone clearly suffices.",
  steps: [
    playbookStep("Identify artifact and destination", ["capture_selection", "capture_camera_photo"],
      "Only when requested content comes from selected text or a new camera photo; otherwise use supplied text.",
      "Exact intended payload is known."),
    playbookStep("Choose delivery operation", ["copy_text", "insert_text", "send_handoff", "send_remote_dictation"],
      "Choose one based on clipboard, active local field, other-device inbox, or remote focused field.",
      "Requested transfer or insertion is reported."),
    playbookStep("Find exact photo window before pasting", ["list_windows", "paste_camera_photo"],
      "Only when user explicitly asks to paste the most recently captured CAMERA image into a named Windows window.",
      "Photo image pasted into the exact destination window."),
    playbookStep("Check result where observable", ["read_remote_device", "inspect_active_app"],
      "Only if a permitted observation can confirm final destination state.",
      "End state observed or remaining uncertainty stated."),
  ],
  branches: [
    "A photo is an IMAGE; copy_text and insert_text operate on text only.",
    "If text must be made available to another device for later, use send_handoff instead of remote dictation.",
    "Do not claim a remote focused-field insertion was achieved by a handoff.",
    "Pasting a camera photo does not submit the message in the destination app.",
  ],
  recovery: [
    "If current focus or destination is unknown, resolve it before writing.",
    "If only delivery acknowledgement is available, report that rather than asserting a full end-state verification.",
  ],
  completion: ["Exactly the intended content reaches the intended destination by the requested method."],
};
