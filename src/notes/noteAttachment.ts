import type { TableRow } from "@/types/database";

export const NOTE_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;

export interface NoteAttachment {
  id: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  storagePath: string;
  downloadUrl: string;
  createdAt: string;
}

type NoteAttachmentRow = Pick<
  TableRow<"note_attachments">,
  "id" | "file_name" | "mime_type" | "size_bytes" | "storage_path" | "created_at"
>;

export function noteAttachmentFromRow(row: NoteAttachmentRow, downloadUrl: string): NoteAttachment {
  return {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    storagePath: row.storage_path,
    downloadUrl,
    createdAt: row.created_at,
  };
}

export function attachmentKind(attachment: Pick<NoteAttachment, "mimeType" | "fileName">): "image" | "video" | "audio" | "pdf" | "file" {
  const type = attachment.mimeType?.toLocaleLowerCase() ?? "";
  const name = attachment.fileName.toLocaleLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  return "file";
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
}
