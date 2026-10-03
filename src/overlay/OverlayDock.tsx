import { useEffect, useRef, useState, type PointerEvent } from "react";
import { flushSync } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { BrandMark } from "@/app/BrandMark";
import { Tooltip } from "@/components/Tooltip";
import type { OverlayAction, OverlayAssistant, OverlayDictation, OverlayHoldDestination, OverlaySnapshot } from "@/overlay/overlay";
import { setOverlayConfirmSpace } from "@/overlay/overlayConfirmSpace";
import {
  commitOverlayPosition,
  dragOverlayTo,
  OVERLAY_DRAG_SLOP,
  startOverlayWindowDrag,
} from "@/overlay/overlayPosition";
import { setOverlayTipSpace, type OverlayTipSide } from "@/overlay/overlayTipSpace";
import { REMOTE_DICTATION_HOLD_MS } from "@/remote-dictation/constants";

interface OverlayDockProps {
  snapshot: OverlaySnapshot;
  onAction(action: OverlayAction): void;
}

type ButtonTone = "" | "overlay-live" | "overlay-busy" | "overlay-bad";

interface LogoDrag {
  pointerId: number;
  startScreenX: number;
  startScreenY: number;
  originX: number | null;
  originY: number | null;
  scale: number;
  dragging: boolean;
  /** OS `startDragging` took over; commit when moves settle. */
  osDrag: boolean;
}

function assistantTone(assistant: OverlayAssistant): ButtonTone {
  switch (assistant) {
    case "listening": return "overlay-live";
    case "responding": return "overlay-busy";
    case "error": return "overlay-bad";
    case "idle": return "";
    default: {
      const unhandled: never = assistant;
      throw new Error(`Unhandled overlay assistant: ${String(unhandled)}`);
    }
  }
}

function assistantLabel(assistant: OverlayAssistant, error: string | null): string {
  switch (assistant) {
    case "listening": return "End Assistant";
    case "responding": return "Assistant speaking";
    case "error": return error || "Retry Assistant";
    case "idle": return "Start Assistant";
    default: {
      const unhandled: never = assistant;
      throw new Error(`Unhandled overlay assistant: ${String(unhandled)}`);
    }
  }
}
function tone(dictation: OverlayDictation, owns: boolean, showError: boolean): ButtonTone {
  if (!owns) return "";
  switch (dictation) {
    case "listening": return "overlay-live";
    case "finalizing": return "overlay-busy";
    case "error": return showError ? "overlay-bad" : "";
    case "idle": return "";
    default: {
      const unhandled: never = dictation;
      throw new Error(`Unhandled overlay dictation: ${String(unhandled)}`);
    }
  }
}

