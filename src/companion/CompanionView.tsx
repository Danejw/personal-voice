import { useEffect, useMemo, useRef, useState } from "react";
import type { AssistantController } from "@/assistant/AssistantController";
import type { AssistantSnapshot } from "@/assistant/state";
import { deviceLinkManager } from "@/device-link/DeviceLinkManager";
import { SelectField } from "@/components/SelectField";
import { loadRemoteVoiceDefault, saveRemoteVoiceDefault } from "@/assistant/remoteVoiceTarget";
import type { OwnedDevice } from "@/handoffs/handoff";
import type { CompanionAssistantPhase, CompanionMonitor, DeviceLinkPayload } from "@/device-link/protocol";
import { assistantPhase, companionGaze, defaultMonitorIndex, selectedCompanionPC } from "@/companion/companionGeometry";
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
  assistant, snapshot, micBusy, onStartVoice, onExit, currentDeviceId, devices,
}: {
  assistant: AssistantController;
  snapshot: AssistantSnapshot;
  micBusy: boolean;
  currentDeviceId: string | null;
  devices: OwnedDevice[];
  onStartVoice(): void;
  onExit(): void;
}) {
  const [transport, setTransport] = useState(() => deviceLinkManager.getSnapshot());
  const [cursor, setCursor] = useState<Pointer | null>(null);
  const [monitors, setMonitors] = useState<CompanionMonitor[]>([]);
  const [remotePhase, setRemotePhase] = useState<CompanionAssistantPhase>("idle");
  const remoteSpeech = useRef({ level: 0, at: 0 });
  const [mouth, setMouth] = useState(0);
  const [wander, setWander] = useState<Pointer>({ x: 0, y: 0 });
  const [sourceDeviceId, setSourceDeviceId] = useState<string | null>(null);
  const [savedIndex, setSavedIndex] = useState<number | null>(storedMonitor);
  const [preferredPC, setPreferredPC] = useState<string | null>(
    () => currentDeviceId ? loadRemoteVoiceDefault(currentDeviceId) : null,
  );
  const pairedWindows = devices.filter(d => d.platform === "windows"
    && d.id !== currentDeviceId && transport.pairedPeers.includes(d.id));
  // An explicit default which is no longer paired must not silently select another PC.
  const targetId = selectedCompanionPC(pairedWindows, preferredPC);
  const monitorIndex = savedIndex ?? defaultMonitorIndex(monitors);
  const gaze = useMemo(() => cursor && monitors.length
    ? companionGaze(cursor, monitors, monitorIndex) : { x: 0, y: 0 },
    [cursor, monitors, monitorIndex]);

  useEffect(() => {
    const unsubscribeState = deviceLinkManager.subscribe(
      () => setTransport(deviceLinkManager.getSnapshot()),
    );
    const unsubscribeFrames = deviceLinkManager.subscribeCompanion((sender, payload: DeviceLinkPayload) => {
      if (sender !== targetId) return;
      setSourceDeviceId(sender);
      if (payload.type === "layout") setMonitors(payload.monitors);
      if (payload.type === "cursor") setCursor({ x: payload.x, y: payload.y });
      if (payload.type === "assistant-state") setRemotePhase(payload.phase);
      if (payload.type === "assistant-level") remoteSpeech.current = { level: payload.level, at: Date.now() };
    });
    const sync = () => deviceLinkManager.setCompanionOpen(document.visibilityState === "visible", targetId);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      deviceLinkManager.setCompanionOpen(false);
      unsubscribeFrames();
      unsubscribeState();
    };
  }, [targetId]);
  // Pair refresh or account reconnection can restart the transport while this
  // screen stays mounted. Re-announce only to the selected PC.
  useEffect(() => {
    if (document.visibilityState === "visible") {
      deviceLinkManager.setCompanionOpen(true, targetId);
    }
  }, [transport.state, targetId]);
  useEffect(() => {
    setCursor(null);
    setMonitors([]);
    setSourceDeviceId(null);
    setRemotePhase("idle");
    remoteSpeech.current = { level: 0, at: 0 };
  }, [targetId]);
  useEffect(() => {
    if (targetId && !transport.localPeers.includes(targetId)) {
      setCursor(null);
      setMonitors([]);
      setSourceDeviceId(null);
      setRemotePhase("idle");
      remoteSpeech.current = { level: 0, at: 0 };
    }
  }, [targetId, transport.localPeers]);

  const localPhase = assistantPhase(snapshot);
  const locallyActive = snapshot.status !== "IDLE" && snapshot.status !== "ERROR";
  const linked = !!targetId && sourceDeviceId === targetId && transport.localPeers.includes(targetId);
  const phase = locallyActive ? localPhase : linked ? remotePhase : "idle";
  const vector = linked ? gaze : wander;
  useEffect(() => {
    // Sample the audio envelope without rerendering the rest of the Companion on
    // every PCM chunk. Never lip-sync to text timing or use microphone input.
    const timer = window.setInterval(() => {
      const audible = locallyActive ? assistant.speechLevel()
        : linked && Date.now() - remoteSpeech.current.at < 350 ? remoteSpeech.current.level : 0;
      setMouth(previous => {
        const next = previous * 0.35 + Math.min(1, Math.max(0, audible)) * 0.65;
        return next < 0.015 ? 0 : next;
      });
    }, 45);
    return () => window.clearInterval(timer);
  }, [assistant, locallyActive, linked]);

  useEffect(() => {
    if (linked) {
      setWander({ x: 0, y: 0 });
      return;
    }
    // Small, infrequent glances when no live PC cursor is available.
    const timer = window.setInterval(() => {
      setWander({ x: (Math.random() - 0.5) * 0.65, y: (Math.random() - 0.5) * 0.28 });
    }, 2600);
    return () => window.clearInterval(timer);
  }, [linked]);

  const expressivePhase = mouth > 0.085 ? "speaking" : phase;
  const active = snapshot.status === "READY" || snapshot.status === "RESPONDING" ||
    snapshot.status === "CONNECTING";

  return (
    <main className={`companion-view is-${expressivePhase}`} aria-label="Companion mode">
      <header className="companion-header">
        <button type="button" className="companion-exit" onClick={onExit} aria-label="Exit companion mode">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m14 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="1.7"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="companion-connection">
          <span className={linked ? "companion-dot connected" : "companion-dot"} aria-hidden="true" />
          {linked ? "LAN connected" : pairedWindows.length === 0 ? "Pair a PC in Devices"
            : !targetId ? "Choose a PC" : "Waiting for PC on Wi-Fi"}
        </span>
      </header>
      <div className="companion-stage">
        <svg className="companion-face" viewBox="0 0 360 260" role="img"
          aria-label={`Companion is ${PHASE_LABEL[expressivePhase].toLowerCase()}`}>
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
          <g className="companion-mouth-group" aria-hidden="true">
            <path className="companion-smile" d="M163 213 Q180 227 197 213" fill="none"
              stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"
              opacity={Math.max(0, 1 - mouth * 6)} />
            <ellipse className="companion-mouth-open" cx="180" cy={213 + mouth * 3}
              rx={14 + mouth * 12} ry={3 + mouth * 18}
              opacity={Math.min(1, mouth * 6)} />
            <ellipse className="companion-tongue" cx="180" cy={215 + mouth * 10}
              rx={8 + mouth * 5} ry={2 + mouth * 4}
              opacity={Math.max(0, Math.min(1, (mouth - 0.28) * 3))} />
            <path className="companion-upper-lip" d="M161 207 Q180 199 199 207"
              fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              opacity={Math.min(1, mouth * 4)} />
          </g>
        </svg>
        <p className="companion-phase" role="status">{PHASE_LABEL[expressivePhase]}</p>
      </div>
      <footer className="companion-controls">
        {(pairedWindows.length > 1 || (pairedWindows.length > 0 && !targetId)) && (
          <div className="companion-placement">
            <SelectField label="Companion PC" value={targetId ?? ""}
              options={[
                { value: "", label: "Choose a PC" },
                ...pairedWindows.map(d => ({ value: d.id, label: d.name })),
              ]}
              onChange={(next) => {
                setPreferredPC(next || null);
                if (currentDeviceId) saveRemoteVoiceDefault(currentDeviceId, next || null);
              }} />
          </div>
        )}
        {monitors.length > 1 && (
          <div className="companion-placement">
            <SelectField label="Phone below" value={String(Math.min(monitorIndex, monitors.length - 1))}
              options={[...monitors].sort((a, b) => a.x - b.x).map((_monitor, i) => ({
                value: String(i),
                label: monitors.length === 3 ? (["Left", "Center", "Right"][i] ?? "Center") : `Monitor ${i + 1}`,
              }))}
              onChange={(next) => {
                const index = Number(next);
                setSavedIndex(index);
                try { localStorage.setItem(positionKey, String(index)); } catch { /* Local preference only. */ }
              }} />
          </div>
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
