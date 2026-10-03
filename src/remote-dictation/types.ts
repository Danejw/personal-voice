export type RemoteDictationStatus = "pending" | "processing" | "inserted" | "failed";

export interface RemoteDictationRequest {
  id: string;
  userId: string;
  sourceDeviceId: string;
  targetDeviceId: string;
  text: string;
  status: RemoteDictationStatus;
  error: string | null;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
}

export function parseRemoteDictationRequest(value: unknown): RemoteDictationRequest | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const status = record.status;
  if (
    status !== "pending"
    && status !== "processing"
    && status !== "inserted"
    && status !== "failed"
  ) {
    return null;
  }
  if (
    typeof record.id !== "string"
    || typeof record.user_id !== "string"
    || typeof record.source_device_id !== "string"
    || typeof record.target_device_id !== "string"
    || typeof record.text !== "string"
    || typeof record.created_at !== "string"
    || typeof record.expires_at !== "string"
  ) {
    return null;
  }
  if (record.error !== null && record.error !== undefined && typeof record.error !== "string") return null;
  if (record.completed_at !== null && record.completed_at !== undefined && typeof record.completed_at !== "string") {
    return null;
  }
  return {
    id: record.id,
    userId: record.user_id,
    sourceDeviceId: record.source_device_id,
    targetDeviceId: record.target_device_id,
    text: record.text,
    status,
    error: typeof record.error === "string" ? record.error : null,
    createdAt: record.created_at,
    expiresAt: record.expires_at,
    completedAt: typeof record.completed_at === "string" ? record.completed_at : null,
  };
}

export function parseRemoteDictationList(value: unknown): RemoteDictationRequest[] {
  if (!Array.isArray(value)) return [];
  const rows: RemoteDictationRequest[] = [];
  for (const item of value) {
    const row = parseRemoteDictationRequest(item);
    if (row) rows.push(row);
  }
  return rows;
}
