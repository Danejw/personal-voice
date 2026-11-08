import { useEffect, useState } from "react";
import { callPlugin } from "@/platform/android/voicePlatformPlugin";
import { parseDeviceIdentity, type DeviceIdentity } from "@/spatial/deviceCapabilities";
import type { NearbyDevice } from "@/spatial/spatialDevices";
import { isBluetoothSource } from "@/spatial/spatialDevices";

interface Props {
  device: NearbyDevice;
  onControlPc(id: string): void;
}

interface ActionResult { message?: string }
const remoteKeys = [
  ["Home", "KEY_HOME"], ["Back", "KEY_RETURN"], ["Up", "KEY_UP"],
  ["Left", "KEY_LEFT"], ["OK", "KEY_ENTER"], ["Right", "KEY_RIGHT"],
  ["Volume −", "KEY_VOLDOWN"], ["Down", "KEY_DOWN"], ["Volume +", "KEY_VOLUP"],
  ["Mute", "KEY_MUTE"], ["Play", "KEY_PLAY"], ["Pause", "KEY_PAUSE"],
] as const;

export function DeviceActions({ device, onControlPc }: Props) {
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [inspectAttempt, setInspectAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const ip = device.ipAddress;

  useEffect(() => {
    let cancelled = false;
    setIdentity(null);
    setRemoteOpen(false);
    setNotice(null);
    setFailure(null);
    if (!ip) return;
    setInspecting(true);
    void callPlugin<unknown>("inspect_nearby_device", { ipAddress: ip })
      .then(value => {
        const next = parseDeviceIdentity(value, ip);
        if (!cancelled) setIdentity(next);
      })
      .catch(reason => {
        if (!cancelled) setFailure(reason instanceof Error ? reason.message : "Could not identify device.");
      })
      .finally(() => { if (!cancelled) setInspecting(false); });
    return () => { cancelled = true; };
  }, [ip, inspectAttempt]);

  async function perform(command: string, args: Record<string, string>, fallback: string) {
    setBusy(true);
    setFailure(null);
    setNotice(null);
    try {
      const result = await callPlugin<ActionResult>(command, args);
      setNotice(result?.message || fallback);
      return true;
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : "Device action failed.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function connectRemote() {
    if (!ip || !identity?.samsungFingerprint) return;
    setBusy(true);
    setFailure(null);
    setNotice("Confirm the Personal Voice access request on your TV.");
    try {
      const result = await callPlugin<ActionResult>("pair_samsung_tv", {
        ipAddress: ip, fingerprint: identity.samsungFingerprint,
      });
      setIdentity(previous => previous ? { ...previous, samsungPaired: true } : null);
      setRemoteOpen(true);
      setNotice(result?.message || "TV approved the connection.");
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : "TV pairing failed.");
      setNotice(null);
    } finally { setBusy(false); }
  }

  async function forgetRemote() {
    if (!ip) return;
    const success = await perform("forget_samsung_tv", { ipAddress: ip },
      "Local TV pairing cleared. Remove access in TV settings to revoke its approval.");
    if (success) {
      setRemoteOpen(false);
      setIdentity(previous => previous ? { ...previous, samsungPaired: false } : null);
    }
  }

  const has = (feature: string) => identity?.features.some(item => item === feature) === true;
  const bluetooth = isBluetoothSource(device.source);
  const capabilityNames: Record<string, string> = {
    open_web: "Local web page", volume: "UPnP volume", playback: "UPnP playback",
    samsung_remote: "Samsung TV remote",
  };
  return (
    <div className="spatial-capability-panel">
      <div className="spatial-capability-summary">
        <strong>Capabilities</strong>
        {inspecting ? (
          <span>Checking this device…</span>
        ) : device.pairedDeviceId ? (
          <span>Authenticated Personal Voice computer</span>
        ) : bluetooth ? (
          <span>{device.paired ? "Paired with Android" : "Bluetooth discovery"}</span>
        ) : identity?.features.length ? (
          <div className="spatial-feature-chips">
            {identity.features.map(feature => <span key={feature}>{capabilityNames[feature]}</span>)}
          </div>
        ) : (
          <span>No remote-control protocol verified</span>
        )}
      </div>
      {identity && (
        <div className="spatial-identity">
          <strong>{identity.name !== "Device " + ip ? identity.name : device.name}</strong>
          {(identity.manufacturer || identity.model) && (
            <span>{[identity.manufacturer, identity.model].filter(Boolean).join(" · ")} · reported by device</span>
          )}
        </div>
      )}
      {device.pairedDeviceId && (
        <button type="button" disabled={busy} onClick={() => {
          if (device.pairedDeviceId) onControlPc(device.pairedDeviceId);
        }}>Open Companion</button>
      )}
      {bluetooth && (
        <button type="button" className="secondary" disabled={busy}
          onClick={() => void perform("open_nearby_bluetooth_settings", {},
            "Opened Android Bluetooth settings.")}>
          {device.paired ? "Manage Bluetooth connection" : "Pair in Bluetooth settings"}
        </button>
      )}
      {inspecting && <p className="spatial-capabilities" role="status">Checking local services and device identity…</p>}
      {ip && identity && (
        <>
          {has("open_web") && (
            <button type="button" className="secondary" disabled={busy}
              onClick={() => void perform("open_nearby_web", { ipAddress: ip }, "Opened device page in browser.")}>
              Open device web page
            </button>
          )}
          {has("volume") && (
            <div className="spatial-control-group">
              <span>UPnP volume</span>
              <div className="spatial-control-row">
                <button type="button" className="secondary" disabled={busy}
                  onClick={() => void perform("nearby_media_action", { ipAddress: ip, action: "volume_down" }, "Volume −5 requested.")}>
                  Volume −
                </button>
                <button type="button" className="secondary" disabled={busy}
                  onClick={() => void perform("nearby_media_action", { ipAddress: ip, action: "volume_up" }, "Volume +5 requested.")}>
                  Volume +
                </button>
              </div>
            </div>
          )}
          {has("playback") && (
            <div className="spatial-control-group">
              <span>UPnP playback</span>
              <div className="spatial-control-row">
                <button type="button" className="secondary" disabled={busy}
                  onClick={() => void perform("nearby_media_action", { ipAddress: ip, action: "play" }, "Play requested.")}>
                  Play
                </button>
                <button type="button" className="secondary" disabled={busy}
                  onClick={() => void perform("nearby_media_action", { ipAddress: ip, action: "pause" }, "Pause requested.")}>
                  Pause
                </button>
              </div>
            </div>
          )}
          {has("samsung_remote") && identity.samsungFingerprint && (
            <div className="spatial-control-group">
              <span>Samsung TV remote</span>
              {!remoteOpen ? (
                <>
                  <p className="spatial-capabilities">Encrypted local connection. TV certificate:
                    {" " + identity.samsungFingerprint.slice(0, 16) + "…"}.
                    {" "}Your TV must approve the connection.
                  </p>
                  <button type="button" disabled={busy} onClick={() => void connectRemote()}>
                    {identity.samsungPaired ? "Connect TV remote" : "Pair Samsung TV"}
                  </button>
                </>
              ) : (
                <div className="spatial-remote-grid">
                  {remoteKeys.map(([label, key]) => (
                    <button type="button" className="secondary" key={key} disabled={busy}
                      onClick={() => void perform("samsung_remote_key", { ipAddress: ip, key },
                        "Key sent. Confirm the result on your TV.")}>{label}</button>
                  ))}
                </div>
              )}
              {identity.samsungPaired && (
                <button type="button" className="secondary" disabled={busy}
                  onClick={() => void forgetRemote()}>Forget TV pairing</button>
              )}
            </div>
          )}
          {!identity.features.length && !device.pairedDeviceId && (
            <p className="spatial-capabilities">This device is reachable, but no compatible remote-control service was verified. Discovery alone cannot grant control.</p>
          )}
          {!has("samsung_remote") && /samsung/i.test(device.name + " " + identity.manufacturer) && (
            <p className="spatial-capabilities">
              Samsung remote unavailable. The secure TV remote service on port 8002 was not verified.
              UPnP controls will appear only if this model advertises them.
            </p>
          )}
        </>
      )}
      {bluetooth && (
        <p className="spatial-capabilities">
          {device.paired
            ? "Android recognizes this device. Bluetooth pairing does not grant Personal Voice TV or computer control."
            : "Android can manage discovery and pairing. Remote control needs a supported device protocol."}
        </p>
      )}
      {!ip && !bluetooth && !device.pairedDeviceId && (
        <p className="spatial-capabilities">
          This network service did not provide a verified device address. It cannot be controlled from this discovery alone.
        </p>
      )}
      {ip && !inspecting && !identity && (
        <button type="button" className="secondary" disabled={busy}
          onClick={() => setInspectAttempt(previous => previous + 1)}>
          Retry identification
        </button>
      )}
      {notice && <p className="spatial-action-notice" role="status">{notice}</p>}
      {failure && <p className="spatial-error" role="alert">{failure}</p>}
    </div>
  );
}
