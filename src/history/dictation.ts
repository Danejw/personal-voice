import type { TableRow } from "@/types/database";
import { migrateDestinationId, type TranscriptDestinationId } from "@/voice/transcript/TranscriptDestination";

/** One finalized dictation stored for the account. Final text only. */
export interface DictationRecord {
  id: string;
  text: string;
  destination: TranscriptDestinationId;
  outcome: "success" | "failure";
  sourceDeviceId: string;
  createdAt: string;
}

type DictationRow = Pick<
  TableRow<"dictations">,
  "id" | "text" | "destination" | "outcome" | "source_device_id" | "created_at"
>;

/** Converts the database row at the service boundary and rejects unknown future values. */
export function dictationFromRow(row: DictationRow): DictationRecord {
  const destination = migrateDestinationId(row.destination);
  if (!destination) {
    throw new Error("The dictations service returned an unsupported destination.");
  }
  if (row.outcome !== "success" && row.outcome !== "failure") {
    throw new Error("The dictations service returned an unsupported outcome.");
  }
  return {
    id: row.id,
    text: row.text,
    destination,
    outcome: row.outcome,
    sourceDeviceId: row.source_device_id,
    createdAt: row.created_at,
  };
}
