import { playbookStep, type ToolPlaybook } from "@/assistant/harness/playbooks/types";

export const SCREEN_UNDERSTANDING: ToolPlaybook = {
  id: "screen_understanding",
  title: "Understand a screen, selection, or pointed target",
  platform: "all",
  useWhen: "A request refers to currently visible content, selected text, or what the user points to.",
  skipWhen: "Answerable from the user's words alone; do not take a screenshot unnecessarily.",
  steps: [
    playbookStep("Resolve referent", ["inspect_pointer_context", "capture_selection"],
      "For 'this/that under my cursor', prefer pointer context on Windows. For highlighted text, capture selection.",
      "Exact pointed element or selected text identified, or limitation made explicit."),
    playbookStep("Obtain visual evidence", ["capture_pointer_target", "capture_screen"],
      "Only if target inspection lacks sufficient visual detail, or user asks to see screen; capture a fresh still.",
      "Current marked target or full-screen image attached."),
    playbookStep("Read accessible text if appropriate", ["inspect_active_app", "inspect_accessibility_tree"],
      "Text-rich Windows foreground app or specific control requires accessibility metadata.",
      "Observed text/control details available without guessing."),
    playbookStep("Explain observed result", [], "Always after gathering sufficient evidence.",
      "Answer matches actual screen/selection evidence and its capture time."),
  ],
  branches: [
    "Pointer status 'position-only' or inaccessible graphics: use capture_pointer_target, not a guessed label.",
    "If the user requests the whole screen, use capture_screen directly; skip pointer inspection.",
    "If the user asks to look through the camera instead, use capture_camera_photo or start_camera_context as explicitly requested.",
  ],
  recovery: [
    "If accessibility inspection gives no useful data, request a fresh visual snapshot using the appropriate screen tool.",
    "If the screen changed between observations, capture a new still before describing its current state.",
  ],
  completion: ["Reference a specific observed element or image; clearly mark anything not visible or accessible."],
};
