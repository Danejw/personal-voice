import { useEffect, useRef, useState } from "react";
import { callPlugin } from "@/platform/android/voicePlatformPlugin";

interface ScreenShareState { active: boolean; url: string | null }

function stateFrom(value: unknown): ScreenShareState {
  if (!value || typeof value !== "object") return { active: false, url: null };
  const state = value as { active?: unknown; url?: unknown };
  return { active: state.active === true && typeof state.url === "string",
    url: typeof state.url === "string" && state.url.startsWith("http://") ? state.url : null };
}

/** The TV opens a one-time LAN link in its browser. This does not imply native casting support. */
export function ScreenSharingPanel() {
  const [share, setShare] = useState<ScreenShareState>({ active: false, url: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const urlField = useRef<HTMLInputElement>(null);

  async function refresh() {
    try { setShare(stateFrom(await callPlugin<unknown>("screen_share_status"))); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Cannot read screen sharing status."); }
  }

  useEffect(() => { void refresh(); }, []);

  async function start() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = stateFrom(await callPlugin<unknown>("start_screen_share"));
      setShare(result);
      setMessage("On the TV, open its web browser and enter this address.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Screen sharing failed.");
      await refresh();
    } finally { setBusy(false); }
  }

  async function stop() {
    setBusy(true);
    setError("");
    try {
      await callPlugin("stop_screen_share");
      setShare({ active: false, url: null });
      setMessage("Screen sharing stopped.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not stop sharing.");
    } finally { setBusy(false); }
  }

  async function copyLink() {
    if (!share.url) return;
    try {
      await navigator.clipboard.writeText(share.url);
      setMessage("Link copied. Enter it in your TV's browser.");
    } catch {
      urlField.current?.focus();
      urlField.current?.select();
      setMessage("Select the link to copy it.");
    }
  }

  return (
    <section aria-label="Share phone screen to TV" className="device-screen-share">
      <h3>Share phone screen</h3>
      <p className="note-meta">Display your phone on a TV with a compatible web browser on the same Wi-Fi. This is a low-frame-rate, local-only screen stream, not automatic Chromecast, Miracast, or WebRTC casting.</p>
      <div className="card-head-actions">
        {share.active
          ? <button type="button" onClick={() => void stop()} disabled={busy}>Stop sharing</button>
          : <button type="button" onClick={() => void start()} disabled={busy}>
              {busy ? "Starting…" : "Start screen sharing"}
            </button>}
        <button type="button" className="secondary" disabled={busy} onClick={() => void refresh()}>Refresh</button>
      </div>
      {share.active && share.url && (
        <div>
          <label htmlFor="screen-share-link">TV browser address</label>
          <input id="screen-share-link" ref={urlField} type="text" readOnly value={share.url}
            aria-label="Screen sharing address for TV" onFocus={event => event.currentTarget.select()} />
          <button type="button" className="secondary" onClick={() => void copyLink()}>Copy link</button>
        </div>
      )}
      <p className="note-meta">Android asks permission for every session. Sharing is visible in the notification shade, where you can stop it. The local HTTP link is not encrypted, so use only trusted Wi-Fi and avoid sensitive content.</p>
      {error && <p role="alert" className="error">{error}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
