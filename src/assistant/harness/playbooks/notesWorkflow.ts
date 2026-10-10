import { playbookStep, type ToolPlaybook } from "@/assistant/harness/playbooks/types";

export const NOTES_WORKFLOW: ToolPlaybook = {
  id: "notes_workflow",
  title: "Find, create, edit, attach files, archive, restore, or delete saved notes",
  platform: "all",
  useWhen: "User requests multiple steps involving saved notes or must identify a note by name/content before editing.",
  skipWhen: "The user supplies a complete new note to save; call create_note directly without playbook lookup.",
  steps: [
    playbookStep("Identify operation", ["list_notes"],
      "List existing notes when an ID or status is needed. Include archived notes for restoration.",
      "Correct note and exact ID identified, or no match reported."),
    playbookStep("Choose exactly one note operation", ["create_note", "edit_note", "attach_file_to_note", "archive_note", "restore_note", "delete_note"],
      "Only the operation explicitly requested by the user; existing confirmation behavior remains unchanged.",
      "Target service reports the operation's result."),
    playbookStep("Check saved state when needed", ["list_notes"],
      "When a changed note must be verified or multiple similar matches exist.",
      "Correct note text/archive state shown, or discrepancy described."),
  ],
  branches: [
    "A new note is create_note; editing an existing one requires an ID from list_notes.",
    "edit_note replaces the complete note text; do not accidentally discard unspecified content.",
    "For new notes, capture_screen or capture_camera_photo first, or have the user select a local file in Assistant; set attachment_source screenshot, camera_photo, or selected_file on create_note.",
    "For existing notes without text edits, capture a still or use the user-selected file, then call attach_file_to_note with the exact id from list_notes. Every file upload requires confirmation.",
    "Archive, restore and permanent delete are different operations. Do not substitute one for another.",
    "The manual Notes UI supports metadata that the create_note tool does not accept.",
  ],
  recovery: [
    "If a matching title is ambiguous, inspect the listed notes and clarify which is intended before changing one.",
    "If a note ID is stale or missing, refresh list_notes once instead of guessing another ID.",
  ],
  completion: ["Confirm the specific requested note operation, not merely that the tool returned."],
};
