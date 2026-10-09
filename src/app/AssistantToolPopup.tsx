import { useEffect, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";

type Popup = {
  pending: { id: string; title: string; preview: string; working: boolean } | null;
  activity: { id: string; label: string; status: "running" | "completed" | "failed" } | null;
  computerPrompt: string | null;
  computerRunning: boolean;
};

const EMPTY: Popup = { pending: null, activity: null, computerPrompt: null, computerRunning: false };

/**
 * Fixed native popup independent of the draggable overlay tray.
 * Content scrolls within the card, while approval buttons remain accessible.
 */
export default function AssistantToolPopup() {
  const [state, setState] = useState<Popup>(EMPTY);

  useEffect(() => {
    const listener = listen<Popup>("assistant-popup-state", (event) => setState(event.payload));
    void listener.then(() => emitTo("main", "assistant-popup-ready", {}));
    return () => { void listener.then((unlisten) => unlisten()); };
  }, []);

  const approval = state.pending && !state.pending.working ? state.pending : null;
  const askComputer = !approval && state.computerPrompt;
  const label = approval?.title ??
    (askComputer ? "Computer action requires approval" : state.activity?.label ??
      (state.computerRunning ? "Computer task in progress" : ""));
  const status = approval || askComputer ? "Approval needed" :
    state.activity?.status === "failed" ? "Failed" :
    state.activity?.status === "completed" ? "Completed" : "Working";
  const detail = approval?.preview ?? (askComputer ? state.computerPrompt : null);
  const needsApproval = Boolean(approval || askComputer);

  function respond(allow: boolean) {
    void emitTo("main", "assistant-popup-answer", {
      id: approval?.id ?? null,
      computerPrompt: askComputer ?? null,
      allow,
      kind: approval ? "tool" : "computer",
    });
  }

  return (
    <div className="assistant-popup-card">
      <div className="assistant-popup-header">Personal Voice · {status}</div>
      <div className="assistant-popup-content">
        <div className="assistant-popup-title">{label}</div>
        {detail && <div className="assistant-popup-description">{detail}</div>}
        {!needsApproval && (
          <div className="assistant-popup-description is-muted">
            Actions and status are also visible in the Assistant page.
          </div>
        )}
      </div>
      {needsApproval && (
        <div className="assistant-popup-actions">
          <button className="assistant-popup-allow" type="button" onClick={() => respond(true)}>Allow once</button>
          <button className="assistant-popup-deny" type="button" onClick={() => respond(false)}>Deny</button>
        </div>
      )}
    </div>
  );
}
