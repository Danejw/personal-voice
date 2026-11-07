import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { callPlugin } from "@/platform/android/voicePlatformPlugin";
import { discoverAndroidLanPeers } from "@/device-link/androidLan";
import type { OwnedDevice } from "@/handoffs/handoff";
import {
  clampPosition, mergePersonalVoicePeers, parseNearbyScan, readPositions,
  type NearbyDevice, type NearbyScan, type SpatialPositions,
} from "@/spatial/spatialDevices";
import "./spatialScanner.css";

interface Props {
  currentDeviceId: string;
  devices: readonly OwnedDevice[];
  onControlPc(id: string): void;
}

const glyph: Record<NearbyDevice["kind"], string> = {
  computer: "▣", display: "▤", speaker: "◉", media: "▶", unknown: "◇",
};
const placementKey = (id: string) => "pv.spatial-placements.v1:" + id;
const emptyScan: NearbyScan = { devices: [], bluetoothPermissionRequired: false };

export function SpatialScanner({ currentDeviceId, devices, onControlPc }: Props) {
  const [scan, setScan] = useState<NearbyScan>(emptyScan);
  const [peers, setPeers] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placing, setPlacing] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [positions, setPositions] = useState<SpatialPositions>(() => {
    try { return readPositions(localStorage.getItem(placementKey(currentDeviceId))); }
    catch { return {}; }
  });

  useEffect(() => {
    try { setPositions(readPositions(localStorage.getItem(placementKey(currentDeviceId)))); }
    catch { setPositions({}); }
    setScan(emptyScan);
    setPeers([]);
    setSelected(null);
    setPlacing(null);
    setScanned(false);
  }, [currentDeviceId]);

  const nearby = useMemo(
    () => mergePersonalVoicePeers(scan.devices, peers, devices, currentDeviceId),
    [scan.devices, peers, devices, currentDeviceId],
  );
  const target = nearby.find(item => item.id === selected) ?? null;
  const placed = nearby.filter(item => positions[item.id]);
  const unplaced = nearby.filter(item => !positions[item.id]);

  async function discover() {
    if (scanning) return;
    setScanning(true);
    setError(null);
    try {
      const [network, linked] = await Promise.allSettled([
        callPlugin<unknown>("scan_nearby_devices"),
        discoverAndroidLanPeers(),
      ]);
      if (network.status === "rejected" && linked.status === "rejected") {
        throw network.reason;
      }
      if (network.status === "fulfilled") setScan(parseNearbyScan(network.value));
      else {
        setScan(emptyScan);
        setError(network.reason instanceof Error ? network.reason.message : "Media discovery unavailable.");
      }
      setPeers(linked.status === "fulfilled" ? linked.value.map(peer => peer.deviceId) : []);
      setScanned(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nearby scan failed.");
    } finally {
      setScanning(false);
    }
  }

  function save(next: SpatialPositions) {
    setPositions(next);
    try { localStorage.setItem(placementKey(currentDeviceId), JSON.stringify(next)); }
    catch { /* Location sketch is optional local-only data. */ }
  }

  function mark(event: MouseEvent<HTMLButtonElement>) {
    if (!placing) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const position = clampPosition(
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
    );
    save({ ...positions, [placing]: position });
    setSelected(placing);
    setPlacing(null);
  }

  function clearPosition(id: string) {
    const next = { ...positions };
    delete next[id];
    save(next);
  }

  async function enableBluetooth() {
    setError(null);
    try {
      await callPlugin("request_nearby_bluetooth");
      setError("After approving Bluetooth access, scan again.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Bluetooth permission unavailable.");
    }
  }

  return (
    <section className="spatial-shell" aria-label="Spatial device scanner">
      <div className="spatial-head">
        <div>
          <h2>Nearby</h2>
          <p>Network devices and Bluetooth broadcasts</p>
        </div>
        <button type="button" className="secondary" onClick={() => void discover()} disabled={scanning}>
          {scanning ? "Scanning…" : scanned ? "Scan again" : "Scan nearby"}
        </button>
      </div>
      <div className="spatial-scene">
        <div className="spatial-floor" aria-label="Manual device placement map">
          <div className="spatial-rings" aria-hidden="true">
            <i /><i /><i />
          </div>
          <div className="spatial-heading" aria-hidden="true">FRONT</div>
          <button
            type="button"
            className="spatial-placing-surface"
            aria-label={placing ? "Tap where this device is located in the room" : "Choose a device to place on the map"}
            disabled={!placing}
            onClick={mark}
          >
            {placing && <span>Tap to place</span>}
          </button>
          <span className="spatial-self" aria-hidden="true"><span>●</span>You</span>
          {placed.map(device => {
            const point = positions[device.id];
            return (
              <button
                type="button"
                key={device.id}
                className={"spatial-marker" + (selected === device.id ? " is-selected" : "")}
                style={{ left: (point.x * 100) + "%", top: (point.y * 100) + "%" }}
                aria-label={"Select " + device.name + " (manually placed)"}
                onClick={() => { setSelected(device.id); setPlacing(null); }}
              >
                <span className="spatial-marker-icon" aria-hidden="true">{glyph[device.kind]}</span>
                <span className="spatial-marker-name">{device.name}</span>
              </button>
            );
          })}
        </div>
        <p className="spatial-disclaimer">Positions are marked by you, not measured. Map is not compass-aligned.</p>
      </div>
      {error && <p className="spatial-error" role="alert">{error}</p>}
      {scan.bluetoothPermissionRequired && (
        <button type="button" className="secondary spatial-bluetooth" onClick={() => void enableBluetooth()}>
          Enable Bluetooth discovery
        </button>
      )}
      {unplaced.length > 0 && (
        <div className="spatial-unplaced">
          <h3>Not placed</h3>
          {unplaced.map(device => (
            <button key={device.id} type="button" className="spatial-device"
              onClick={() => { setPlacing(device.id); setSelected(device.id); }}>
              <span className="spatial-device-icon" aria-hidden="true">{glyph[device.kind]}</span>
              <span className="spatial-device-label"><strong>{device.name}</strong><small>{device.detail || device.source}</small></span>
              <span className="spatial-place-label">Place</span>
            </button>
          ))}
        </div>
      )}
      {scanned && nearby.length === 0 && !error && (
        <p className="spatial-empty">No supported devices found. Connect to the same Wi-Fi and try again.</p>
      )}
      {!scanned && <p className="spatial-empty">Scan to discover nearby devices, then place them on the map.</p>}
      {target && (
        <div className="spatial-details">
          <div className="spatial-details-main">
            <span className="spatial-device-icon" aria-hidden="true">{glyph[target.kind]}</span>
            <div><h3>{target.name}</h3><p>{target.detail || target.source}</p></div>
          </div>
          <div className="spatial-actions">
            <button type="button" className="secondary" onClick={() => setPlacing(target.id)}>
              {positions[target.id] ? "Move" : "Place"}
            </button>
            {positions[target.id] && (
              <button type="button" className="secondary" onClick={() => clearPosition(target.id)}>Unplace</button>
            )}
            {target.pairedDeviceId && (
              <button type="button" onClick={() => onControlPc(target.pairedDeviceId!)}>Open Companion</button>
            )}
          </div>
          {!target.pairedDeviceId && (
            <p className="spatial-capabilities">Discovered only. Casting and device control are not enabled for this device yet.</p>
          )}
        </div>
      )}
    </section>
  );
}
