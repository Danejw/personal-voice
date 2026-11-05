import { useEffect, useMemo, useRef, useState } from "react";
import type { AssistantController } from "@/assistant/AssistantController";
import type { AssistantSnapshot } from "@/assistant/state";
import { deviceLinkManager } from "@/device-link/DeviceLinkManager";
import { SelectField } from "@/components/SelectField";
import { openPairingUI } from "@/devices/pairingFlow";
import { loadRemoteVoiceDefault, saveRemoteVoiceDefault } from "@/assistant/remoteVoiceTarget";
import type { OwnedDevice } from "@/handoffs/handoff";
import type { CompanionAssistantPhase, CompanionMonitor, DeviceLinkPayload } from "@/device-link/protocol";
import { assistantPhase, companionGaze, companionMouthVisible, defaultMonitorIndex, selectedCompanionPC, stepCompanionSpring } from "@/companion/companionGeometry";
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
  const faceRef = useRef<SVGGElement>(null);
  const hairRef = useRef<SVGGElement>(null);
  const tieRef = useRef<SVGGElement>(null);
  const motionTarget = useRef<Pointer>({ x: 0, y: 0 });
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
  useEffect(() => { motionTarget.current = vector; }, [vector]);

  // One damped motion rig: eyes, nose and mouth share the face movement.
  // Hair and tie react to face velocity with independent spring inertia.
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const resting = () => ({ value: 0, velocity: 0 });
    const motion = { x: resting(), y: resting(), hair: resting(), tie: resting() };
    let frame = 0;
    let previousTime = 0;

    const tick = (time: number) => {
      const dt = previousTime ? (time - previousTime) / 1000 : 1 / 60;
      previousTime = time;
      const seconds = time / 1000;
      const target = motionTarget.current;
      motion.x = stepCompanionSpring(motion.x,
        target.x * 10 + Math.sin(seconds * 0.85) * 1.5, dt, 90, 18);
      motion.y = stepCompanionSpring(motion.y,
        target.y * 6 + Math.sin(seconds * 1.1) * 1.8, dt, 90, 18);
      const hairLean = Math.max(-13, Math.min(13,
        -motion.x.velocity * 0.3 - motion.y.velocity * 0.1));
      const tieLean = Math.max(-10, Math.min(10,
        -motion.x.velocity * 0.19 + motion.y.velocity * 0.11));
      motion.hair = stepCompanionSpring(motion.hair, hairLean, dt, 135, 13);
      motion.tie = stepCompanionSpring(motion.tie, tieLean, dt, 75, 11);
      faceRef.current?.setAttribute("transform",
        "translate(" + motion.x.value.toFixed(2) + " " + motion.y.value.toFixed(2)
        + ") rotate(" + (motion.x.value * 0.22).toFixed(2) + " 180 155)");
      hairRef.current?.setAttribute("transform",
        "rotate(" + motion.hair.value.toFixed(2) + " 179 54)");
      tieRef.current?.setAttribute("transform",
        "rotate(" + motion.tie.value.toFixed(2) + " 180 244)");
      frame = window.requestAnimationFrame(tick);
    };

    const syncMotion = () => {
      window.cancelAnimationFrame(frame);
      if (media?.matches) {
        motion.x = resting();
        motion.y = resting();
        motion.hair = resting();
        motion.tie = resting();
        faceRef.current?.removeAttribute("transform");
        hairRef.current?.removeAttribute("transform");
        tieRef.current?.removeAttribute("transform");
      } else if (document.visibilityState === "visible") {
        previousTime = 0;
        frame = window.requestAnimationFrame(tick);
      }
    };
    media?.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncMotion);
    syncMotion();
    return () => {
      window.cancelAnimationFrame(frame);
      media?.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncMotion);
    };
  }, []);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setMouth(0);
      return;
    }
    // Sample the audio envelope without rerendering the rest of the Companion on
    // every PCM chunk. Never lip-sync to text timing or use microphone input.
    const timer = window.setInterval(() => {
      const localLevel = locallyActive ? assistant.speechLevel() : 0;
      const remoteLevel = linked && Date.now() - remoteSpeech.current.at < 350
        ? remoteSpeech.current.level : 0;
      const audible = Math.max(localLevel, remoteLevel);
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

  const expressivePhase = mouth > 0.085 && (locallyActive || linked) ? "speaking" : phase;
  const mouthVisible = companionMouthVisible(expressivePhase);
  const mouthOpen = expressivePhase === "speaking" ? Math.max(0.13, mouth) : 0;
  // One continuous path covers a small listening smile and an audio-responsive open mouth.
  const mouthWidth = 15 + mouthOpen * 11;
  const mouthPath = "M " + (180 - mouthWidth) + " 215 Q 180 " + (223 - mouthOpen * 18)
    + " " + (180 + mouthWidth) + " 215 Q 180 " + (223 + mouthOpen * 34)
    + " " + (180 - mouthWidth) + " 215 Z";
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
        {pairedWindows.length === 0 && (
          <button type="button" className="companion-pair-button"
            onClick={() => openPairingUI()} aria-label="Pair a Windows computer">
            Pair
          </button>
        )}
      </header>
      <div className="companion-stage">
        <svg className="companion-face" viewBox="0 0 360 340" role="img"
          aria-label={`Companion is ${PHASE_LABEL[expressivePhase].toLowerCase()}`}>
          <defs>
            <radialGradient id="companion-iris">
              <stop offset="0%" stopColor="#b5ffde" />
              <stop offset="100%" stopColor="#66ceab" />
            </radialGradient>
          </defs>
          <g ref={faceRef} className="companion-character">
            <g ref={hairRef} className="companion-hair" aria-hidden="true">
              <path d="M179 54 C192 40 193 28 181 27 C163 24 158 42 171 42 C191 44 199 25 194 7" />
            </g>
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
            <g className="companion-nose" aria-hidden="true">
              <ellipse cx="173" cy="199" rx="2.8" ry="4.1" transform="rotate(25 173 199)" />
              <ellipse cx="187" cy="199" rx="2.8" ry="4.1" transform="rotate(-25 187 199)" />
            </g>
            <g className={mouthVisible ? "companion-mouth-group is-visible" : "companion-mouth-group"}
              aria-hidden="true">
              <path className="companion-mouth" d={mouthPath} />
            </g>
            <g ref={tieRef} className="companion-tie" aria-hidden="true">
              <path className="companion-tie-knot" d="M171 243 Q180 238 189 243 L185 256 Q180 259 175 256 Z" />
              <path className="companion-tie-body" d="M175 256 Q180 259 185 256 L194 296 L180 317 L166 296 Z" />
              <path className="companion-tie-shine" d="M177 266 L173 293 L180 307"
                fill="none" strokeWidth="2.5" strokeLinecap="round" />
            </g>
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
