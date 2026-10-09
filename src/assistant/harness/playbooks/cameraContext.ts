import { playbookStep, type ToolPlaybook } from "@/assistant/harness/playbooks/types";

export const CAMERA_CONTEXT: ToolPlaybook = {
  id: "camera_context",
  title: "Use one camera photo versus ongoing camera context",
  platform: "all",
  useWhen: "A task combines looking through a device camera, describing content, and optionally pasting a photo.",
  skipWhen: "User refers to pixels shown on the screen rather than the device camera.",
  steps: [
    playbookStep("Choose capture mode", ["capture_camera_photo", "start_camera_context"],
      "Use one still for take/photo/look once, continuous context only when explicitly requested.",
      "Correct camera mode and facing are active."),
    playbookStep("Explain what was observed", [], "After model receives the actual camera image or frames.",
      "Grounded description without inventing off-frame content."),
    playbookStep("Paste a camera photo into a Windows destination", ["list_windows", "paste_camera_photo"],
      "Only if user asks to paste the most recent camera photo and exact window can be found.",
      "Photo pasted, without auto-submitting other actions."),
    playbookStep("Turn off continuous context", ["stop_camera_context"],
      "When user asks to stop looking through camera or is done with ongoing context.",
      "Camera context ends while Assistant remains active."),
  ],
  branches: [
    "A camera image is not a screenshot; use capture_screen if user asks about desktop contents.",
    "Single still capture does not start background camera streaming.",
    "Camera facing can be requested as default/front/back using existing tool schemas.",
  ],
  recovery: [
    "If camera access fails, report the device error rather than substituting the screen.",
    "If the most recent camera photo is missing, capture a new one only if that matches user intent.",
  ],
  completion: ["The requested camera mode, result, and eventual stop state match the user's instructions."],
};
