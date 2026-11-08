import type { NearbyDevice } from "@/spatial/spatialDevices";
import { nearbyGroup } from "@/spatial/spatialDevices";

export type DeviceView = "network" | "bluetooth" | "all";

export function isUnidentifiedBluetooth(device: NearbyDevice): boolean {
  return nearbyGroup(device.source) === "bluetooth" &&
    (device.name === "Bluetooth device" || device.name === "Bluetooth LE device");
}

export function deviceSubtitle(device: NearbyDevice): string {
  if (device.pairedDeviceId) return "Personal Voice · Connected";
  if (device.ipAddress) return device.ipAddress + " · " + device.detail;
  if (device.paired) return "Bluetooth · Paired";
  if (device.signalDbm !== undefined) return "Bluetooth · " + device.signalDbm + " dBm";
  return device.source === "mdns" ? "Network service · " + device.detail : device.detail;
}

function priority(device: NearbyDevice): number {
  if (device.pairedDeviceId) return 0;
  if (device.ipAddress && /Samsung|LG|TV|Cast/i.test(device.name)) return 1;
  if (device.paired) return 2;
  if (device.ipAddress) return 3;
  if (!isUnidentifiedBluetooth(device)) return 4;
  return 5;
}

/** The inventory is prioritized for action, without hiding identifiable devices. */
export function listDevices(
  devices: readonly NearbyDevice[], view: DeviceView, query: string, showUnidentified: boolean,
): { items: NearbyDevice[]; matches: number; hiddenCount: number } {
  const search = query.trim().toLocaleLowerCase();
  const matching = devices.filter(device =>
    (view === "all" || nearbyGroup(device.source) === view) &&
    (!search || device.name.toLocaleLowerCase().includes(search) ||
      device.ipAddress?.includes(search) ||
      device.detail.toLocaleLowerCase().includes(search)),
  );
  const hiddenCount = matching.filter(isUnidentifiedBluetooth).length;
  const items = matching.filter(device => showUnidentified || !isUnidentifiedBluetooth(device))
    .sort((a, b) => priority(a) - priority(b) || a.name.localeCompare(b.name));
  return { items, matches: matching.length, hiddenCount };
}
