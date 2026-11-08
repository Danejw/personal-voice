import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Tooltip } from "@/components/Tooltip";
import { ConfirmDialog, useConfirmAction } from "@/components/ConfirmDialog";
import type { DeviceSnapshot, DeviceStatus, DeviceStore } from "@/devices/DeviceStore";
import type { OwnedDevice } from "@/handoffs/handoff";
import { MAX_DEVICE_NAME } from "@/services/deviceService";
import { DevicePairingPanel } from "@/devices/DevicePairingPanel";
import { SpatialScanner } from "@/spatial/SpatialScanner";
import "./deviceTabs.css";

interface DevicesPanelProps {
  mode: "paired" | "nearby";
  store: DeviceStore;
  snapshot: DeviceSnapshot;
  onChanged(): void;
  onControlPc(id: string): void;
}

function statusLabel(status: DeviceStatus): string {
  switch (status) {
    case "signed-out": return "Sign in";
    case "loading": return "Loading…";
    case "synced": return "Synced";
    case "offline": return "Offline";
    default: {
      const unhandled: never = status;
      throw new Error(`Unhandled device status: ${String(unhandled)}`);
    }
  }
}

function platformLabel(platform: string): string {
  switch (platform) {
    case "windows": return "Windows";
    case "android": return "Android";
    default: return platform;
  }
}

function lastSeenLabel(lastSeen: string | null): string {
  return lastSeen ? new Date(lastSeen).toLocaleString() : "Never";
}

interface DeviceRowProps {
  device: OwnedDevice;
  current: boolean;
  connected: boolean;
  busy: boolean;
  onRename(name: string): void;
  onRemove(): void;
  onControlPc?(): void;
}

function DeviceRow({ device, current, connected, busy, onRename, onRemove, onControlPc }: DeviceRowProps) {
  const [name, setName] = useState(device.name);

  useEffect(() => {
    setName(device.name);
  }, [device.name]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onRename(name);
  }

  return (
    <li className="item-row">
      <div className="item-main">
        <p className="device-title">
          <strong>{device.name}</strong>
          {current && <span className="setup-state">This device</span>}
        </p>
        <p className="note-meta">
          {platformLabel(device.platform)} · {lastSeenLabel(device.lastSeen)}
        </p>
      </div>
      {onControlPc && <button type="button" className="secondary" onClick={onControlPc}>
        Companion
      </button>}
      <details className="device-row-manage">
        <summary aria-label={`Manage ${device.name}`}>Manage</summary>
        <form className="device-rename" onSubmit={submit}>
          <input
            aria-label={`Name for ${device.name}`}
            maxLength={MAX_DEVICE_NAME}
            value={name}
            disabled={!connected || busy}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" className="secondary"
            disabled={!connected || busy || !name.trim() || name.trim() === device.name}>
            Rename
          </button>
          <button type="button" className="secondary note-delete"
            disabled={!connected || busy || current} onClick={onRemove}>
            Remove
          </button>
        </form>
      </details>
    </li>
  );
}

/** Friendly names for owned installs. Removing a row never deletes notes or handoffs. */
export function DevicesPanel({ mode, store, snapshot, onChanged, onControlPc }: DevicesPanelProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const confirm = useConfirmAction();
  const connected = snapshot.status === "synced";

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setProblem(null);
    try {
      await action();
      onChanged();
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  if (mode === "nearby") {
    return connected && snapshot.currentDeviceId &&
      snapshot.devices.find(device => device.id === snapshot.currentDeviceId)?.platform === "android"
      ? <SpatialScanner currentDeviceId={snapshot.currentDeviceId}
          devices={snapshot.devices} onControlPc={onControlPc} />
      : <p className="placeholder">Nearby discovery is available on the signed-in Android phone.</p>;
  }

  return (
    <>
      <div className="card-head">
        <Tooltip content="Removing a device does not delete notes or sent text.">
          <h2 id="devices-heading">My devices</h2>
        </Tooltip>
        <div className="card-head-actions">
          <p role="status">{statusLabel(snapshot.status)}</p>
          {snapshot.status !== "signed-out" && (
            <button
              type="button" className="secondary"
              disabled={snapshot.status === "loading" || busy !== null}
              onClick={() => void store.reload()}
            >
              Refresh
            </button>
          )}
        </div>
      </div>
      {(problem ?? snapshot.error) && <p className="error" role="alert">{problem ?? snapshot.error}</p>}
      {connected && snapshot.currentDeviceId && (
        <details className="devices-pair-setup">
          <summary>Pair a device</summary>
          <DevicePairingPanel
            key={snapshot.currentDeviceId}
            deviceId={snapshot.currentDeviceId}
            devices={snapshot.devices}
            platform={snapshot.devices.find((device) => device.id === snapshot.currentDeviceId)?.platform ?? "unknown"}
          />
        </details>
      )}
      {snapshot.devices.length ? (
        <ul className="notes hide-scrollbar">
          {snapshot.devices.map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              current={device.id === snapshot.currentDeviceId}
              connected={connected}
              busy={busy !== null}
              onControlPc={connected && device.platform === "windows" && device.id !== snapshot.currentDeviceId
                ? () => onControlPc(device.id) : undefined}
              onRename={(name) => void run(`rename:${device.id}`, () => store.rename(device.id, name))}
              onRemove={() => confirm.ask({
                title: "Remove connected device?",
                description: `“${device.name}” will be removed from your device list. This does not delete synced notes, handoffs, or conversations.`,
                confirmLabel: "Remove device",
                onConfirm: () => run(`remove:${device.id}`, () => store.remove(device.id)),
              })}
            />
          ))}
        </ul>
      ) : (
        <p className="placeholder">{snapshot.status === "signed-out" ? "Sign in to see your devices." : "No devices yet."}</p>
      )}
      <ConfirmDialog request={confirm.request} onClose={confirm.dismiss} />
    </>
  );
}
