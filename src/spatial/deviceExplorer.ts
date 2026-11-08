import type { NearbyDevice } from "@/spatial/spatialDevices";
import { nearbyGroup } from "@/spatial/spatialDevices";
import type { DeviceIdentity } from "@/spatial/deviceCapabilities";
import { availableNearbyActions, type NearbyAction } from "@/spatial/deviceActionRegistry";


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

/** Never label an advertisement as a controllable device. */
export interface DeviceReadiness {
  state: "ready" | "setup" | "unavailable" | "checking";
  label: string;
  hint: string;
  quickAction?: NearbyAction;
  quickLabel?: string;
}

export function deviceReadiness(
  device: NearbyDevice, identity: DeviceIdentity | null, inspecting: boolean,
): DeviceReadiness {
  if (device.pairedDeviceId) return {
    state: "ready", label: "Ready", hint: "Authenticated Personal Voice computer",
  };
  if (nearbyGroup(device.source) === "bluetooth") return {
    state: "setup", label: device.paired ? "Android paired" : "Bluetooth",
    hint: device.paired
      ? "Manage connection and audio output in Android Bluetooth settings"
      : "Pair through Android settings; Bluetooth discovery alone does not grant remote control",
  };
  if (!device.ipAddress) return {
    state: "unavailable", label: "Address unavailable",
    hint: "Service discovered without a usable local IP; rescan on the same Wi-Fi",
  };
  if (inspecting) return { state: "checking", label: "Identifying", hint: "Checking reachable services" };
  if (!identity) return {
    state: "unavailable", label: "Not verified",
    hint: "Device inspection failed. Retry from the device details",
  };
  const actions = availableNearbyActions(device, identity);
  if (actions.some(a => a.action === "pair")) {
    const paired = identity.lgPaired || identity.samsungPaired;
    if (!paired) return {
      state: "setup", label: "TV approval needed",
      hint: "Pair over Wi-Fi and approve the request on your TV",
      quickAction: "pair", quickLabel: "Pair",
    };
  }
  if (actions.some(a => a.action === "volume_up")) return {
    state: "ready", label: "Controls ready", hint: "Verified local volume and remote actions",
    quickAction: "volume_up", quickLabel: "Vol +",
  };
  if (actions.some(a => a.action === "play")) return {
    state: "ready", label: "Playback ready", hint: "Verified UPnP media actions",
    quickAction: "play", quickLabel: "Play",
  };
  if (actions.some(a => a.action === "open_roku_app")) return {
    state: "setup", label: "Roku app", hint: "Roku uses its official mobile remote; third-party ECP control is restricted",
    quickAction: "open_roku_app", quickLabel: "Roku app",
  };
  if (actions.some(a => a.action === "open_web")) return {
    state: "ready", label: "Web page", hint: "Reachable local device webpage; login may be required",
    quickAction: "open_web", quickLabel: "Open",
  };
  if (device.kind === "printer") return {
    state: "unavailable", label: "Printer discovered",
    hint: "IPP/printing service found, but no printer status or management endpoint was verified",
  };
  if (/roku/i.test(device.name + " " + identity.manufacturer)) return {
    state: "unavailable", label: "Roku discovered",
    hint: "No verified Roku companion endpoint. Roku mobile remote is available through its official app",
  };
  return {
    state: "unavailable", label: "Info only",
    hint: "No compatible and authorized control protocol was verified on this device",
  };
}
