import { useEffect, useState } from "react";
import { callPlugin } from "@/platform/android/voicePlatformPlugin";
import {
  readBluetoothSpeakerHandoff, type BluetoothSpeakerHandoffEvidence,
} from "@/platform/android/deviceCoordination";

const WAITING = new Set(["checking", "pairing", "connect_in_android", "bluetooth_off"]);

export function BluetoothSpeakerHandoffStatus({ deviceId }: { deviceId?: string }) {
  const [snapshot, setSnapshot] = useState<BluetoothSpeakerHandoffEvidence | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const current = readBluetoothSpeakerHandoff(await callPlugin<unknown>("bluetooth_speaker_status"));
        if (!cancelled) setSnapshot(current);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Can't read speaker status.");
      }
    }
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 1200);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
    };
  }, []);

  const current = snapshot?.state !== "idle" && (!deviceId || snapshot?.deviceId === deviceId)
    ? snapshot : null;
  if (!current && !error) return null;

  async function cancel() {
    setBusy(true);
    setError("");
    try {
      setSnapshot(readBluetoothSpeakerHandoff(await callPlugin<unknown>("cancel_bluetooth_speaker")));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't cancel speaker connection.");
    } finally { setBusy(false); }
  }

  return <div className="spatial-control-group" aria-label="Bluetooth speaker connection status">
    {current && <>
      <p role="status" className="spatial-capabilities">
        <strong>{current.name ?? "Bluetooth speaker"}:</strong> {current.message}
      </p>
      {current.selectedOutputId && (
        <p className="spatial-capabilities">
          {current.routeObserved ? "Native Assistant audio route verified." :
            "Selected for the next Assistant reply. Listen to confirm the speaker plays it."}
        </p>
      )}
      {WAITING.has(current.state) && (
        <button type="button" className="secondary" disabled={busy}
          onClick={() => void cancel()}>Cancel Connect & Use</button>
      )}
    </>}
    {error && <p role="alert" className="spatial-error">{error}</p>}
  </div>;
}
