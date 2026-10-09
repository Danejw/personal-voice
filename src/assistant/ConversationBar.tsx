import { useState } from "react";
import { ConfirmDialog, useConfirmAction } from "@/components/ConfirmDialog";
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
  onRefresh?: () => void;
  hasUnlinkedTranscript?: boolean;
  onLoadOlder?: () => void;
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
export function ConversationBar({ library, signedIn, sessionIdle, onNew, onOpen, onRename, onDelete, onRetry, onRefresh, onLoadOlder, onDismissRecovery, hasUnlinkedTranscript = false }: ConversationBarProps) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const confirm = useConfirmAction();
  const visible = filterConversations(library.conversations, search);
  return (
    <aside id="assistant-threads" className="assistant-threads" aria-label="Conversation history">
      <div className="assistant-rail-heading">
        <h3>Conversations</h3>
        <div className="assistant-rail-heading-actions">
          <span className="assistant-rail-count">{library.conversations.length}</span>
          {signedIn && onRefresh && <button type="button" className="assistant-refresh-threads"
            aria-label="Refresh conversations" title="Refresh conversations" disabled={library.loadingThreads} onClick={onRefresh}>↻</button>}
        </div>
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
      <nav className="assistant-thread-scroll hide-scrollbar" aria-label="Saved conversations">
        {!signedIn && <p className="assistant-rail-empty">Sign in to see your conversations.</p>}
        {signedIn && visible.length === 0 && <p className="assistant-rail-empty" role="status">
          {library.loadingThreads ? "Loading saved conversations…" : search ? "No matching conversations." : library.error ? "Could not load saved conversations. Try Refresh." :
            hasUnlinkedTranscript ? "This transcript is not attached to a saved thread. Refresh or start a conversation to save new messages." :
            "No saved conversations found."}
        </p>}
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
                    onClick={() => onOpen(row.id)}>
                    <span className="assistant-thread-icon" aria-hidden="true">▤</span>
                    <span className="assistant-thread-content">
                      <span className="assistant-thread-title">{row.title}</span>
                      <span className="assistant-thread-meta">{row.updatedAt ? `Updated ${threadTime(row.updatedAt)}` : row.id === library.currentId ? "Selected thread" : "Saved conversation"}</span>
                    </span>
                  </button>
                  <div className="assistant-thread-actions">
                    <button type="button" aria-label={`Rename ${row.title}`} onClick={() => { setEditing(row.id); setTitle(row.title); }}>✎</button>
                    <button type="button" aria-label={`Delete ${row.title}`} onClick={() => confirm.ask({
                      title: "Delete conversation?",
                      description: `“${row.title}” and its saved messages will be permanently deleted. Separately saved memories are unaffected.`,
                      confirmLabel: "Delete conversation",
                      onConfirm: () => onDelete(row.id),
                    })}>×</button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>}
        {signedIn && library.hasOlder && onLoadOlder && (
          <button type="button" className="assistant-load-older" disabled={library.loadingOlder} onClick={onLoadOlder}>
            {library.loadingOlder ? "Loading…" : "Load older conversations"}
          </button>
        )}
      </nav>
      <div className="assistant-rail-footer">
        <p className="assistant-save" role="status">
          {library.loadingThreads ? "Refreshing history…" : library.save === "saving" ? "Saving conversation…" : library.save === "saved" ? "Conversations synced" :
            library.save === "retry" ? (library.error ?? "Could not save conversation.") :
              library.offlineCopy ? "Offline saved copy" : library.error ? "Conversation list unavailable" :
              library.conversations.length ? "Saved conversations" : "No saved threads yet"}
        </p>
        {library.save === "retry" && <button type="button" className="secondary" onClick={onRetry}>Retry save</button>}
        {library.holding && !sessionIdle && <p className="note-meta">Active on this device</p>}
        {!library.holding && library.activeLabel && library.activeLabel !== "this device" && (
          <p className="note-meta">Active on {library.activeLabel}. Continue here to take over.</p>
        )}
        {library.recovery.map((line) => (
          <p key={line.id} className="note-meta">Unsynced message: {line.text.slice(0, 100)}
            <button type="button" className="secondary" onClick={() => confirm.ask({
              title: "Discard unsynced message?",
              description: "This message has not been saved to your account. Dismissing this recovery copy may permanently lose its text.",
              confirmLabel: "Discard message",
              onConfirm: () => onDismissRecovery?.(line.id),
            })}>Dismiss</button>
          </p>
        ))}
        {library.summaryNote && <p className="note-meta">{library.summaryNote}</p>}
        {library.unavailableScreenshots.length > 0 && <p className="note-meta">Some screenshots are unavailable on this device.</p>}
        {library.error && library.save !== "retry" && <p className="error" role="alert">{library.error}</p>}
      </div>
      <ConfirmDialog request={confirm.request} onClose={confirm.dismiss} />
    </aside>
  );
}
