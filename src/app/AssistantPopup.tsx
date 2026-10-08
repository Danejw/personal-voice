import { useEffect, useState } from "react";
import { listen, emitTo } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export type AssistantPopupPayload =
  | { kind: "hidden" }
  | { kind: "working"; id: string; title: string }
  | { kind: "approval"; id: string; title: string; preview: string; working: boolean }
  | { kind: "computer-approval"; id: string; title: string; preview: string };

export default function AssistantPopup() {
  const [state, setState] = useState<AssistantPopupPayload>({ kind: "hidden" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const subscription = listen<AssistantPopupPayload>("assistant-popup-state", (event) => {
      setState(event.payload);
      setBusy(false);
    }).then(async (unsubscribe) => {
      const current = await invoke<AssistantPopupPayload>("assistant_popup_state").catch(() => null);
      if (current) setState(current);
      return unsubscribe;
    });
    return () => { void subscription.then((unsubscribe) => unsubscribe()); };
  }, []);
  const reply = (choice: "approve" | "deny" | "open") => {
    if (state.kind !== "approval" && state.kind !== "computer-approval") return;
    if (choice !== "open") setBusy(true);
    void emitTo("main", "assistant-popup-response", {
      id: state.id, kind: state.kind, choice,
    });
  };
  if (state.kind === "hidden") return null;
  const awaiting = state.kind === "approval" || state.kind === "computer-approval";
  return (
    <section className="assistant-popup" role={awaiting ? "alertdialog" : "status"}
      aria-label={awaiting ? "Assistant approval required" : "Assistant tool in progress"}>
      <div className="assistant-popup-heading">
        <span className={awaiting ? "assistant-popup-dot waiting" : "assistant-popup-dot working"} />
        <strong>Personal Voice</strong>
        <span className="assistant-popup-phase">{awaiting ? "Approval needed" : "Working"}</span>
      </div>
      <p className="assistant-popup-title">{state.title}</p>
      {awaiting ? (
        <>
          <p className="assistant-popup-preview">{state.preview}</p>
          <div className="assistant-popup-actions">
            <button type="button" onClick={() => reply("approve")} disabled={busy || (state.kind === "approval" && state.working)}>Allow once</button>
            <button type="button" onClick={() => reply("deny")} disabled={busy || (state.kind === "approval" && state.working)}>Deny</button>
            <button type="button" onClick={() => reply("open")}>Open app</button>
          </div>
        </>
      ) : (
        <p className="assistant-popup-preview">The assistant is using a tool. Progress will update automatically.</p>
      )}
    </section>
  );
}
