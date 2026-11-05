import { useEffect, useMemo, useRef, useState } from "react";
import type { AssistantController } from "@/assistant/AssistantController";
import type { ComputerActionStore } from "@/assistant/ComputerActionStore";
import type { AssistantSnapshot } from "@/assistant/state";
import { deviceLinkManager } from "@/device-link/DeviceLinkManager";
import { SelectField } from "@/components/SelectField";
import { openPairingUI } from "@/devices/pairingFlow";
import { loadRemoteVoiceDefault, saveRemoteVoiceDefault } from "@/assistant/remoteVoiceTarget";
import type { OwnedDevice } from "@/handoffs/handoff";
import type { CompanionAssistantPhase, CompanionMonitor, DeviceLinkPayload } from "@/device-link/protocol";
import { assistantPhase, companionGaze, companionMouthVisible, defaultMonitorIndex, selectedCompanionPC, stepCompanionSpring } from "@/companion/companionGeometry";
import { remoteGoalStillActive } from "@/companion/remoteGoalStatus";
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
  assistant, computerActions, snapshot, micBusy, onStartVoice, onExit, currentDeviceId, devices,
}: {
  assistant: AssistantController;
  computerActions: ComputerActionStore;
  snapshot: AssistantSnapshot;
  micBusy: boolean;
  currentDeviceId: string | null;
  devices: OwnedDevice[];
  onStartVoice(): void;
  onExit(): void;
}) {
  const [transport, setTransport] = useState(() => deviceLinkManager.getSnapshot());
  const [remoteGoal, setRemoteGoal] = useState(() => computerActions.getSnapshot().remoteGoal);
  const [goalError, setGoalError] = useState<string | null>(null);
  const goalRequestPending = useRef(false);
  const [cursor, setCursor] = useState<Pointer | null>(null);
  const [monitors, setMonitors] = useState<CompanionMonitor[]>([]);
  const [remotePhase, setRemotePhase] = useState<CompanionAssistantPhase>("idle");
  const remoteSpeech = useRef({ level: 0, at: 0 });
  const [mouth, setMouth] = useState(0);
  const faceRef = useRef<SVGGElement>(null);
  const hairRef = useRef<SVGGElement>(null);
  const tieRef = useRef<SVGGElement>(null);
  const noseRef = useRef<SVGGElement>(null);
  const pressedRef = useRef(false);
  const [holding, setHolding] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const motionTarget = useRef<Pointer>({ x: 0, y: 0 });
  const [sourceDeviceId, setSourceDeviceId] = useState<string | null>(null);
  const [savedIndex, setSavedIndex] = useState<number | null>(storedMonitor);
  const [preferredPC, setPreferredPC] = useState<string | null>(
    () => currentDeviceId ? loadRemoteVoiceDefault(currentDeviceId) : null,
  );
  const pairedWindows = devices.filter(d => d.platform === "windows"
    && d.id !== currentDeviceId && transport.pairedPeers.includes(d.id));
  // An explicit default which is no longer paired must not silently select another PC.
  const targetId = selectedCompanionPC(pairedWindows, preferredPC);
  const currentGoal = remoteGoal?.targetDeviceId === targetId ? remoteGoal : null;
  const goalIsActive = !!currentGoal && remoteGoalStillActive(currentGoal.message);
  const refreshGoal = async (action: "computer_goal_status" | "stop_computer_goal") => {
    const target = pairedWindows.find(d => d.id === targetId);
    if (!target || goalRequestPending.current) return;
    goalRequestPending.current = true;
    try {
      await computerActions.remoteAction(action, "current", target.name);
      setGoalError(null);
    } catch (error) {
      setGoalError(error instanceof Error ? error.message : "Cannot reach the selected computer.");
    } finally { goalRequestPending.current = false; }
  };
  useEffect(() => computerActions.subscribe(() => {
    setRemoteGoal(computerActions.getSnapshot().remoteGoal);
  }), [computerActions]);
  useEffect(() => {
    if (!goalIsActive || !targetId) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshGoal("computer_goal_status");
    }, 20_000);
    return () => window.clearInterval(interval);
  }, [goalIsActive, targetId, computerActions, pairedWindows.map(d => d.id).join(",")]);
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
  const vector = linked ? gaze : { x: 0, y: 0 };
  useEffect(() => { motionTarget.current = vector; }, [vector]);
  useEffect(() => {
    assistant.setCompanionHoldMode(true);
    return () => assistant.setCompanionHoldMode(false);
  }, [assistant]);
  useEffect(() => {
    if (snapshot.status === "IDLE" || snapshot.status === "ERROR"
      || (snapshot.status === "RESPONDING" && snapshot.liveText.trim())) {
      setWaiting(false);
    }
  }, [snapshot.status, snapshot.liveText]);

  // A single head rig with independent gaze, nose, curl and tie inertia.
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const rest = () => ({ value: 0, velocity: 0 });
    const motion = {
      faceX: rest(), faceY: rest(), eyeX: rest(), eyeY: rest(),
      noseX: rest(), noseY: rest(), hairX: rest(), hairY: rest(),
      tieX: rest(), tieY: rest(),
    };
    let frame = 0;
    let previousTime = 0;

    const tick = (time: number) => {
      const dt = previousTime ? (time - previousTime) / 1000 : 1 / 60;
      previousTime = time;
      const sec = time / 1000;
      const cursorTarget = motionTarget.current;
      const lookX = linked ? cursorTarget.x
        : Math.sin(sec * 0.95) * 0.42 + Math.sin(sec * 0.43 + 1.2) * 0.14;
      const lookY = linked ? cursorTarget.y
        : Math.sin(sec * 1.12 + 0.6) * 0.24 + Math.sin(sec * 0.37) * 0.08;
      const step = (key: keyof typeof motion, target: number, k: number, d: number) => {
        motion[key] = stepCompanionSpring(motion[key], target, dt, k, d);
      };
      step("eyeX", lookX * 20, 110, 18);
      step("eyeY", lookY * 18, 110, 18);
      step("noseX", lookX * 4.6, 95, 16);
      step("noseY", lookY * 4.2, 95, 16);
      step("faceX", lookX * 12 + Math.sin(sec * 0.78) * 2.8, 90, 18);
      step("faceY", lookY * 8 + Math.sin(sec * 1.07) * 2.8, 90, 18);
      const hairLean = Math.max(-16, Math.min(16, -motion.faceX.velocity * 0.3));
      const hairBounce = Math.max(-9, Math.min(9,
        motion.faceY.velocity * 0.52 + Math.sin(sec * 2.9) * 4.1));
      step("hairX", hairLean, 100, 10);
      step("hairY", hairBounce, 118, 9);
      step("tieX", Math.max(-10, Math.min(10, -motion.faceX.velocity * 0.18)), 80, 10);
      step("tieY", Math.max(-5, Math.min(9, motion.faceY.velocity * 0.12)), 80, 10);
      faceRef.current?.setAttribute("transform",
        `translate(${motion.faceX.value.toFixed(2)} ${motion.faceY.value.toFixed(2)}) rotate(${(motion.faceX.value * 0.24).toFixed(2)} 180 167)`);
      const stretch = Math.max(0.83, Math.min(1.16, 1 + motion.hairY.value * 0.023));
      // (179,68) is the curl's attachment. Only the free coil squashes and rotates.
      hairRef.current?.setAttribute("transform",
        `translate(179 68) rotate(${motion.hairX.value.toFixed(2)}) scale(1 ${stretch.toFixed(3)})`);
      tieRef.current?.setAttribute("transform",
        `translate(0 ${motion.tieY.value.toFixed(2)}) rotate(${motion.tieX.value.toFixed(2)} 180 268)`);
      noseRef.current?.setAttribute("transform",
        `translate(${motion.noseX.value.toFixed(2)} ${motion.noseY.value.toFixed(2)})`);
      faceRef.current?.querySelectorAll(".companion-pupil").forEach((pupil) => {
        pupil.setAttribute("transform",
          `translate(${motion.eyeX.value.toFixed(2)} ${motion.eyeY.value.toFixed(2)})`);
      });
      frame = window.requestAnimationFrame(tick);
    };
    const sync = () => {
      window.cancelAnimationFrame(frame);
      if (media?.matches) {
        for (const key of Object.keys(motion) as (keyof typeof motion)[]) motion[key] = rest();
        faceRef.current?.removeAttribute("transform");
        hairRef.current?.setAttribute("transform", "translate(179 68)");
        tieRef.current?.removeAttribute("transform");
        noseRef.current?.removeAttribute("transform");
        faceRef.current?.querySelectorAll(".companion-pupil").forEach(p => p.removeAttribute("transform"));
      } else if (document.visibilityState === "visible") {
        previousTime = 0;
        frame = window.requestAnimationFrame(tick);
      }
    };
    media?.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      window.cancelAnimationFrame(frame);
      media?.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [linked]);

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

  const displayedPhase = holding ? "listening"
    : locallyActive && phase === "listening" ? (waiting ? "thinking" : "idle")
      : phase;
  const expressivePhase = mouth > 0.085 && (locallyActive || linked) ? "speaking" : displayedPhase;
  const mouthVisible = companionMouthVisible(expressivePhase);
  const mouthOpen = expressivePhase === "speaking" ? Math.max(0.13, mouth) : 0;
  // One continuous path covers a small listening smile and an audio-responsive open mouth.
  const mouthWidth = 15 + mouthOpen * 11;
  const mouthPath = "M " + (180 - mouthWidth) + " 228 Q 180 " + (236 - mouthOpen * 18)
    + " " + (180 + mouthWidth) + " 228 Q 180 " + (236 + mouthOpen * 34)
    + " " + (180 - mouthWidth) + " 228 Z";
  const active = snapshot.status === "READY" || snapshot.status === "RESPONDING" ||
    snapshot.status === "CONNECTING";
  const beginHold = () => {
    if (pressedRef.current || micBusy) return;
    pressedRef.current = true;
    setHolding(true);
    setWaiting(false);
    assistant.setCompanionPressed(true);
    if (!active) onStartVoice();
  };
  const endHold = () => {
    if (!pressedRef.current) return;
    pressedRef.current = false;
    assistant.setCompanionPressed(false);
    setHolding(false);
    setWaiting(true);
  };

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
        <svg className="companion-face" viewBox="0 0 360 370" role="button" tabIndex={0}
          aria-label="Press and hold Companion to speak" aria-pressed={holding}
          onContextMenu={(event) => event.preventDefault()}
          onDragStart={(event) => event.preventDefault()}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            beginHold();
          }}
          onPointerUp={endHold}
          onPointerCancel={endHold}
          onLostPointerCapture={endHold}
          onKeyDown={(event) => {
            if ((event.key === " " || event.key === "Enter") && !event.repeat) {
              event.preventDefault();
              beginHold();
            }
          }}
          onKeyUp={(event) => {
            if (event.key === " " || event.key === "Enter") {
              event.preventDefault();
              endHold();
            }
          }}
          onBlur={endHold}>
          <defs>
            <radialGradient id="companion-iris">
              <stop offset="0%" stopColor="#b5ffde" />
              <stop offset="100%" stopColor="#66ceab" />
            </radialGradient>
          </defs>
          <g ref={faceRef} className="companion-character">
            <g ref={hairRef} className="companion-hair" transform="translate(179 68)" aria-hidden="true">
              <path d="M0 0 C-4 -8 -14 -11 -12 -19 C-10 -28 0 -30 7 -26 C16 -21 11 -12 3 -13 C-6 -14 -9 -22 -6 -30 C-2 -39 13 -40 17 -32 C21 -24 10 -19 5 -24 C-1 -29 1 -42 10 -46 C21 -50 27 -41 20 -35 C13 -30 7 -38 10 -46 C13 -55 18 -57 13 -60" />
            </g>
            <g className="companion-eye companion-eye-left">
              <rect x="60" y="68" width="105" height="130" rx="53" className="companion-eye-shell" />
              <g className="companion-pupil">
                <ellipse cx="112" cy="133" rx="20" ry="28" fill="url(#companion-iris)" />
                <ellipse cx="112" cy="133" rx="10" ry="17" fill="#10251f" />
                <circle cx="105" cy="123" r="5" fill="#f0fff9" opacity=".85" />
              </g>
            </g>
            <g className="companion-eye companion-eye-right">
              <rect x="195" y="68" width="105" height="130" rx="53" className="companion-eye-shell" />
              <g className="companion-pupil">
                <ellipse cx="247" cy="133" rx="20" ry="28" fill="url(#companion-iris)" />
                <ellipse cx="247" cy="133" rx="10" ry="17" fill="#10251f" />
                <circle cx="240" cy="123" r="5" fill="#f0fff9" opacity=".85" />
              </g>
            </g>
            <g ref={noseRef} className="companion-nose" aria-hidden="true">
              <ellipse cx="173" cy="212" rx="2.8" ry="4.1" transform="rotate(25 173 212)" />
              <ellipse cx="187" cy="212" rx="2.8" ry="4.1" transform="rotate(-25 187 212)" />
            </g>
            <g className={mouthVisible ? "companion-mouth-group is-visible" : "companion-mouth-group"}
              aria-hidden="true">
              <path className="companion-mouth" d={mouthPath} />
            </g>
            <g ref={tieRef} className="companion-tie" aria-hidden="true">
              <g transform="translate(0 18)">
                <path className="companion-tie-wrap-shadow" d="M153 249 Q180 235 207 249" />
                <path className="companion-tie-wrap" d="M158 248 Q180 237 202 248" />
                <path className="companion-tie-knot" d="M171 254 Q180 248 189 254 L185 267 Q180 271 175 267 Z" />
                <path className="companion-tie-body" d="M175 267 Q180 271 185 267 L195 309 L180 336 L165 309 Z" />
                <path className="companion-tie-shine" d="M177 277 L173 304 L180 320"
                  fill="none" strokeWidth="2.5" strokeLinecap="round" />
              </g>
            </g>
          </g>
        </svg>
        <p className="companion-phase" role="status">{PHASE_LABEL[expressivePhase]}</p>
        {currentGoal && (
          <div className="companion-goal" role="status" aria-live="polite">
            <p>{currentGoal.phase === "queued" ? "Contacting Windows" : currentGoal.phase === "accepted" ? "Computer task accepted" : currentGoal.phase === "connection-error" ? "Computer connection issue" : "Computer task update"}</p>
            <p>{currentGoal.message.slice(0, 250)}</p>
            {goalError && <p>{goalError}</p>}
            <div className="companion-goal-actions">
              <button type="button" onClick={() => { void refreshGoal("computer_goal_status"); }}>Update</button>
              {goalIsActive && <button type="button" onClick={() => { void refreshGoal("stop_computer_goal"); }}>Stop</button>}
            </div>
          </div>
        )}
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

      </footer>
    </main>
  );
}
