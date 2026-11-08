import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { createPortal } from "react-dom";
import { callPlugin } from "@/platform/android/voicePlatformPlugin";
import { deviceLinkManager } from "@/device-link/DeviceLinkManager";
import { consolidateNearbyDevices } from "@/spatial/deviceCapabilities";
import { DeviceActions } from "@/spatial/DeviceActions";
import type { OwnedDevice } from "@/handoffs/handoff";
import {
  clampPosition, mergePersonalVoicePeers, parseNearbyScan, readPositions, nearbyGroup,
  type NearbyDevice, type NearbyScan, type SpatialPositions,
} from "@/spatial/spatialDevices";
import "./spatialScanner.css";

interface Props {
  currentDeviceId: string;
  devices: readonly OwnedDevice[];
  onControlPc(id: string): void;
}

const glyph: Record<NearbyDevice["kind"], string> = {
  computer: "▣", display: "▤", speaker: "◉", media: "▶", phone: "▯",
  printer: "▥", server: "▦", unknown: "◇",
};
const placementKey = (id: string) => "pv.spatial-placements.v1:" + id;
const emptyScan: NearbyScan = {
  devices: [], bluetoothPermissionRequired: false, networkLabel: "", networkLimited: false,
};
type DeviceView = "network" | "bluetooth" | "all";

function unnamed(device: NearbyDevice): boolean {
  return device.name === "Bluetooth device" || device.name === "Bluetooth LE device";
}

function deviceSubtitle(device: NearbyDevice): string {
  if (device.pairedDeviceId) return "Personal Voice · Connected";
  if (device.ipAddress) return device.ipAddress + " · " + device.detail;
  if (device.paired) return "Bluetooth · Paired";
  if (device.signalDbm !== undefined) return "Bluetooth · " + device.signalDbm + " dBm";
  return device.source === "mdns" ? "Network service · " + device.detail : device.detail;
}

function rank(device: NearbyDevice): number {
  if (device.pairedDeviceId) return 0;
  if (device.ipAddress && /Samsung|LG|TV|Cast/i.test(device.name)) return 1;
  if (device.paired) return 2;
  if (device.ipAddress) return 3;
  if (!unnamed(device)) return 4;
  return 5;
}

