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

/**
 * Picks the device a handoff would use. `devices` is the other devices on the
 * account, not this one. A requested name wins. Otherwise the saved target is used.
 */
export function resolveHandoffDevice(
  devices: readonly { id: string; name: string }[],
  selectedDeviceId: string | null,
  requestedName: string | null,
): { id: string; name: string } | { error: string } {
  const name = requestedName?.trim() ?? "";
  if (name) {
    const needle = name.toLocaleLowerCase();
    const matches = devices.filter((device) => device.name.toLocaleLowerCase() === needle);
    const match = matches[0];
    if (matches.length === 1 && match) return { id: match.id, name: match.name };
    if (matches.length === 0) return { error: `No other device is named ${name}.` };
    return { error: `More than one device is named ${name}.` };
  }
  const selected = devices.find((device) => device.id === selectedDeviceId);
  if (!selected) return { error: "Choose a device in Handoffs first." };
  return { id: selected.id, name: selected.name };
}
