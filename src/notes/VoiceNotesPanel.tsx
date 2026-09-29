import { useState } from "react";
import { HoverActionItem } from "@/components/HoverActionItem";
import type { VoiceNotesSnapshot, VoiceNotesStatus, VoiceNotesStore } from "@/notes/VoiceNotesStore";
import type { VoiceNote } from "@/notes/voiceNote";

interface VoiceNotesPanelProps {
  store: VoiceNotesStore;
  snapshot: VoiceNotesSnapshot;
}

interface NoteGroupProps {
  empty: string;
  notes: VoiceNote[];
  busy: string | null;
  editable: boolean;
  className?: string;
  onCopy(note: VoiceNote): void;
  onArchive(note: VoiceNote, archived: boolean): void;
  onDelete(note: VoiceNote): void;
}

function statusLabel(status: VoiceNotesStatus): string {
  switch (status) {
    case "signed-out": return "Sign in";
    case "loading": return "Loading…";
    case "synced": return "Synced";
    case "offline": return "Offline";
    default: {
      const unhandled: never = status;
      throw new Error(`Unhandled notes status: ${String(unhandled)}`);
    }
  }
}

function NoteGroup({ empty, notes, busy, editable, className, onCopy, onArchive, onDelete }: NoteGroupProps) {
  return (
    <div className={className ? `note-group ${className}` : "note-group"}>
      {notes.length ? (
        <ul className="notes hide-scrollbar">
          {notes.map((note) => {
            const pending = busy?.endsWith(note.id) ?? false;
            const archived = note.status !== "inbox";
            return (
              <HoverActionItem
                key={note.id}
                busy={pending}
                actions={[
                  { kind: "copy", onClick: () => onCopy(note) },
                  {
                    kind: archived ? "unarchive" : "archive",
                    disabled: !editable,
                    onClick: () => onArchive(note, note.status === "inbox"),
                  },
                  { kind: "delete", disabled: !editable, onClick: () => onDelete(note) },
                ]}
              >
                <p className="note-text">{note.text}</p>
                <p className="note-meta">
                  <time dateTime={note.createdAt}>{new Date(note.createdAt).toLocaleString()}</time>
                </p>
              </HoverActionItem>
            );
          })}
        </ul>
      ) : (
        <p className="placeholder">{empty}</p>
      )}
    </div>
  );
}

/** Sync status + Refresh for the shared page header. */
export function VoiceNotesToolbar({ store, snapshot }: VoiceNotesPanelProps) {
  return (
    <div className="page-header-actions">
      <p role="status">{statusLabel(snapshot.status)}</p>
      {snapshot.status !== "signed-out" && (
        <button
          type="button"
          className="secondary"
          disabled={snapshot.status === "loading"}
          onClick={() => void store.reload()}
        >
          Refresh
        </button>
      )}
    </div>
  );
}

/** Synced notes explicitly created by choosing Voice note as the dictation destination. */
export function VoiceNotesPanel({ store, snapshot }: VoiceNotesPanelProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const editable = snapshot.status === "synced";
  const inbox = snapshot.notes.filter((note) => note.status === "inbox");
  const archived = snapshot.notes.filter((note) => note.status === "archived");

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setProblem(null);
    setNotice(null);
    try {
      await action();
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  function copy(note: VoiceNote) {
    void run(`copy:${note.id}`, async () => {
      await navigator.clipboard.writeText(note.text);
      setNotice("Note copied.");
    });
  }

  function archive(note: VoiceNote, archivedStatus: boolean) {
    void run(`archive:${note.id}`, () => store.setArchived(note.id, archivedStatus));
  }

  function remove(note: VoiceNote) {
    void run(`delete:${note.id}`, () => store.remove(note.id));
  }

  return (
    <>
      {(problem ?? snapshot.error) && <p className="error" role="alert">{problem ?? snapshot.error}</p>}
      {notice && <p role="status">{notice}</p>}
      <NoteGroup
        className="page-grow"
        empty="No notes"
        notes={inbox}
        busy={busy}
        editable={editable}
        onCopy={copy}
        onArchive={archive}
        onDelete={remove}
      />
      <details className="fold">
        <summary>Archived ({archived.length})</summary>
        <NoteGroup
          empty="No archived notes"
          notes={archived}
          busy={busy}
          editable={editable}
          onCopy={copy}
          onArchive={archive}
          onDelete={remove}
        />
      </details>
    </>
  );
}
