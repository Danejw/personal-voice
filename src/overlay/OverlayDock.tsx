import { useEffect, useRef, useState, type PointerEvent } from "react";
import { BrandMark } from "@/app/BrandMark";
import { Tooltip } from "@/components/Tooltip";
import type { OverlayAction, OverlayDictation, OverlayHoldDestination, OverlaySnapshot } from "@/overlay/overlay";
import { setOverlayTipSpace } from "@/overlay/overlayTipSpace";

interface OverlayDockProps {
  snapshot: OverlaySnapshot;
  onAction(action: OverlayAction): void;
}

type ButtonTone = "" | "overlay-live" | "overlay-busy" | "overlay-bad";

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

/** Four small buttons at the corner of the screen. Hold note or handoff for that destination only. */
export function OverlayDock({ snapshot, onAction }: OverlayDockProps) {
  const [held, setHeld] = useState<OverlayHoldDestination | null>(null);
  const heldRef = useRef<OverlayHoldDestination | null>(null);
  const holdId = useRef(0);
  const blocked = !snapshot.signedIn || snapshot.paused || snapshot.dictation === "finalizing";
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

  return (
    <div
      className="overlay-dock"
      onMouseEnter={() => { void setOverlayTipSpace(true); }}
      onMouseLeave={() => { void setOverlayTipSpace(false); }}
    >
      <Tooltip content={dictateTitle} side="left" delayMs={280}>
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
      <Tooltip content="Hold for a voice note" side="left" delayMs={280}>
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
      <Tooltip content="Hold to send a handoff" side="left" delayMs={280}>
        <button
          type="button"
          className={`overlay-btn ${tone(snapshot.dictation, held === "send-to-device", false)}`}
          aria-label="Hold to send a handoff"
          disabled={blocked || (snapshot.dictation === "listening" && held !== "send-to-device")}
          onPointerDown={(event) => onHoldDown("send-to-device", event)}
          onPointerUp={() => onHoldUp("send-to-device")}
          onPointerCancel={() => onHoldUp("send-to-device")}
        >
          <SendIcon />
        </button>
      </Tooltip>
      <Tooltip content="Open Personal Voice" side="left" delayMs={280}>
        <button
          type="button"
          className="overlay-btn overlay-logo"
          aria-label="Open Personal Voice"
          onClick={() => onAction({ type: "open-settings" })}
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

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h12M13 7l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
