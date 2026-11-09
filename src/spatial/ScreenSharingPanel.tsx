import { useEffect, useRef, useState } from "react";
import { callPlugin } from "@/platform/android/voicePlatformPlugin";
import { readScreenEvidence, type AndroidScreenEvidence } from "@/platform/android/deviceCoordination";

interface ScreenShareState extends AndroidScreenEvidence { url: string | null }

function stateFrom(value: unknown): ScreenShareState {
  const evidence = readScreenEvidence(value);
  const state = value && typeof value === "object" ? value as { url?: unknown } : {};
  return { ...evidence, url: evidence.linkAvailable ? state.url as string : null };
}
const STOPPED = stateFrom(null);

/** The TV opens a one-time LAN link in its browser. This does not imply native casting support. */
export function ScreenSharingPanel() {
  const [share, setShare] = useState<ScreenShareState>(STOPPED);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const urlField = useRef<HTMLInputElement>(null);

  async function refresh() {
    try { setShare(stateFrom(await callPlugin<unknown>("screen_share_status"))); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Cannot read screen sharing status."); }
  }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!share.active) return;
    const timer = window.setInterval(() => { void refresh(); }, 2500);
    return () => window.clearInterval(timer);
  }, [share.active]);

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
      setShare(STOPPED);
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
      {share.active && (
        <p role="status">
          {share.browserConnected
            ? "Local browser connected · " + share.framesWritten + " frames sent"
            : "Waiting for a TV browser to open the link"}
          {share.browserConnected && share.frameAgeMs !== null && share.frameAgeMs > 3500
            ? " · no recent frame delivery" : ""}
        </p>
      )}
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
