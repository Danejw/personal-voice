import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { createPortal } from "react-dom";
import { callPlugin } from "@/platform/android/voicePlatformPlugin";
import { deviceLinkManager } from "@/device-link/DeviceLinkManager";
import { consolidateNearbyDevices, type DeviceIdentity } from "@/spatial/deviceCapabilities";
import { DeviceActions } from "@/spatial/DeviceActions";
import { nearbyCapabilityService } from "@/spatial/NearbyCapabilityService";
import { deviceSubtitle, deviceReadiness, listDevices, type DeviceView } from "@/spatial/deviceExplorer";
import type { OwnedDevice } from "@/handoffs/handoff";
import {
  clampPosition, mergePersonalVoicePeers, observedThisScan, readPositions, nearbyGroup,
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
  const advancedRef = useRef<HTMLDetailsElement>(null);
  const [identities, setIdentities] = useState<Record<string, DeviceIdentity>>({});
  const [inspectionFailures, setInspectionFailures] = useState<Record<string, boolean>>({});
  const [quickPending, setQuickPending] = useState<string | null>(null);
  const [quickFeedback, setQuickFeedback] = useState<string | null>(null);
  const [visibleLimit, setVisibleLimit] = useState(10);
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
    setIdentities({});
    setInspectionFailures({});
    setVisibleLimit(10);
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
  const liveCount = nearby.filter(observedThisScan).length;
  const savedCount = nearby.length - liveCount;
  const selectedDevice = nearby.find(item => item.id === selected) ?? null;
  const selectedDeviceId = selectedDevice?.id;
  const group = nearby.filter(item => view === "all" || nearbyGroup(item.source) === view);
  const { items: listed, matches, hiddenCount } =
    listDevices(nearby, view, query, showUnnamed);
  const placed = group.filter(item => positions[item.id]);
  const visible = query.trim() ? listed : listed.slice(0, visibleLimit);
  const inspectionTargets = useMemo(() => [...new Set(nearby.filter(device => device.ipAddress &&
    nearbyGroup(device.source) === "network").map(device => device.ipAddress!))].slice(0, 28), [nearby]);

  // Native service verification runs after discovery, bounded to three hosts in
  // parallel. A host or Bluetooth advertisement is never marked ready on name alone.
  useEffect(() => {
    if (!scanned) return;
    let cancelled = false;
    const targets = inspectionTargets;
    let next = 0;
    const worker = async () => {
      while (!cancelled && next < targets.length) {
        const ip = targets[next++]!;
        try {
          const identity = await nearbyCapabilityService.inspect(ip);
          if (!cancelled) setIdentities(prev => ({ ...prev, [ip]: identity }));
        } catch {
          if (!cancelled) setInspectionFailures(prev => ({ ...prev, [ip]: true }));
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(3, targets.length) }, worker));
    return () => { cancelled = true; };
  }, [inspectionTargets, scanned, scanGeneration]);

  useEffect(() => {
    if (!selectedDeviceId) return;
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
  }, [selectedDeviceId]);

  useEffect(() => {
    if (placing && showMap) mapRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [placing, showMap]);

  function chooseView(next: DeviceView) {
    setView(next);
    setSelected(null);
    setPlacing(null);
    setShowUnnamed(false);
    setQuery("");
    setVisibleLimit(10);
  }

  async function discover() {
    if (scanning) return;
    setScanning(true);
    setError(null);
    setSelected(null);
    setPlacing(null);
    setQuickFeedback(null);
    setIdentities({});
    setInspectionFailures({});
    try {
      const result = await nearbyCapabilityService.scan(devices, currentDeviceId,
        deviceLinkManager.getSnapshot().localPeers);
      setScan(result);
      setScanGeneration(previous => previous + 1);
      setPeers(deviceLinkManager.getSnapshot().localPeers);
      setScanned(true);
      setView("network");
      setVisibleLimit(10);
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
    if (advancedRef.current) advancedRef.current.open = true;
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

  async function quickAction(device: NearbyDevice, action: import("@/spatial/deviceActionRegistry").NearbyAction) {
    if (quickPending) return;
    setQuickPending(device.id);
    setQuickFeedback(action === "pair" ? "Approve Personal Voice on your TV if prompted." : null);
    try {
      const response = await nearbyCapabilityService.act(device.id, action);
      if (action === "connect_and_use") {
        const result = JSON.parse(response) as { message: string };
        setQuickFeedback(device.name + ": " + result.message);
      } else setQuickFeedback(device.name + ": " + response);
      if (action === "pair" && device.ipAddress) {
        const refreshed = await nearbyCapabilityService.inspect(device.ipAddress);
        setIdentities(prev => ({ ...prev, [device.ipAddress!]: refreshed }));
      }
    } catch (reason) {
      setQuickFeedback(device.name + ": " +
        (reason instanceof Error ? reason.message : "Action failed."));
    } finally {
      setQuickPending(null);
    }
  }

  return (
    <section className="spatial-shell" aria-label="Nearby devices">
      <div className="spatial-head">
        <div>
          <h2>Nearby devices</h2>
          <p>{scanned ? liveCount + " observed" +
            (savedCount ? " · " + savedCount + " saved pairings" : "") : "Wi-Fi and Bluetooth"}</p>
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

      {error && <p className="spatial-error" role="alert">{error}</p>}
      {scan.bluetoothPermissionRequired && (
        <button type="button" className="secondary spatial-bluetooth" onClick={() => void enableBluetooth()}>
          Allow Bluetooth access
        </button>
      )}
      <div className="spatial-inventory-tools">
        <input type="search" value={query} onChange={event => setQuery(event.target.value)}
          placeholder="Search name, IP, service" aria-label="Search nearby devices" />
      </div>

      <div className="spatial-inventory">
        {visible.map(device => {
          const identity = device.ipAddress ? identities[device.ipAddress] ?? null : null;
          const scheduled = !!device.ipAddress && inspectionTargets.includes(device.ipAddress);
          const inspecting = scheduled && scanned && !identity &&
            !inspectionFailures[device.ipAddress!];
          const skipped = !!device.ipAddress && scanned && !scheduled;
          const readiness = deviceReadiness(device, identity, inspecting, skipped);
          const displayName = identity?.name && !/^Device \d+\.\d+\.\d+\.\d+$/.test(identity.name)
            ? identity.name : device.name;
          return (
            <div className="spatial-device-row" key={device.id}>
              <button type="button" className="spatial-device"
                title={deviceSubtitle(device) + " · " + readiness.hint}
                onClick={() => { setPlacing(null); setSelected(device.id); }}
                aria-label={"Open controls for " + displayName + ". " + readiness.hint}>
                <span className="spatial-device-icon" aria-hidden="true">{glyph[device.kind]}</span>
                <span className="spatial-device-label">
                  <strong>{displayName}</strong>
                  <small><span className={"spatial-readiness spatial-readiness-" + readiness.state}>
                    {readiness.label}</span> · {readiness.hint}</small>
                </span>
                {!readiness.quickAction && <span className="spatial-place-label" aria-hidden="true">›</span>}
              </button>
              {readiness.quickAction && (
                <button type="button" className="spatial-quick-action"
                  disabled={quickPending !== null}
                  aria-label={readiness.quickLabel + " for " + displayName}
                  onClick={() => void quickAction(device, readiness.quickAction!)}>
                  {quickPending === device.id ? "…" : readiness.quickLabel}
                </button>
              )}
            </div>
          );
        })}
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
        {!query && listed.length > visible.length && (
          <button type="button" className="spatial-unnamed-toggle"
            onClick={() => setVisibleLimit(n => n + 12)}>
            Show {Math.min(12, listed.length - visible.length)} more
          </button>
        )}
      </div>
      {quickFeedback && <p className="spatial-action-notice" role="status">{quickFeedback}</p>}
      <details className="spatial-advanced" ref={advancedRef}>
        <summary>Scan details and room map</summary>
        {scanned && !!scan.networkLabel && (
          <p className="spatial-network-scope">{scan.networkLabel}</p>
        )}
        <button type="button" className="secondary" aria-expanded={showMap}
          onClick={() => { setShowMap(!showMap); setPlacing(null); }}>
          {showMap ? "Hide map" : "Show room map"}
        </button>
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

      </details>

      {matches === 0 && scanned && (
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
