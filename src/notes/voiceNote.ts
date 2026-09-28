import type { TableRow } from "@/types/database";

export type VoiceNoteStatus = "inbox" | "archived";

export interface VoiceNote {
  id: string;
  text: string;
  sourceDeviceId: string;
  status: VoiceNoteStatus;
  createdAt: string;
  updatedAt: string;
}

type VoiceNoteRow = Pick<
  TableRow<"voice_notes">,
  "id" | "text" | "source_device_id" | "status" | "created_at" | "updated_at"
>;

/** Converts the database row at the service boundary and rejects unknown future statuses. */
export function voiceNoteFromRow(row: VoiceNoteRow): VoiceNote {
  if (row.status !== "inbox" && row.status !== "archived") {
    throw new Error("The notes service returned an unsupported note status.");
  }
  return {
    id: row.id,
    text: row.text,
    sourceDeviceId: row.source_device_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
