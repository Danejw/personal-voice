import { useEffect, useMemo, useState } from "react";
import type { AssistantController } from "@/assistant/AssistantController";
import type { AssistantSnapshot } from "@/assistant/state";
import { deviceLinkManager } from "@/device-link/DeviceLinkManager";
import type { CompanionAssistantPhase, CompanionMonitor, DeviceLinkPayload } from "@/device-link/protocol";
import { assistantPhase, companionGaze, defaultMonitorIndex } from "@/companion/companionGeometry";
import "./companion.css";

type Pointer = { x: number; y: number };
const PHASE_LABEL: Record<CompanionAssistantPhase, string> = {
  idle: "Ready", listening: "Listening", thinking: "Thinking", speaking: "Speaking",
};
const positionKey = "personal-voice.companion.monitor";
function storedMonitor(): number | null {
  try {
    const val = localStorage.getItem(positionKey);
    if (val === null) return null;
    const parsed = Number(val);
    return Number.isInteger(parsed) && parsed >= 0 && parsed < 8 ? parsed : null;
  } catch { return null; }
}

export function CompanionView({
  assistant, snapshot, micBusy, onStartVoice, onExit,
}: {
  assistant: AssistantController;
  snapshot: AssistantSnapshot;
  micBusy: boolean;
  onStartVoice(): void;
  onExit(): void;
}) {
  const [transport, setTransport] = useState(() => deviceLinkManager.getSnapshot());
  const [cursor, setCursor] = useState<Pointer | null>(null);
  const [monitors, setMonitors] = useState<CompanionMonitor[]>([]);
  const [remotePhase, setRemotePhase] = useState<CompanionAssistantPhase>("idle");
  const [sourceDeviceId, setSourceDeviceId] = useState<string | null>(null);
  const [savedIndex, setSavedIndex] = useState<number | null>(storedMonitor);
  const monitorIndex = savedIndex ?? defaultMonitorIndex(monitors);
  const gaze = useMemo(() => cursor && monitors.length
    ? companionGaze(cursor, monitors, monitorIndex) : { x: 0, y: 0 },
    [cursor, monitors, monitorIndex]);

  useEffect(() => {
    const unsubscribeState = deviceLinkManager.subscribe(
      () => setTransport(deviceLinkManager.getSnapshot()),
    );
    const unsubscribeFrames = deviceLinkManager.subscribeCompanion((sender, payload: DeviceLinkPayload) => {
      setSourceDeviceId(sender);
      if (payload.type === "layout") setMonitors(payload.monitors);
      if (payload.type === "cursor") setCursor({ x: payload.x, y: payload.y });
      if (payload.type === "assistant-state") setRemotePhase(payload.phase);
    });
    const sync = () => deviceLinkManager.setCompanionOpen(document.visibilityState === "visible");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      deviceLinkManager.setCompanionOpen(false);
      unsubscribeFrames();
      unsubscribeState();
    };
  }, []);
  useEffect(() => {
    if (document.visibilityState === "visible") deviceLinkManager.setCompanionOpen(true);
  }, [transport.state]);

  const localPhase = assistantPhase(snapshot);
  const locallyActive = snapshot.status !== "IDLE" && snapshot.status !== "ERROR";
  const linked = !!sourceDeviceId && transport.localPeers.includes(sourceDeviceId);
  const phase = locallyActive ? localPhase : linked ? remotePhase : "idle";
  const vector = linked ? gaze : { x: 0, y: 0 };
  const active = snapshot.status === "READY" || snapshot.status === "RESPONDING" ||
    snapshot.status === "CONNECTING";

  return (
    <main className={`companion-view is-${phase}`} aria-label="Companion mode">
      <header className="companion-header">
        <button type="button" className="companion-exit" onClick={onExit} aria-label="Exit companion mode">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m14 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="1.7"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="companion-connection">
          <span className={linked ? "companion-dot connected" : "companion-dot"} aria-hidden="true" />
          {linked ? "Connected" : "Waiting for PC"}
        </span>
      </header>
      <div className="companion-stage">
        <svg className="companion-face" viewBox="0 0 360 260" role="img"
          aria-label={`Companion is ${PHASE_LABEL[phase].toLowerCase()}`}>
          <defs>
            <radialGradient id="companion-iris">
              <stop offset="0%" stopColor="#b5ffde" />
              <stop offset="100%" stopColor="#66ceab" />
            </radialGradient>
          </defs>
          <g className="companion-eye companion-eye-left">
            <rect x="60" y="55" width="105" height="130" rx="53" className="companion-eye-shell" />
            <g className="companion-pupil" style={{
              transform: `translate(${vector.x * 24}px, ${vector.y * 24}px)`,
            }}>
              <ellipse cx="112" cy="120" rx="20" ry="28" fill="url(#companion-iris)" />
              <ellipse cx="112" cy="120" rx="10" ry="17" fill="#10251f" />
              <circle cx="105" cy="110" r="5" fill="#f0fff9" opacity=".85" />
            </g>
          </g>
          <g className="companion-eye companion-eye-right">
            <rect x="195" y="55" width="105" height="130" rx="53" className="companion-eye-shell" />
            <g className="companion-pupil" style={{
              transform: `translate(${vector.x * 24}px, ${vector.y * 24}px)`,
            }}>
              <ellipse cx="247" cy="120" rx="20" ry="28" fill="url(#companion-iris)" />
              <ellipse cx="247" cy="120" rx="10" ry="17" fill="#10251f" />
              <circle cx="240" cy="110" r="5" fill="#f0fff9" opacity=".85" />
            </g>
          </g>
          <path className="companion-mouth" d="M164 214 Q180 229 196 214" fill="none"
            stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <p className="companion-phase" role="status">{PHASE_LABEL[phase]}</p>
      </div>
      <footer className="companion-controls">
        {monitors.length > 1 && (
          <label className="companion-placement">
            <span>Phone below</span>
            <select aria-label="Monitor for companion placement" value={Math.min(monitorIndex, monitors.length - 1)}
              onChange={(event) => {
                const index = Number(event.target.value);
                setSavedIndex(index);
                try { localStorage.setItem(positionKey, String(index)); } catch { /* Local preference only. */ }
              }}>
              {[...monitors].sort((a, b) => a.x - b.x).map((_monitor, i) =>
                <option value={i} key={i}>{monitors.length === 3
                  ? ["Left", "Center", "Right"][i] : `Monitor ${i + 1}`}</option>)}
            </select>
          </label>
        )}
        <button className={active ? "companion-voice-button is-active" : "companion-voice-button"}
          type="button" disabled={!active && micBusy}
          onClick={() => { if (active) assistant.end(); else onStartVoice(); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4" fill="none"
              stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          {active ? "End voice" : "Talk"}
        </button>
      </footer>
    </main>
  );
}
