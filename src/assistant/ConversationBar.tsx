import { useState } from "react";
import type { AssistantLibrarySnapshot } from "@/assistant/AssistantConversationStore";

interface ConversationBarProps {
  library: AssistantLibrarySnapshot;
  signedIn: boolean;
  sessionIdle: boolean;
  onNew: () => void;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onRetry: () => void;
  onDismissRecovery?: (id: string) => void;
}

/** Compact thread list. Surfaces are fill and radius, with no strokes. */
export function ConversationBar({
  library,
  signedIn,
  sessionIdle,
  onNew,
  onOpen,
  onRename,
  onDelete,
  onRetry,
  onDismissRecovery,
}: ConversationBarProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  if (!signedIn) return null;

  return (
    <div className="assistant-threads">
      <div className="assistant-thread-bar">
        <button type="button" className="secondary" onClick={onNew}>New</button>
        <p className="assistant-save" role="status">
          {library.save === "saving" && "Saving…"}
          {library.save === "saved" && "Saved"}
          {library.save === "retry" && (
            <>
              {library.error ?? "Couldn't save."}{" "}
              <button type="button" className="secondary" onClick={onRetry}>Retry</button>
            </>
          )}
        </p>
      </div>
      {library.conversations.length > 0 && (
        <ul className="assistant-thread-list hide-scrollbar" aria-label="Saved conversations">
          {library.conversations.map((row) => (
            <li key={row.id} className={row.id === library.currentId ? "is-current" : undefined}>
              {editing === row.id ? (
                <form
                  className="assistant-thread-rename"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onRename(row.id, title);
                    setEditing(null);
                  }}
                >
                  <input
                    value={title}
                    aria-label="Conversation title"
                    onChange={(event) => setTitle(event.target.value)}
                  />
                  <button type="submit" className="secondary">Save</button>
                  <button type="button" className="secondary" onClick={() => setEditing(null)}>Cancel</button>
                </form>
              ) : (
                <>
                  <button type="button" className="assistant-thread" onClick={() => onOpen(row.id)}>{row.title}</button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setConfirming(null);
                      setEditing(row.id);
                      setTitle(row.title);
                    }}
                  >
                    Rename
                  </button>
                  {confirming === row.id ? (
                    <>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          onDelete(row.id);
                          setConfirming(null);
                        }}
                      >
                        Delete
                      </button>
                      <button type="button" className="secondary" onClick={() => setConfirming(null)}>Cancel</button>
                    </>
                  ) : (
                    <button type="button" className="secondary" onClick={() => { setEditing(null); setConfirming(row.id); }}>
                      Delete
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {library.holding && (
        <p className="note-meta">{sessionIdle ? "This device can continue." : "Continuing on this device."}</p>
      )}
      {!library.holding && library.activeLabel && library.activeLabel !== "this device" && (
        <p className="note-meta">Active on {library.activeLabel}. This device is only viewing.</p>
      )}
      {library.offlineCopy && (
        <p className="note-meta">Showing the saved copy on this device. Assistant needs a connection to continue.</p>
      )}
      {library.recovery.map((line) => (
        <p key={line.id} className="note-meta">
          Not shared. Another device continued. {line.text.length > 160 ? `${line.text.slice(0, 160)}…` : line.text}{" "}
          <button type="button" className="secondary" onClick={() => onDismissRecovery?.(line.id)}>Dismiss</button>
        </p>
      ))}
      {library.summaryNote && <p className="note-meta">{library.summaryNote}</p>}
      {library.unavailableScreenshots.map((shot) => (
        <p key={`${shot.capturedAt}-${shot.source}`} className="note-meta">
          A screenshot from {shot.source} at {shot.capturedAt} isn't available. This device can't see that image.
        </p>
      ))}
      {library.error && library.save !== "retry" && <p className="error" role="alert">{library.error}</p>}
      {sessionIdle && library.currentId && (
        <p className="note-meta">Saved on this account. Starting Assistant sends this conversation as earlier context. It does not run old actions again.</p>
      )}
    </div>
  );
}
