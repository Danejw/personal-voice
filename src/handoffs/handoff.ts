import type { TableRow } from "@/types/database";

export interface OwnedDevice {
  id: string;
  name: string;
  platform: string;
  lastSeen: string | null;
}

export interface Handoff {
  id: string;
  text: string;
  sourceDeviceId: string;
  targetDeviceId: string | null;
  createdAt: string;
  consumedAt: string | null;
}

type HandoffRow = Pick<
  TableRow<"handoffs">,
  "id" | "text" | "source_device_id" | "target_device_id" | "created_at" | "consumed_at"
>;

type DeviceRow = Pick<TableRow<"devices">, "id" | "name" | "platform" | "last_seen">;

export function handoffFromRow(row: HandoffRow): Handoff {
  return {
    id: row.id,
    text: row.text,
    sourceDeviceId: row.source_device_id,
    targetDeviceId: row.target_device_id,
    createdAt: row.created_at,
    consumedAt: row.consumed_at,
  };
}

export function ownedDeviceFromRow(row: DeviceRow): OwnedDevice {
  return { id: row.id, name: row.name, platform: row.platform, lastSeen: row.last_seen };
}
