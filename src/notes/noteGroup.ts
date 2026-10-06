import type { TableRow } from "@/types/database";

export interface NoteGroup {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

type NoteGroupRow = Pick<
  TableRow<"note_groups">,
  "id" | "name" | "created_at" | "updated_at"
>;

export function noteGroupFromRow(row: NoteGroupRow): NoteGroup {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
