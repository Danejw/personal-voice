import type { TableRow } from "@/types/database";

export type NoteStatus = "inbox" | "archived";
export type NoteSourceType = "voice" | "manual" | "assistant";

export interface Note {
  id: string;
  text: string;
  sourceDeviceId: string;
  sourceType: NoteSourceType;
  status: NoteStatus;
  createdAt: string;
  updatedAt: string;
}

type NoteRow = Pick<
  TableRow<"notes">,
  "id" | "text" | "source_device_id" | "source_type" | "status" | "created_at" | "updated_at"
>;

/** Converts the database row at the service boundary and rejects unknown future values. */
export function noteFromRow(row: NoteRow): Note {
  if (row.status !== "inbox" && row.status !== "archived") {
    throw new Error("The notes service returned an unsupported note status.");
  }
  if (row.source_type !== "voice" && row.source_type !== "manual" && row.source_type !== "assistant") {
    throw new Error("The notes service returned an unsupported note source.");
  }
  return {
    id: row.id,
    text: row.text,
    sourceDeviceId: row.source_device_id,
    sourceType: row.source_type,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
