import { callPlugin } from "@/platform/android/voicePlatformPlugin";
import type { OwnedDevice } from "@/handoffs/handoff";
import {
  mergePersonalVoicePeers, parseNearbyScan, type NearbyDevice, type NearbyScan,
} from "@/spatial/spatialDevices";
import { consolidateNearbyDevices, parseDeviceIdentity, type DeviceIdentity } from "@/spatial/deviceCapabilities";
import { availableNearbyActions, executeNearbyAction, type NearbyAction } from "@/spatial/deviceActionRegistry";
import { isUnidentifiedBluetooth, listDevices } from "@/spatial/deviceExplorer";

const SCAN_TTL_MS = 180_000;
const INSPECT_LIMIT = 9;
const REPORT_LIMIT = 28;

/**
 * One ephemeral inventory shared by the Android device screen and Live Assistant.
 * No cloud storage, no guessed Bluetooth -> Wi-Fi mapping, no hidden scans.
 */
export class NearbyCapabilityService {
  private discoveredAt = 0;
  private devices: NearbyDevice[] = [];
  private identities = new Map<string, DeviceIdentity>();
  private scanPromise: Promise<NearbyScan> | null = null;

  async scan(owned: readonly OwnedDevice[], currentDeviceId: string, peers: readonly string[]): Promise<NearbyScan> {
    if (this.scanPromise) return this.scanPromise;
    this.scanPromise = (async () => {
      const scan = parseNearbyScan(await callPlugin<unknown>("scan_nearby_devices"));
      const devices = consolidateNearbyDevices(
        mergePersonalVoicePeers(scan.devices, peers, owned, currentDeviceId),
      );
      this.devices = devices;
      this.identities.clear();
      this.discoveredAt = Date.now();
      return scan;
    })().finally(() => { this.scanPromise = null; });
    return this.scanPromise;
  }

  /** Native code still validates recent scan, private address, current Wi-Fi and protocol. */
  async inspect(ipAddress: string): Promise<DeviceIdentity> {
    if (!this.fresh() || !this.devices.some(device => device.ipAddress === ipAddress)) {
      throw new Error("Scan the network again before identifying that device.");
    }
    const cached = this.identities.get(ipAddress);
    if (cached) return cached;
    const result = parseDeviceIdentity(
      await callPlugin<unknown>("inspect_nearby_device", { ipAddress }), ipAddress,
    );
    this.identities.set(ipAddress, result);
    return result;
  }

  /** Build the approval card from the actual current scan, not an untrusted model label. */
  async preview(id: string, action: NearbyAction): Promise<string> {
    if (!this.fresh()) throw new Error("Discovery expired. Scan nearby devices again.");
    const device = this.devices.find(item => item.id === id);
    if (!device) throw new Error("The device was not returned by the most recent scan.");
    const identity = device.ipAddress ? await this.inspect(device.ipAddress) : null;
    const capability = availableNearbyActions(device, identity).find(item => item.action === action);
    if (!capability) throw new Error("This device does not verify that action.");
    const label = (identity?.name && !identity.name.startsWith("Device ")
      ? identity.name : device.name).slice(0, 72);
    const target = device.ipAddress ? " (" + device.ipAddress + ")" : "";
    const approval = capability.authorization === "tv-approval"
      ? " TV approval or pairing is also required." : "";
    return action.replace(/_/g, " ") + " on " + label + target +
      " using " + capability.protocol + "." + approval;
  }

  /** Requires exact ID from latest inventory, not a name or invented device address. */
  async act(id: string, action: NearbyAction): Promise<string> {
    if (!this.fresh()) throw new Error("Discovery expired. Scan nearby devices again.");
    const device = this.devices.find(item => item.id === id);
    if (!device) throw new Error("Device ID was not returned by the latest nearby scan.");
    const identity = device.ipAddress ? await this.inspect(device.ipAddress) : null;
    const actions = availableNearbyActions(device, identity);
    if (!actions.some(item => item.action === action)) {
      throw new Error("The requested action is not supported or verified for that device.");
    }
    const reply = await executeNearbyAction(device, identity, action);
    // A successful pairing changes authorization; always re-inspect before future actions.
    if (action === "pair" && device.ipAddress) this.identities.delete(device.ipAddress);
    return reply;
  }

  async describe(owned: readonly OwnedDevice[], currentDeviceId: string, peers: readonly string[]): Promise<string> {
    const scan = await this.scan(owned, currentDeviceId, peers);
    const candidates = listDevices(this.devices, "all", "", false).items;
    const withIp = candidates.filter(device => device.ipAddress).slice(0, INSPECT_LIMIT);
    // Inspect small concurrent batches; do not flood TVs or delay a Live turn for 30+ radios.
    for (let offset = 0; offset < withIp.length; offset += 3) {
      await Promise.all(withIp.slice(offset, offset + 3).map(async device => {
        try { await this.inspect(device.ipAddress!); }
        catch { /* Mark inspection failure explicitly in the returned inventory. */ }
      }));
    }
    const items = candidates.slice(0, REPORT_LIMIT).map(device => {
      const identity = device.ipAddress ? this.identities.get(device.ipAddress) ?? null : null;
      const actions = availableNearbyActions(device, identity);
      return {
        id: device.id,
        name: identity?.name && !identity.name.startsWith("Device ") ? identity.name : device.name,
        kind: device.kind,
        source: device.source,
        ip: device.ipAddress ?? null,
        identification: device.ipAddress
          ? (identity ? "inspected" : withIp.some(item => item.ipAddress === device.ipAddress)
            ? "inspection_failed" : "not_inspected")
          : "advertisement_only",
        manufacturer: identity?.manufacturer || null,
        model: identity?.model || null,
        actions: actions.map(item => ({
          name: item.action, protocol: item.protocol, authorization: item.authorization,
        })),
        ...(device.pairedDeviceId ? {paired_personal_voice_pc: true,
          note: "Use authenticated remote_action for this PC, not generic LAN controls."} : {}),
      };
    });
    return JSON.stringify({
      observed: "fresh_android_local_scan",
      scope: scan.networkLabel,
      total_discovered: this.devices.length,
      unnamed_bluetooth_not_listed: this.devices.filter(isUnidentifiedBluetooth).length,
      returned: items.length,
      inspected_network_hosts: withIp.length,
      incomplete_inventory: candidates.length > REPORT_LIMIT,
      device_actions_require_user_confirmation: true,
      note: "Actions reflect verified local protocol evidence; TV authorization and execution are separate. No action was executed. 'not_inspected' never implies support. An acknowledgement is not proof of physical effect.",
      devices: items,
    });
  }

  private fresh(): boolean {
    return this.discoveredAt > 0 && Date.now() - this.discoveredAt < SCAN_TTL_MS;
  }
}

export const nearbyCapabilityService = new NearbyCapabilityService();
