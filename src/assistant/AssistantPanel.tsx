import { useEffect, useRef, useState } from "react";
import { selectionPreview } from "@/assistant/selectionContext";
import { previewUrl } from "@/assistant/snapshotEncode";
import type { AssistantController } from "@/assistant/AssistantController";
import type { AssistantSource } from "@/assistant/grounding";
import { assistantStatusLabel, type AssistantSnapshot } from "@/assistant/state";

interface AssistantChromeProps {
  controller: AssistantController;
  snapshot: AssistantSnapshot;
  signedIn: boolean;
  micBusy?: boolean;
  onCaptureScreen?: () => Promise<void>;
  onContinueTask?: () => Promise<void>;
}

/** Header status and the Start / End control. */
export function AssistantHeader({ controller, snapshot, signedIn, micBusy = false }: AssistantChromeProps) {
  const running = snapshot.status === "CONNECTING" || snapshot.status === "READY" || snapshot.status === "RESPONDING";
  const label = assistantStatusLabel(snapshot, signedIn);
  return (
    <div className="page-header-actions">
      <p className={snapshot.status === "ERROR" ? "error" : "status"} role={snapshot.status === "ERROR" ? "alert" : "status"}>{label}</p>
      {import.meta.env.DEV && running && (
        <button type="button" className="secondary" onClick={() => controller.reconnect()}>
          Reconnect
        </button>
      )}
      <button
        type="button"
        className="record"
        disabled={(!running && !signedIn) || (!running && micBusy)}
        onClick={() => { if (running) controller.end(); else controller.start(); }}
      >
        {running ? "End Assistant" : "Start Assistant"}
      </button>
    </div>
  );
}

