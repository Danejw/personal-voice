import { callPlugin } from "@/platform/android/voicePlatformPlugin";
import type { NearbyDevice } from "@/spatial/spatialDevices";
import { isBluetoothSource } from "@/spatial/spatialDevices";
import type { DeviceIdentity } from "@/spatial/deviceCapabilities";

/** Normalized action names exposed to UI and Assistant. No device-supplied commands. */
export const NEARBY_ACTIONS = [
  "pair", "open_web", "volume_up", "volume_down", "get_volume",
  "mute", "unmute", "play", "pause", "home", "back",
  "up", "down", "left", "right", "select", "show_message",
  "bluetooth_settings", "open_roku_app",
] as const;
export type NearbyAction = typeof NEARBY_ACTIONS[number];

export type NearbyProtocol = "device-link" | "lg-webos" | "samsung-tizen" | "upnp" | "web" | "bluetooth" | "discovered" | "roku-companion";
export interface ActionDescriptor {
  readonly action: NearbyAction;
  readonly protocol: NearbyProtocol;
  /** Device-reported protocol support is separate from actual permission or effect. */
  readonly authorization: "none" | "tv-approval" | "paired-tv";
}

const SAMSUNG_KEYS: Partial<Record<NearbyAction, string>> = {
  volume_up: "KEY_VOLUP", volume_down: "KEY_VOLDOWN", mute: "KEY_MUTE",
  play: "KEY_PLAY", pause: "KEY_PAUSE",
  home: "KEY_HOME", back: "KEY_RETURN", up: "KEY_UP", down: "KEY_DOWN",
  left: "KEY_LEFT", right: "KEY_RIGHT", select: "KEY_ENTER",
};
const LG_ACTIONS: Partial<Record<NearbyAction, string>> = {
  volume_up: "volume_up", volume_down: "volume_down", get_volume: "get_volume",
  mute: "mute", unmute: "unmute", play: "play", pause: "pause",
  show_message: "show_message",
};

export function availableNearbyActions(device: NearbyDevice, identity: DeviceIdentity | null): ActionDescriptor[] {
  if (device.pairedDeviceId) return []; // The signed PC tools handle this separately.
  if (isBluetoothSource(device.source)) {
    return [{ action: "bluetooth_settings", protocol: "bluetooth", authorization: "none" }];
  }
  if (!device.ipAddress || !identity || identity.ipAddress !== device.ipAddress) return [];
  const list: ActionDescriptor[] = [];
  const add = (action: NearbyAction, protocol: NearbyProtocol, authorization: ActionDescriptor["authorization"]) => {
    if (!list.some(item => item.action === action)) list.push({ action, protocol, authorization });
  };
  const verified = new Set(identity.features);
  if (verified.has("open_web")) add("open_web", "web", "none");
  if (verified.has("roku_companion")) add("open_roku_app", "roku-companion", "none");
  if (verified.has("lg_remote") && identity.lgFingerprint) {
    const authorization = identity.lgPaired ? "paired-tv" : "tv-approval";
    add("pair", "lg-webos", authorization);
    for (const action of Object.keys(LG_ACTIONS) as NearbyAction[]) add(action, "lg-webos", authorization);
  } else if (verified.has("samsung_remote") && identity.samsungFingerprint) {
    const authorization = identity.samsungPaired ? "paired-tv" : "tv-approval";
    add("pair", "samsung-tizen", authorization);
    for (const action of Object.keys(SAMSUNG_KEYS) as NearbyAction[]) add(action, "samsung-tizen", authorization);
  }
  if (verified.has("volume")) {
    add("volume_up", "upnp", "none"); add("volume_down", "upnp", "none");
  }
  if (verified.has("playback")) {
    add("play", "upnp", "none"); add("pause", "upnp", "none");
  }
  return list;
}

/**
 * Executes only an action already mapped from native evidence. The native plugin
 * independently checks scanned IP, expiry, Wi-Fi subnet, pairing and device allowlists.
 */
export async function executeNearbyAction(
  device: NearbyDevice, identity: DeviceIdentity | null, action: NearbyAction,
): Promise<string> {
  const allowed = availableNearbyActions(device, identity).find(item => item.action === action);
  if (!allowed) throw new Error("This device did not verify that action. Refresh discovery.");
  if (allowed.protocol === "device-link") throw new Error("Use the authenticated Personal Voice PC tools.");
  if (action === "bluetooth_settings") {
    await callPlugin("open_nearby_bluetooth_settings");
    return "Opened Android Bluetooth settings. Connection or pairing is not verified.";
  }
  const ipAddress = device.ipAddress;
  if (!ipAddress) throw new Error("No verified network address.");
  if (action === "open_roku_app") {
    await callPlugin("open_nearby_roku_app", { ipAddress });
    return "Opened official Roku remote app or store page. Device control is handled by Roku.";
  }
  if (action === "open_web") {
    await callPlugin("open_nearby_web", { ipAddress });
    return "Opened device web page. Authentication and page content are not verified.";
  }
  if (action === "pair") {
    const fingerprint = allowed.protocol === "lg-webos" ? identity?.lgFingerprint : identity?.samsungFingerprint;
    if (!fingerprint) throw new Error("Missing TV certificate identity.");
    const command = allowed.protocol === "lg-webos" ? "pair_lg_tv" : "pair_samsung_tv";
    const response = await callPlugin<{message?: string}>(command, { ipAddress, fingerprint });
    return response?.message ?? "TV pairing response received.";
  }
  if (allowed.authorization === "tv-approval") {
    throw new Error("Pair with and approve this TV before sending remote keys.");
  }
  let command: string;
  let args: Record<string, string>;
  if (allowed.protocol === "lg-webos") {
    command = "lg_remote_action";
    args = { ipAddress, action: LG_ACTIONS[action]! };
  } else if (allowed.protocol === "samsung-tizen") {
    command = "samsung_remote_key";
    args = { ipAddress, key: SAMSUNG_KEYS[action]! };
  } else if (allowed.protocol === "upnp") {
    command = "nearby_media_action";
    args = { ipAddress, action };
  } else {
    throw new Error("No executable protocol for this action.");
  }
  const response = await callPlugin<{message?: string}>(command, args);
  return response?.message ?? "Device accepted the request; its physical state is not verified.";
}
