import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Tooltip } from "@/components/Tooltip";
import type { DeviceSnapshot, DeviceStatus, DeviceStore } from "@/devices/DeviceStore";
import type { OwnedDevice } from "@/handoffs/handoff";
import { MAX_DEVICE_NAME } from "@/services/deviceService";

interface DevicesPanelProps {
  store: DeviceStore;
  snapshot: DeviceSnapshot;
  onChanged(): void;
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
}

function DeviceRow({ device, current, connected, busy, onRename, onRemove }: DeviceRowProps) {
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
      <form className="device-rename" onSubmit={submit}>
        <input
          aria-label={`Name for ${device.name}`}
          maxLength={MAX_DEVICE_NAME}
          value={name}
          disabled={!connected || busy}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          type="submit"
          className="secondary"
          disabled={!connected || busy || !name.trim() || name.trim() === device.name}
        >
          Rename
        </button>
        <button
          type="button"
          className="secondary note-delete"
          disabled={!connected || busy || current}
          onClick={onRemove}
        >
          Remove
        </button>
      </form>
    </li>
  );
}

/** Friendly names for owned installs. Removing a row never deletes notes or handoffs. */
export function DevicesPanel({ store, snapshot, onChanged }: DevicesPanelProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
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

  return (
    <>
      <div className="card-head">
        <Tooltip content="Removing a device does not delete notes or sent text.">
          <h2 id="devices-heading">Connected devices</h2>
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
      {snapshot.devices.length ? (
        <ul className="notes hide-scrollbar">
          {snapshot.devices.map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              current={device.id === snapshot.currentDeviceId}
              connected={connected}
              busy={busy !== null}
              onRename={(name) => void run(`rename:${device.id}`, () => store.rename(device.id, name))}
              onRemove={() => void run(`remove:${device.id}`, () => store.remove(device.id))}
            />
          ))}
        </ul>
      ) : (
        <p className="placeholder">{snapshot.status === "signed-out" ? "Sign in to see your devices." : "No devices yet."}</p>
      )}
    </>
  );
}