/** In-memory conversation and the typed-turn composer. */
export function AssistantPanel({ controller, snapshot, signedIn, onCaptureScreen, onContinueTask }: AssistantChromeProps) {
  const [draft, setDraft] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [continueNotice, setContinueNotice] = useState<string | null>(null);
  const [continueError, setContinueError] = useState<string | null>(null);
  const logRef = useRef<HTMLUListElement>(null);
  const canSend = signedIn && snapshot.status === "READY";

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [snapshot.turns, snapshot.liveText, snapshot.liveUser]);

  function send() {
    const text = draft.trim();
    if (!text || !canSend) return;
    controller.send(text);
    setDraft("");
  }

  return (
    <>
      <ul ref={logRef} className="assistant-log hide-scrollbar" aria-live="polite">
        {snapshot.turns.map((turn) => (
          <li key={turn.id} className={turn.role === "user" ? "assistant-turn is-user" : "assistant-turn"}>
            <span className="assistant-role">{turn.role === "user" ? "You" : "Assistant"}</span>
            <p>{turn.text}</p>
            {turn.role === "assistant" && turn.sources && <SourceList sources={turn.sources} />}
          </li>
        ))}
        {snapshot.liveUser && (
          <li className="assistant-turn is-user">
            <span className="assistant-role">You</span>
            <p className="partial">{snapshot.liveUser}</p>
          </li>
        )}
        {snapshot.liveText && (
          <li className="assistant-turn">
            <span className="assistant-role">Assistant</span>
            <p className="partial">{snapshot.liveText}</p>
            <SourceList sources={snapshot.liveSources} />
          </li>
        )}
        {!snapshot.turns.length && !snapshot.liveText && !snapshot.liveUser && (
          <li className="placeholder">Start Assistant, then speak or type a message.</li>
        )}
      </ul>
      {snapshot.continuedFrom && (
        <p className="note-meta">Continued from {snapshot.continuedFrom}. This is a new Assistant session.</p>
      )}
      {snapshot.selection && (
        <div className="selection-preview assistant-selection">
          <p className="note-meta">
            {snapshot.selection.sourceApp ? `From ${snapshot.selection.sourceApp}` : "Attached selection"}
          </p>
          <p>{selectionPreview(snapshot.selection.text)}</p>
          <button type="button" className="secondary" onClick={() => controller.detachSelection()}>Remove</button>
        </div>
      )}
      {snapshot.selectionError && <p className="error" role="alert">{snapshot.selectionError}</p>}
      {snapshot.notes.map((note) => (
        <div key={note.id} className="selection-preview assistant-selection">
          <p className="note-meta">Attached voice note · {new Date(note.createdAt).toLocaleString()}</p>
          <p>{selectionPreview(note.text)}</p>
          <button type="button" className="secondary" onClick={() => controller.detachNote(note.id)}>Remove</button>
        </div>
      ))}
      {snapshot.handoff && (
        <div className="selection-preview assistant-selection">
          <p className="note-meta">
            Attached handoff{snapshot.handoff.sourceLabel ? ` · ${snapshot.handoff.sourceLabel}` : ""}
          </p>
          <p>{selectionPreview(snapshot.handoff.text)}</p>
          <button type="button" className="secondary" onClick={() => controller.detachHandoff()}>Remove</button>
        </div>
      )}
      {snapshot.accountError && <p className="error" role="alert">{snapshot.accountError}</p>}
      <div className="assistant-selection">
        <button
          type="button"
          className="secondary"
          disabled={!onCaptureScreen || capturing}
          onClick={() => {
            if (!onCaptureScreen) return;
            setCapturing(true);
            void onCaptureScreen().finally(() => setCapturing(false));
          }}
        >
          {capturing ? "Capturing…" : snapshot.screen ? "Recapture" : "Capture screen"}
        </button>
        {snapshot.screen && (
          <>
            <img src={previewUrl(snapshot.screen)} alt="Captured screen" className="assistant-shot" />
            <p className="note-meta">
              Attached screenshot
              {` · ${snapshot.screen.source === "window" ? "Active window" : "Screen"}`}
              {snapshot.screen.sourceApp ? ` · ${snapshot.screen.sourceApp}` : ""}
              {` · ${new Date(snapshot.screen.capturedAt).toLocaleTimeString()}`}
            </p>
            <button type="button" className="secondary" onClick={() => controller.detachSnapshot()}>Remove</button>
          </>
        )}
      </div>
      {snapshot.screenError && <p className="error" role="alert">{snapshot.screenError}</p>}
      {(snapshot.computerRunning || snapshot.computerPrompt) && (
        <div className="assistant-action" role="region" aria-label="Supervised screen task">
          <p>{snapshot.computerPrompt ?? "A supervised screen task is running."}</p>
          <div className="assistant-action-buttons">
            {snapshot.computerPrompt && (
              <button type="button" className="secondary" onClick={() => controller.confirmComputer()}>Confirm</button>
            )}
            <button type="button" className="secondary" onClick={() => controller.stopComputer()}>Stop</button>
          </div>
        </div>
      )}
      {snapshot.pendingAction && (
        <div className="assistant-action" role="region" aria-label="Assistant wants to">
          <p className="note-meta">Assistant wants to:</p>
          <p>{snapshot.pendingAction.title}</p>
          <p>{snapshot.pendingAction.preview}</p>
          <div className="assistant-action-buttons">
            <button
              type="button"
              className="secondary"
              disabled={snapshot.pendingAction.working}
              onClick={() => controller.confirmPending()}
            >
              {snapshot.pendingAction.working ? "Working…" : "Confirm"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={snapshot.pendingAction.working}
              onClick={() => controller.cancelPending()}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {snapshot.actionNotice && <p className="status" role="status">{snapshot.actionNotice}</p>}
      {onContinueTask && (
        <button
          type="button"
          className="secondary"
          disabled={!signedIn || continuing || snapshot.turns.length === 0}
          onClick={() => {
            setContinuing(true);
            setContinueError(null);
            setContinueNotice(null);
            void onContinueTask()
              .then(() => setContinueNotice("Sent. On the other device, choose Continue."))
              .catch((reason: unknown) => setContinueError(reason instanceof Error ? reason.message : "Couldn't continue on another device."))
              .finally(() => setContinuing(false));
          }}
        >
          {continuing ? "Sending…" : "Continue on another device"}
        </button>
      )}
      {continueNotice && <p className="status" role="status">{continueNotice}</p>}
      {continueError && <p className="error" role="alert">{continueError}</p>}
      <form
        className="assistant-composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <input
          value={draft}
          placeholder="Type a message..."
          aria-label="Message"
          disabled={!canSend}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="secondary" disabled={!canSend || !draft.trim()}>Send</button>
      </form>
    </>
  );
}

function SourceList({ sources }: { sources: AssistantSource[] }) {
  if (!sources.length) return null;
  return (
    <ul className="assistant-sources">
      {sources.map((source) => (
        <li key={source.url}>
          <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
        </li>
      ))}
    </ul>
  );
}
