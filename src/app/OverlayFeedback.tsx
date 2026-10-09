import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

interface OverlayFeedbackState {
  kind: "notice" | "hint" | null;
  message: string | null;
}

const EMPTY: OverlayFeedbackState = { kind: null, message: null };

/**
 * Standalone bottom-right Windows window. The tray only sends events; neither
 * CSS overflow nor the tray's native HWND bounds can clip this message.
 */
export default function OverlayFeedback() {
  const [feedback, setFeedback] = useState<OverlayFeedbackState>(EMPTY);
  useEffect(() => {
    let active = true;
    const pending = listen<OverlayFeedbackState>("overlay-feedback-state", (event) => {
      if (active) setFeedback(event.payload);
    });
    // Listener first, then read native state in case initial show preceded mount.
    void pending.then(() => invoke<OverlayFeedbackState>("get_overlay_feedback")
      .then((value) => { if (active) setFeedback(value); })
      .catch(() => undefined));
    return () => { active = false; void pending.then((unlisten) => unlisten()); };
  }, []);

  if (!feedback.message) return null;
  return (
    <div className="overlay-feedback-shell" role="status" aria-live={feedback.kind === "notice" ? "polite" : "off"}>
      <div className="overlay-feedback-card">
        <div className="overlay-feedback-label">Personal Voice {feedback.kind === "notice" ? "· Notification" : "· Hint"}</div>
        <div className="overlay-feedback-message">{feedback.message}</div>
      </div>
    </div>
  );
}