/** Five small buttons. The Assistant button is its own action; the mic stays dictation. */
export function OverlayDock({ snapshot, onAction }: OverlayDockProps) {
  const [held, setHeld] = useState<OverlayHoldDestination | "remote" | null>(null);
  const [draggingTray, setDraggingTray] = useState(false);
  const [tipSide, setTipSide] = useState<OverlayTipSide>("left");
  const heldRef = useRef<OverlayHoldDestination | "remote" | null>(null);
  const holdId = useRef(0);
  const remoteHold = useRef<{
    pointerId: number;
    timer: ReturnType<typeof setTimeout> | null;
    started: boolean;
    targetId: string;
    id: number;
  } | null>(null);
  const logoDrag = useRef<LogoDrag | null>(null);
  const blocked = !snapshot.signedIn || snapshot.paused || snapshot.dictation === "finalizing";
  const remoteUnavailable = !snapshot.remoteTargetOnline || !snapshot.remoteTargetId;
  const remoteLabel = snapshot.remoteTargetLabel
    ? snapshot.remoteTargetOnline
      ? snapshot.remoteTargetLabel
      : `${snapshot.remoteTargetLabel} offline`
    : "No device online";
  const remoteTitle = snapshot.remoteDictationActive || held === "remote"
    ? `Remote Dictation → ${remoteLabel}`
    : `Tap to cycle · Hold for ${remoteLabel}`;
  const selectionHint = snapshot.selectionPreview
    ? ` Selection attached${snapshot.selectionSource ? ` from ${snapshot.selectionSource}` : ""}: ${snapshot.selectionPreview}`
    : "";
  const pendingHint = snapshot.pendingTitle
    ? ` Assistant wants to: ${snapshot.pendingTitle}${snapshot.pendingPreview ? `. ${snapshot.pendingPreview}` : ""}`
    : "";
  const cameraHint = snapshot.cameraOn ? " Camera On." : "";
  const assistantTitle = `${assistantLabel(snapshot.assistant, snapshot.assistantError)}${cameraHint}${selectionHint}${pendingHint}`;
  useEffect(() => {
    void setOverlayConfirmSpace(Boolean(snapshot.pendingTitle));
  }, [snapshot.pendingTitle]);
  useEffect(() => () => { void setOverlayConfirmSpace(false); }, []);
  const assistantBlocked = (!snapshot.signedIn || snapshot.paused) && snapshot.assistant !== "listening" && snapshot.assistant !== "responding";
  const dictateTitle = snapshot.paused
    ? "Paused"
    : snapshot.dictation === "listening"
      ? "Stop dictation"
      : snapshot.dictation === "finalizing"
        ? "Transcribing"
        : snapshot.dictation === "error"
          ? snapshot.error || "Try again"
          : "Dictate";

  useEffect(() => {
    if (snapshot.dictation === "idle" || snapshot.dictation === "error") setHeld(null);
  }, [snapshot.dictation]);

  useEffect(() => () => {
    void setOverlayTipSpace(false);
  }, []);

  useEffect(() => {
    if (draggingTray) void setOverlayTipSpace(false);
  }, [draggingTray]);

  // After OS drag, pointerup may not reach the button. Commit once movement settles.
  useEffect(() => {
    if (!draggingTray) return;
    const overlay = getCurrentWindow();
    let settle: ReturnType<typeof setTimeout> | null = null;
    let active = true;
    const finish = () => {
      if (!active) return;
      active = false;
      if (settle !== null) clearTimeout(settle);
      logoDrag.current = null;
      setDraggingTray(false);
      void commitOverlayPosition();
    };
    const pending = overlay.onMoved(() => {
      if (!logoDrag.current?.osDrag) return;
      if (settle !== null) clearTimeout(settle);
      settle = setTimeout(finish, 160);
    });
    return () => {
      active = false;
      if (settle !== null) clearTimeout(settle);
      void pending.then((unlisten) => unlisten());
    };
  }, [draggingTray]);

  function onHoldDown(destination: OverlayHoldDestination, event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || blocked || snapshot.dictation === "listening") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    holdId.current += 1;
    heldRef.current = destination;
    setHeld(destination);
    onAction({ type: "dictate-hold", phase: "start", destination, id: holdId.current });
  }

  function onHoldUp(destination: OverlayHoldDestination) {
    if (heldRef.current !== destination) return;
    heldRef.current = null;
    onAction({ type: "dictate-hold", phase: "stop", destination, id: holdId.current });
  }

  function onRemoteDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || blocked || snapshot.dictation === "listening" || remoteUnavailable || !snapshot.remoteTargetId) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    holdId.current += 1;
    const id = holdId.current;
    const targetId = snapshot.remoteTargetId;
    const pointerId = event.pointerId;
    remoteHold.current = { pointerId, timer: null, started: false, targetId, id };
    heldRef.current = "remote";
    setHeld("remote");
    remoteHold.current.timer = setTimeout(() => {
      const gesture = remoteHold.current;
      if (!gesture || gesture.pointerId !== pointerId || gesture.id !== id) return;
      gesture.started = true;
      onAction({ type: "remote-dictate-hold", phase: "start", targetId: gesture.targetId, id: gesture.id });
    }, REMOTE_DICTATION_HOLD_MS);
  }

  function onRemoteUp(event: PointerEvent<HTMLButtonElement>) {
    const gesture = remoteHold.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.timer) clearTimeout(gesture.timer);
    remoteHold.current = null;
    heldRef.current = null;
    setHeld(null);
    if (gesture.started) {
      onAction({ type: "remote-dictate-hold", phase: "stop", targetId: gesture.targetId, id: gesture.id });
      return;
    }
    // Short tap cycles the target and never starts the microphone.
    onAction({ type: "cycle-remote-target" });
  }

  function onRemoteCancel(event: PointerEvent<HTMLButtonElement>) {
    const gesture = remoteHold.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.timer) clearTimeout(gesture.timer);
    remoteHold.current = null;
    heldRef.current = null;
    setHeld(null);
    if (gesture.started) {
      onAction({ type: "remote-dictate-hold", phase: "stop", targetId: gesture.targetId, id: gesture.id });
    }
  }

  function onLogoDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const pointerId = event.pointerId;
    logoDrag.current = {
      pointerId,
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      originX: null,
      originY: null,
      scale: 1,
      dragging: false,
      osDrag: false,
    };
    // Best-effort origin for the manual fallback. Do not clear the gesture if this fails.
    void Promise.all([getCurrentWindow().outerPosition(), getCurrentWindow().scaleFactor()])
      .then(([position, scale]) => {
        const drag = logoDrag.current;
        if (!drag || drag.pointerId !== pointerId) return;
        drag.originX = position.x;
        drag.originY = position.y;
        drag.scale = scale;
      })
      .catch(() => {});
  }

  function onLogoMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = logoDrag.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.osDrag) return;
    const dx = event.screenX - drag.startScreenX;
    const dy = event.screenY - drag.startScreenY;
    if (!drag.dragging) {
      if (Math.hypot(dx, dy) < OVERLAY_DRAG_SLOP) return;
      drag.dragging = true;
      setDraggingTray(true);
      // Collapse tip first (buttons stay put), then lock pin and hand drag to the OS.
      void setOverlayTipSpace(false)
        .then(() => startOverlayWindowDrag())
        .then(() => {
          if (logoDrag.current?.pointerId === drag.pointerId) drag.osDrag = true;
        })
        .catch(() => {});
      return;
    }
    if (drag.originX === null || drag.originY === null) return;
    void dragOverlayTo(drag.originX + dx * drag.scale, drag.originY + dy * drag.scale);
  }

  function onLogoUp(event: PointerEvent<HTMLButtonElement>) {
    const drag = logoDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // OS drag commits from the moved-settle effect.
    if (drag.osDrag) return;
    logoDrag.current = null;
    if (drag.dragging) {
      setDraggingTray(false);
      void commitOverlayPosition();
      return;
    }
    onAction({ type: "open-settings" });
  }

  return (
    <div
      className={[
        "overlay-dock",
        draggingTray ? "is-dragging" : "",
        tipSide === "right" ? "is-tip-right" : "",
      ].filter(Boolean).join(" ")}
      onMouseEnter={() => {
        if (draggingTray) return;
        void setOverlayTipSpace(true, (side) => {
          flushSync(() => setTipSide(side));
        });
      }}
      onMouseLeave={() => { void setOverlayTipSpace(false); }}
    >
      <Tooltip content={dictateTitle} side={tipSide} delayMs={280}>
        <button
          type="button"
          className={`overlay-btn ${tone(snapshot.dictation, held === null, true)}`}
          aria-label={dictateTitle}
          disabled={blocked && snapshot.dictation !== "listening"}
          onClick={() => onAction({ type: "dictate-toggle" })}
        >
          <MicIcon />
        </button>
      </Tooltip>
      <Tooltip content="Hold for a voice note" side={tipSide} delayMs={280}>
        <button
          type="button"
          className={`overlay-btn ${tone(snapshot.dictation, held === "voice-note", false)}`}
          aria-label="Hold for a voice note"
          disabled={blocked || (snapshot.dictation === "listening" && held !== "voice-note")}
          onPointerDown={(event) => onHoldDown("voice-note", event)}
          onPointerUp={() => onHoldUp("voice-note")}
          onPointerCancel={() => onHoldUp("voice-note")}
        >
          <NoteIcon />
        </button>
      </Tooltip>
      <Tooltip content={remoteTitle} side={tipSide} delayMs={280}>
        <button
          type="button"
          className={`overlay-btn ${tone(snapshot.dictation, held === "remote" || snapshot.remoteDictationActive, false)}${remoteUnavailable ? " is-dim" : ""}`}
          aria-label={remoteTitle}
          disabled={blocked || remoteUnavailable || (snapshot.dictation === "listening" && held !== "remote" && !snapshot.remoteDictationActive)}
          onPointerDown={(event) => onRemoteDown(event)}
          onPointerUp={(event) => onRemoteUp(event)}
          onPointerCancel={(event) => onRemoteCancel(event)}
        >
          <RemoteDeviceIcon kind={snapshot.remoteTargetKind} />
        </button>
      </Tooltip>
      <Tooltip content={assistantTitle} side={tipSide} delayMs={280}>
        <button
          type="button"
          className={`overlay-btn ${assistantTone(snapshot.assistant)}${snapshot.cameraOn ? " overlay-camera-on" : ""}`}
          aria-label={assistantTitle}
          disabled={assistantBlocked}
          onClick={() => onAction({ type: "assistant-toggle" })}
        >
          <AssistantIcon />
          {snapshot.cameraOn && <span className="overlay-camera-dot" aria-hidden="true" />}
        </button>
      </Tooltip>
      {snapshot.pendingTitle && (
        <>
          <Tooltip content={snapshot.pendingWorking ? "Working…" : snapshot.pendingTitle} side={tipSide} delayMs={280}>
            <button
              type="button"
              className="overlay-btn"
              aria-label="Confirm"
              disabled={snapshot.pendingWorking}
              onClick={() => onAction({ type: "confirm-action" })}
            >
              <CheckIcon />
            </button>
          </Tooltip>
          <Tooltip content="Cancel" side={tipSide} delayMs={280}>
            <button
              type="button"
              className="overlay-btn"
              aria-label="Cancel"
              disabled={snapshot.pendingWorking}
              onClick={() => onAction({ type: "cancel-action" })}
            >
              <CrossIcon />
            </button>
          </Tooltip>
        </>
      )}
      <Tooltip content="Open Personal Voice" side={tipSide} delayMs={280}>
        <button
          type="button"
          className="overlay-btn overlay-logo"
          aria-label="Open Personal Voice"
          onPointerDown={(event) => { void onLogoDown(event); }}
          onPointerMove={onLogoMove}
          onPointerUp={onLogoUp}
          onPointerCancel={onLogoUp}
        >
          <BrandMark />
        </button>
      </Tooltip>
    </div>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 14a3 3 0 0 0 3-3V7a3 3 0 0 0-6 0v4a3 3 0 0 0 3 3z" fill="currentColor" />
      <path d="M8 11a4 4 0 0 0 8 0M12 15v3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4.5h7.5L18 8v11.5H7z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M14.5 4.5V8H18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function RemoteDeviceIcon({ kind }: { kind: OverlaySnapshot["remoteTargetKind"] }) {
  switch (kind) {
    case "phone":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="8" y="3.5" width="8" height="17" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <path d="M11 17.5h2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case "laptop":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="5" y="5.5" width="14" height="9.5" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <path d="M3.5 17.5h17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case "desktop":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4.5" y="4" width="15" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <path d="M9.5 18.5h5M12 15v3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case "unknown":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12h12M13 7l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default: {
      const unhandled: never = kind;
      throw new Error(`Unhandled remote device kind: ${String(unhandled)}`);
    }
  }
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 12.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 8l8 8M16 8l-8 8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function AssistantIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4.5v3M12 16.5v3M4.5 12h3M16.5 12h3M7 7l2 2M15 15l2 2M17 7l-2 2M9 15l-2 2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
