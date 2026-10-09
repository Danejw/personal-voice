import { playbookStep, type ToolPlaybook } from "@/assistant/harness/playbooks/types";

export const NOTES_WORKFLOW: ToolPlaybook = {
  id: "notes_workflow",
  title: "Find, create, edit, attach images, archive, restore, or delete saved notes",
  platform: "all",
  useWhen: "User requests multiple steps involving saved notes or must identify a note by name/content before editing.",
  skipWhen: "The user supplies a complete new note to save; call create_voice_note directly without playbook lookup.",
  steps: [
    playbookStep("Identify operation", ["list_voice_notes"],
      "List existing notes when an ID or status is needed. Include archived notes for restoration.",
      "Correct note and exact ID identified, or no match reported."),
    playbookStep("Choose exactly one note operation", ["create_voice_note", "edit_voice_note", "attach_image_to_voice_note", "archive_voice_note", "restore_voice_note", "delete_voice_note"],
      "Only the operation explicitly requested by the user; existing confirmation behavior remains unchanged.",
      "Target service reports the operation's result."),
    playbookStep("Check saved state when needed", ["list_voice_notes"],
      "When a changed note must be verified or multiple similar matches exist.",
      "Correct note text/archive state shown, or discrepancy described."),
  ],
  branches: [
    "A new note is create_voice_note; editing an existing one requires an ID from list_voice_notes.",
    "edit_voice_note replaces the complete note text; do not accidentally discard unspecified content.",
    "For new notes, capture_screen or capture_camera_photo first, then set attachment_source on create_voice_note.",
    "For existing notes without text edits, capture a still then attach_image_to_voice_note using the id from list_voice_notes. Attaching image pixels always needs confirmation.",
    "Archive, restore and permanent delete are different operations. Do not substitute one for another.",
    "The manual Notes UI supports metadata that the create_voice_note tool does not accept.",
  ],
  recovery: [
    "If a matching title is ambiguous, inspect the listed notes and clarify which is intended before changing one.",
    "If a note ID is stale or missing, refresh list_voice_notes once instead of guessing another ID.",
  ],
  completion: ["Confirm the specific requested note operation, not merely that the tool returned."],
};