export function SpatialScanner({ currentDeviceId, devices, onControlPc }: Props) {
  const [scan, setScan] = useState<NearbyScan>(emptyScan);
  const [peers, setPeers] = useState<string[]>(() => deviceLinkManager.getSnapshot().localPeers);
  const [scanning, setScanning] = useState(false);
  const [view, setView] = useState<DeviceView>("network");
  const [scanned, setScanned] = useState(false);
  const [scanGeneration, setScanGeneration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [placing, setPlacing] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [showUnnamed, setShowUnnamed] = useState(false);
  const [query, setQuery] = useState("");
  const sheetCloseRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<SpatialPositions>(() => {
    try { return readPositions(localStorage.getItem(placementKey(currentDeviceId))); }
    catch { return {}; }
  });

  useEffect(() => {
    try { setPositions(readPositions(localStorage.getItem(placementKey(currentDeviceId)))); }
    catch { setPositions({}); }
    setScan(emptyScan);
    setPeers(deviceLinkManager.getSnapshot().localPeers);
    setSelected(null);
    setView("network");
    setPlacing(null);
    setScanned(false);
    setShowMap(false);
    setShowUnnamed(false);
    setQuery("");
  }, [currentDeviceId]);

  useEffect(() => deviceLinkManager.subscribe(() => {
    setPeers(deviceLinkManager.getSnapshot().localPeers);
  }), []);

  const nearby = useMemo(
    () => consolidateNearbyDevices(mergePersonalVoicePeers(scan.devices, peers, devices, currentDeviceId)),
    [scan.devices, peers, devices, currentDeviceId],
  );
  const networkCount = nearby.filter(item => nearbyGroup(item.source) === "network").length;
  const bluetoothCount = nearby.length - networkCount;
  const selectedDevice = nearby.find(item => item.id === selected) ?? null;
  const group = nearby.filter(item => view === "all" || nearbyGroup(item.source) === view);
  const search = query.trim().toLocaleLowerCase();
  const searched = group.filter(device => !search || (
    device.name.toLocaleLowerCase().includes(search) ||
    device.ipAddress?.includes(search) ||
    device.detail.toLocaleLowerCase().includes(search)
  ));
  const hiddenCount = searched.filter(unnamed).length;
  const listed = searched.filter(device => showUnnamed || !unnamed(device))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const placed = group.filter(item => positions[item.id]);

  useEffect(() => {
    if (!selectedDevice) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sheetCloseRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSelected(null);
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = originalOverflow;
      previous?.focus();
    };
  }, [selectedDevice?.id]);

  useEffect(() => {
    if (placing && showMap) mapRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [placing, showMap]);

  function chooseView(next: DeviceView) {
    setView(next);
    setSelected(null);
    setPlacing(null);
    setShowUnnamed(false);
    setQuery("");
  }

  async function discover() {
    if (scanning) return;
    setScanning(true);
    setError(null);
    setSelected(null);
    setPlacing(null);
    try {
      const result = parseNearbyScan(await callPlugin<unknown>("scan_nearby_devices"));
      setScan(result);
      setScanGeneration(previous => previous + 1);
      setPeers(deviceLinkManager.getSnapshot().localPeers);
      setScanned(true);
      setView("network");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nearby scan failed.");
    } finally {
      setScanning(false);
    }
  }

  function save(next: SpatialPositions) {
    setPositions(next);
    try { localStorage.setItem(placementKey(currentDeviceId), JSON.stringify(next)); }
    catch { /* Sketch stays optional and local-only. */ }
  }

  function mark(event: MouseEvent<HTMLButtonElement>) {
    if (!placing) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    save({ ...positions, [placing]: clampPosition(
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
    ) });
    setPlacing(null);
  }

  function clearPosition(id: string) {
    const next = { ...positions };
    delete next[id];
    save(next);
  }

  function startPlacement(id: string) {
    setShowMap(true);
    setPlacing(id);
    setSelected(null);
  }

  async function enableBluetooth() {
    setError(null);
    try {
      await callPlugin("request_nearby_bluetooth");
      setError("Allow Nearby Devices, then scan again.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Bluetooth permission unavailable.");
    }
  }

  return (
    <section className="spatial-shell" aria-label="Nearby devices">
      <div className="spatial-head">
        <div>
          <h2>Nearby devices</h2>
          <p>{scanned ? nearby.length + " discovered" : "Wi-Fi and Bluetooth"}</p>
        </div>
        <button type="button" onClick={() => void discover()} disabled={scanning}>
          {scanning ? "Scanning…" : scanned ? "Rescan" : "Scan"}
        </button>
      </div>

      <div className="spatial-tabs" role="group" aria-label="Discovery sources">
        {([
          ["network", "Network", networkCount],
          ["bluetooth", "Bluetooth", bluetoothCount],
          ["all", "All", nearby.length],
        ] as const).map(([id, label, count]) => (
          <button key={id} type="button" className={view === id ? "is-active" : ""}
            aria-pressed={view === id} onClick={() => chooseView(id)}>
            {label} <span>{count}</span>
          </button>
        ))}
      </div>

      {scanned && (view === "network" || view === "all") && !!scan.networkLabel && (
        <p className="spatial-network-scope">{scan.networkLabel}</p>
      )}
      {error && <p className="spatial-error" role="alert">{error}</p>}
      {scan.bluetoothPermissionRequired && (
        <button type="button" className="secondary spatial-bluetooth" onClick={() => void enableBluetooth()}>
          Allow Bluetooth access
        </button>
      )}
      <div className="spatial-inventory-tools">
        <input type="search" value={query} onChange={event => setQuery(event.target.value)}
          placeholder="Find device or IP" aria-label="Search nearby devices" />
        <button type="button" className="secondary" aria-expanded={showMap}
          onClick={() => { setShowMap(!showMap); setPlacing(null); }}>
          {showMap ? "Hide map" : "Room map"}
        </button>
      </div>

      {showMap && (
        <div className="spatial-scene" ref={mapRef}>
          <div className="spatial-floor" aria-label="Manual device placement map">
            <div className="spatial-rings" aria-hidden="true"><i /><i /><i /></div>
            <div className="spatial-heading" aria-hidden="true">FRONT</div>
            <button type="button" className="spatial-placing-surface"
              aria-label={placing ? "Tap location for selected device" : "Choose a device to place"}
              disabled={!placing} onClick={mark}>
              {placing && <span>Tap a position to place the device</span>}
            </button>
            <span className="spatial-self" aria-hidden="true"><span>●</span>You</span>
            {placed.map(device => {
              const point = positions[device.id];
              if (!point) return null;
              return (
                <button type="button" key={device.id} className="spatial-marker"
                  style={{ left: (point.x * 100) + "%", top: (point.y * 100) + "%" }}
                  aria-label={"View " + device.name}
                  onClick={() => { setPlacing(null); setSelected(device.id); }}>
                  <span className="spatial-marker-icon" aria-hidden="true">{glyph[device.kind]}</span>
                  <span className="spatial-marker-name">{device.name}</span>
                </button>
              );
            })}
          </div>
          <p className="spatial-disclaimer">Positions are manually placed, not measured.</p>
        </div>
      )}

      <div className="spatial-inventory">
        {listed.map(device => (
          <button key={device.id} type="button" className="spatial-device"
            onClick={() => { setPlacing(null); setSelected(device.id); }}
            aria-label={"View device details for " + device.name}>
            <span className="spatial-device-icon" aria-hidden="true">{glyph[device.kind]}</span>
            <span className="spatial-device-label">
              <strong>{device.name}</strong>
              <small>{deviceSubtitle(device)}</small>
            </span>
            {device.pairedDeviceId && <span className="spatial-device-connected">Ready</span>}
            <span className="spatial-place-label" aria-hidden="true">›</span>
          </button>
        ))}
        {!showUnnamed && hiddenCount > 0 && (
          <button type="button" className="spatial-unnamed-toggle" onClick={() => setShowUnnamed(true)}>
            Show {hiddenCount} unidentified Bluetooth devices
          </button>
        )}
        {showUnnamed && hiddenCount > 0 && (
          <button type="button" className="spatial-unnamed-toggle" onClick={() => setShowUnnamed(false)}>
            Hide unidentified devices
          </button>
        )}
      </div>

      {searched.length === 0 && scanned && (
        <p className="spatial-empty">No matching devices. Try another source or search.</p>
      )}
      {!scanned && !scanning && nearby.length === 0 && (
        <p className="spatial-empty">Scan to find your TV, computers, and Bluetooth devices.</p>
      )}
      {scanning && <p className="spatial-empty" role="status">Checking local Wi-Fi and Bluetooth…</p>}

      {selectedDevice && createPortal(
        <div className="spatial-overlay">
          <button type="button" className="spatial-backdrop" aria-label="Close device details"
            onClick={() => setSelected(null)} />
          <section className="spatial-sheet" ref={sheetRef} role="dialog" aria-modal="true"
            aria-labelledby="spatial-sheet-title">
            <div className="spatial-sheet-handle" aria-hidden="true" />
            <div className="spatial-sheet-head">
              <span className="spatial-device-icon" aria-hidden="true">{glyph[selectedDevice.kind]}</span>
              <div className="spatial-sheet-title-wrap">
                <h2 id="spatial-sheet-title">{selectedDevice.name}</h2>
                <p>{deviceSubtitle(selectedDevice)}</p>
              </div>
              <button type="button" ref={sheetCloseRef} className="spatial-sheet-close"
                aria-label="Close device details" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="spatial-sheet-content">
              <DeviceActions key={selectedDevice.id + ":" + scanGeneration}
                device={selectedDevice} onControlPc={onControlPc} />
              <div className="spatial-sheet-placement">
                <button type="button" className="secondary" onClick={() => startPlacement(selectedDevice.id)}>
                  {positions[selectedDevice.id] ? "Move on map" : "Place on map"}
                </button>
                {positions[selectedDevice.id] && (
                  <button type="button" className="secondary"
                    onClick={() => clearPosition(selectedDevice.id)}>Remove placement</button>
                )}
              </div>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </section>
  );
}
