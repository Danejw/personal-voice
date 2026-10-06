import type { TableRow } from "@/types/database";
import type { NoteAttachment } from "@/notes/noteAttachment";

export type NoteStatus = "inbox" | "archived";
export type NoteSourceType = "voice" | "manual" | "assistant";
export type NoteOrganizationSource = "auto" | "manual";

export interface Note {
  id: string;
  text: string;
  title: string | null;
  titleSource: NoteOrganizationSource | null;
  groupId: string | null;
  groupSource: NoteOrganizationSource | null;
  organizedAt: string | null;
  sourceDeviceId: string;
  sourceType: NoteSourceType;
  status: NoteStatus;
  createdAt: string;
  updatedAt: string;
  attachments: NoteAttachment[];
}

type NoteRow = Pick<
  TableRow<"notes">,
  "id" | "text" | "title" | "title_source" | "group_id" | "group_source" | "organized_at" | "source_device_id" | "source_type" | "status" | "created_at" | "updated_at"
>;

/** Converts the database row at the service boundary and rejects unknown future values. */
export function noteFromRow(row: NoteRow): Note {
  if (row.status !== "inbox" && row.status !== "archived") {
    throw new Error("The notes service returned an unsupported note status.");
  }
  if (row.source_type !== "voice" && row.source_type !== "manual" && row.source_type !== "assistant") {
    throw new Error("The notes service returned an unsupported note source.");
  }
  if (row.title_source !== null && row.title_source !== "auto" && row.title_source !== "manual") {
    throw new Error("The notes service returned an unsupported title source.");
  }
  if (row.group_source !== null && row.group_source !== "auto" && row.group_source !== "manual") {
    throw new Error("The notes service returned an unsupported group source.");
  }
  return {
    id: row.id,
    text: row.text,
    title: row.title,
    titleSource: row.title_source,
    groupId: row.group_id,
    groupSource: row.group_source,
    organizedAt: row.organized_at,
    sourceDeviceId: row.source_device_id,
    sourceType: row.source_type,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attachments: [],
  };
}
