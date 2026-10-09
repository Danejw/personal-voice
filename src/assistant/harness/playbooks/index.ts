import { CAMERA_CONTEXT } from "@/assistant/harness/playbooks/cameraContext";
import { CONTENT_DELIVERY } from "@/assistant/harness/playbooks/contentDelivery";
import { CROSS_DEVICE } from "@/assistant/harness/playbooks/crossDevice";
import { MEMORY_RECALL } from "@/assistant/harness/playbooks/memoryRecall";
import { NOTES_WORKFLOW } from "@/assistant/harness/playbooks/notesWorkflow";
import { SCREEN_UNDERSTANDING } from "@/assistant/harness/playbooks/screenUnderstanding";
import { WINDOWS_CONTROL } from "@/assistant/harness/playbooks/windowsControl";
import type { ToolPlaybook } from "@/assistant/harness/playbooks/types";

export const TOOL_PLAYBOOK_IDS = [
  "screen_understanding",
  "windows_control",
  "notes_workflow",
  "memory_recall",
  "cross_device",
  "content_delivery",
  "camera_context",
] as const;

export type ToolPlaybookId = (typeof TOOL_PLAYBOOK_IDS)[number];

const PLAYBOOKS: Readonly<Record<ToolPlaybookId, ToolPlaybook>> = {
  screen_understanding: SCREEN_UNDERSTANDING,
  windows_control: WINDOWS_CONTROL,
  notes_workflow: NOTES_WORKFLOW,
  memory_recall: MEMORY_RECALL,
  cross_device: CROSS_DEVICE,
  content_delivery: CONTENT_DELIVERY,
  camera_context: CAMERA_CONTEXT,
};

export function isToolPlaybookId(value: unknown): value is ToolPlaybookId {
  return typeof value === "string" && TOOL_PLAYBOOK_IDS.some((id) => id === value);
}

/** Return a local, bounded reference playbook without side effects or a model call. */
export function loadToolPlaybook(id: ToolPlaybookId): ToolPlaybook {
  return PLAYBOOKS[id];
}

/** Small tool response for Gemini Live; no personal data, command execution, or permission changes. */
export function playbookToolText(id: ToolPlaybookId): string {
  const playbook = loadToolPlaybook(id);
  return JSON.stringify({
    kind: "tool_playbook",
    id: playbook.id,
    title: playbook.title,
    platform: playbook.platform,
    use_when: playbook.useWhen,
    skip_when: playbook.skipWhen,
    steps: playbook.steps.map((step) => ({
      goal: step.goal,
      tools: step.tools,
      when: step.when,
      outcome: step.outcome,
    })),
    branches: playbook.branches,
    recovery: playbook.recovery,
    completion: playbook.completion,
    note: "This is reference guidance, not a request to execute tools. Apply only the relevant steps to the current user request and observed device state. Existing tool confirmations and permissions still apply. Do not claim success without evidence.",
  });
}

/**
 * Progressive disclosure: keep long procedures out of every Live socket setup.
 * Simple / single-tool requests should call their tool directly.
 */
export const ASSISTANT_PLAYBOOK_GUIDANCE =
  "Seven optional tool playbooks are available via get_tool_playbook: screen_understanding, windows_control, notes_workflow, memory_recall, cross_device, content_delivery, camera_context. Use one only when a request is genuinely multi-step or tool choices/dependencies are uncertain. For routine single-tool actions, answer or use the tool directly without this extra call. Get at most the relevant playbook, then apply only steps needed for the actual task. The playbook describes tools but cannot execute them and is not evidence the objective was reached. Do not retrieve playbooks repeatedly in the same task.";
