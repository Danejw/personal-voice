import { useSyncExternalStore } from "react";
import { wearableManager } from "@/wearables/WearableManager";
import { callPlugin } from "@/platform/android/voicePlatformPlugin";

const ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_UDP_SIMULATOR === "1";

/** The simulated watch is explicitly opt-in and never published as a real sensor. */
export function VirtualWatchPanel() {
  const state = useSyncExternalStore(wearableManager.subscribe, wearableManager.getSnapshot);
  if (!ENABLED) return null;
  const connected = state.status === "connected" && state.source === "virtual";
  return (
    <section className="virtual-watch-panel" aria-label="Virtual watch test">
      <div>
        <strong>Virtual AI Watch</strong>
        <p>Development test · simulated button only · uses phone microphone</p>
        <p role="status">{state.source === "bluetooth" ? "Physical watch: " + state.status :
          connected ? "Connected · button.primary" : "Not connected"}</p>
        {state.error && <p role="alert">{state.error}</p>}
      </div>
      <div className="virtual-watch-actions">
        <button type="button" onClick={() => wearableManager.connectVirtual()}
          disabled={connected}>Connect virtual watch</button>
        <button type="button" disabled={!connected}
          onClick={() => wearableManager.pressVirtual()}>Tap watch button</button>
        <button type="button" disabled={!connected}
          onClick={() => wearableManager.disconnect()}>Disconnect virtual</button>
        <button type="button" disabled={state.source !== "bluetooth"}
          onClick={() => void callPlugin("disconnect_udp_watch").then(() => wearableManager.disconnect()).catch(error => {
            wearableManager.reportError(error instanceof Error ? error.message : "Watch disconnect failed");
          })}>Disconnect physical</button>
      </div>
    </section>
  );
}
