import { useEffect, useState } from "react";
import { Toggle } from "@/components/Toggle";
import type { WindowsPlatformAdapter } from "./WindowsPlatformAdapter";
import type { DesktopBackgroundStatus } from "./desktopBackground";

export function DesktopBackgroundPanel({ platform }: { platform: WindowsPlatformAdapter }) {
  const [status, setStatus] = useState<DesktopBackgroundStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    // Subscribe before the initial read so startup events cannot be missed.
    void platform.onDesktopBackgroundStatus(next => { if (!disposed) setStatus(next); })
      .then(async off => {
        if (disposed) { off(); return; }
        unlisten = off;
        const next = await platform.getDesktopBackgroundStatus();
        if (!disposed) setStatus(next);
      }).catch(reason => { if (!disposed) setError(String(reason)); });
    return () => { disposed = true; unlisten?.(); };
  }, [platform]);

  async function toggle(enabled: boolean) {
    setPending(true);
    setError(null);
    try { setStatus(await platform.setDesktopBackground(enabled)); }
    catch (reason) { setError(String(reason)); }
    finally { setPending(false); }
  }

  return <>
    <Toggle label="3D desktop background (experimental)"
      title="One cyan mesh world across this PC's displays. Stays behind desktop icons while Personal Voice runs. Off on every app launch."
      checked={status?.phase === "starting" || status?.phase === "running"}
      disabled={pending || status === null}
      onChange={enabled => { void toggle(enabled); }} />
    {status?.phase === "starting" && <p role="status">Preparing desktop surfaces…</p>}
    {status?.phase === "running" && <p role="status">Background active across {status.monitors.length} displays. Turn off here before changing your display layout.</p>}
    {status?.phase === "running" && <button type="button" onClick={() => {
      void platform.openDesktopHeadTracking().catch(reason => setError(String(reason)));
    }}>Head tracking…</button>}
    {(error || status?.error) && <p className="error" role="alert">{error || status?.error}</p>}
  </>;
}
