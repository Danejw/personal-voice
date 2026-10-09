import { useState } from "react";
import type { AssistantLibraryConversation, AssistantLibrarySnapshot } from "@/assistant/AssistantConversationStore";

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

export function filterConversations(rows: readonly AssistantLibraryConversation[], search: string) {
  const term = search.trim().toLocaleLowerCase();
  return term ? rows.filter((row) => row.title.toLocaleLowerCase().includes(term)) : rows;
}

export function threadTime(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The conversation rail owns thread navigation, not the main transcript. */
export function ConversationBar({ library, signedIn, sessionIdle, onNew, onOpen, onRename, onDelete, onRetry, onDismissRecovery }: ConversationBarProps) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const visible = filterConversations(library.conversations, search);
  return (
    <aside className="assistant-threads" aria-label="Conversation history">
      <div className="assistant-rail-heading">
        <div>
          <span className="assistant-eyebrow">YOUR SPACE</span>
          <h3>Conversations</h3>
        </div>
        <span className="assistant-rail-count">{library.conversations.length}</span>
      </div>
      <button type="button" className="assistant-new-thread" disabled={!signedIn} onClick={() => { setSearch(""); onNew(); }}>
        <span aria-hidden="true">＋</span> New conversation
      </button>
      <label className="assistant-search">
        <span className="visually-hidden">Search conversations by title</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.4"/><path d="m16 16 4 4"/></svg>
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
          placeholder="Search conversations" disabled={!signedIn} />
      </label>
      <div className="assistant-rail-subhead">Recent threads</div>
      <nav className="assistant-thread-scroll hide-scrollbar" aria-label="Saved conversations">
        {!signedIn && <p className="assistant-rail-empty">Sign in to see your conversations.</p>}
        {signedIn && visible.length === 0 && <p className="assistant-rail-empty">{search ? "No matching conversations." : "Your conversations will appear here."}</p>}
        {signedIn && <ul className="assistant-thread-list">
          {visible.map((row) => (
            <li key={row.id} className={row.id === library.currentId ? "is-current" : ""}>
              {editing === row.id ? (
                <form className="assistant-thread-rename" onSubmit={(event) => {
                  event.preventDefault();
                  if (title.trim()) onRename(row.id, title.trim());
                  setEditing(null);
                }}>
                  <input autoFocus value={title} aria-label="Conversation title" onChange={(event) => setTitle(event.target.value)} />
                  <div className="assistant-rename-actions">
                    <button type="submit" disabled={!title.trim()}>Save</button>
                    <button type="button" onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                </form>
              ) : (
                <>
                  <button type="button" className="assistant-thread" aria-current={row.id === library.currentId ? "page" : undefined}
                    onClick={() => { setConfirming(null); onOpen(row.id); }}>
                    <span className="assistant-thread-icon" aria-hidden="true">▤</span>
                    <span className="assistant-thread-content">
                      <span className="assistant-thread-title">{row.title}</span>
                      <span className="assistant-thread-meta">{row.updatedAt ? `Updated ${threadTime(row.updatedAt)}` : row.id === library.currentId ? "Selected thread" : "Saved conversation"}</span>
                    </span>
                  </button>
                  <div className="assistant-thread-actions">
                    {confirming === row.id ? (
                      <>
                        <button type="button" className="is-danger" onClick={() => { onDelete(row.id); setConfirming(null); }}>Delete</button>
                        <button type="button" onClick={() => setConfirming(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button type="button" aria-label={`Rename ${row.title}`} onClick={() => { setEditing(row.id); setTitle(row.title); setConfirming(null); }}>✎</button>
                        <button type="button" aria-label={`Delete ${row.title}`} onClick={() => { setConfirming(row.id); setEditing(null); }}>×</button>
                      </>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>}
      </nav>
      <div className="assistant-rail-footer">
        <p className="assistant-save" role="status">
          {library.save === "saving" ? "Saving conversation…" : library.save === "saved" ? "Conversations synced" :
            library.save === "retry" ? (library.error ?? "Could not save conversation.") :
              library.offlineCopy ? "Offline saved copy" : "Synced across your devices"}
        </p>
        {library.save === "retry" && <button type="button" className="secondary" onClick={onRetry}>Retry save</button>}
        {library.holding && !sessionIdle && <p className="note-meta">Active on this device</p>}
        {!library.holding && library.activeLabel && library.activeLabel !== "this device" && (
          <p className="note-meta">Active on {library.activeLabel}. Continue here to take over.</p>
        )}
        {library.recovery.map((line) => (
          <p key={line.id} className="note-meta">Unsynced message: {line.text.slice(0, 100)}
            <button type="button" className="secondary" onClick={() => onDismissRecovery?.(line.id)}>Dismiss</button>
          </p>
        ))}
        {library.summaryNote && <p className="note-meta">{library.summaryNote}</p>}
        {library.unavailableScreenshots.length > 0 && <p className="note-meta">Some screenshots are unavailable on this device.</p>}
        {library.error && library.save !== "retry" && <p className="error" role="alert">{library.error}</p>}
      </div>
    </aside>
  );
}
