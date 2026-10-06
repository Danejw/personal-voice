import { useState, type FormEvent } from "react";
import { HoverActionItem } from "@/components/HoverActionItem";
import type { NotesSnapshot, NotesStatus, NotesStore } from "@/notes/NotesStore";
import type { Note } from "@/notes/note";

interface NotesPanelProps {
  store: NotesStore;
  snapshot: NotesSnapshot;
  attachedNoteIds?: readonly string[];
  onAttachNote?: (note: Note) => string | null;
  onDetachNote?: (id: string) => void;
}

interface NoteGroupProps {
  empty: string;
  notes: Note[];
  busy: string | null;
  editable: boolean;
  editingId: string | null;
  draft: string;
  className?: string;
  onDraft(value: string): void;
  onSave(note: Note): void;
  onCancelEdit(): void;
  onEdit(note: Note): void;
  onCopy(note: Note): void;
  onArchive(note: Note, archived: boolean): void;
  onDelete(note: Note): void;
  attachedIds?: readonly string[];
  onAttach?(note: Note): void;
  onDetach?(id: string): void;
}

function statusLabel(status: NotesStatus): string {
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

function sourceLabel(note: Note): string {
  switch (note.sourceType) {
    case "voice": return "Voice";
    case "manual": return "Manual";
    case "assistant": return "Assistant";
  }
}

function NoteGroup({
  empty,
  notes,
  busy,
  editable,
  editingId,
  draft,
  className,
  onDraft,
  onSave,
  onCancelEdit,
  onEdit,
  onCopy,
  onArchive,
  onDelete,
  attachedIds = [],
  onAttach,
  onDetach,
}: NoteGroupProps) {
  return (
    <div className={className ? `note-group ${className}` : "note-group"}>
      {notes.length ? (
        <ul className="notes hide-scrollbar">
          {notes.map((note) => {
            const pending = busy?.endsWith(note.id) ?? false;
            const archived = note.status !== "inbox";
            const attached = attachedIds.includes(note.id);
            const editing = editingId === note.id;
            return (
              <HoverActionItem
                key={note.id}
                busy={pending}
                actions={editing ? [] : [
                  ...(onAttach && onDetach ? [{
                    kind: "attach" as const,
                    label: attached ? "Remove from Assistant" : "Attach to Assistant",
                    onClick: () => { if (attached) onDetach(note.id); else onAttach(note); },
                  }] : []),
                  { kind: "edit" as const, disabled: !editable, onClick: () => onEdit(note) },
                  { kind: "copy" as const, onClick: () => onCopy(note) },
                  {
                    kind: archived ? "unarchive" : "archive",
                    disabled: !editable,
                    onClick: () => onArchive(note, note.status === "inbox"),
                  },
                  { kind: "delete", disabled: !editable, onClick: () => onDelete(note) },
                ]}
              >
                {editing ? (
                  <div className="note-edit">
                    <textarea
                      aria-label="Edit note"
                      value={draft}
                      disabled={pending}
                      autoFocus
                      onChange={(event) => onDraft(event.target.value)}
                    />
                    <div className="note-edit-actions">
                      <button type="button" className="record" disabled={pending || !draft.trim()} onClick={() => onSave(note)}>
                        Save
                      </button>
                      <button type="button" className="secondary" disabled={pending} onClick={onCancelEdit}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="note-text">{note.text}</p>
                    <p className="note-meta">
                      <span>{sourceLabel(note)}</span>
                      {" · "}
                      <time dateTime={note.createdAt}>{new Date(note.createdAt).toLocaleString()}</time>
                    </p>
                  </>
                )}
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
export function NotesToolbar({ store, snapshot }: NotesPanelProps) {
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

/** Synced account notes. Dictation is one creation path, not a separate note type. */
export function NotesPanel({ store, snapshot, attachedNoteIds = [], onAttachNote, onDetachNote }: NotesPanelProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newNote, setNewNote] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
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

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = newNote.trim();
    if (!text) return;
    void run("create", async () => {
      await store.create(text, "manual");
      setNewNote("");
      setNotice("Note saved.");
    });
  }

  function copy(note: Note) {
    void run(`copy:${note.id}`, async () => {
      await navigator.clipboard.writeText(note.text);
      setNotice("Note copied.");
    });
  }

  function edit(note: Note) {
    setEditingId(note.id);
    setDraft(note.text);
    setProblem(null);
    setNotice(null);
  }

  function save(note: Note) {
    void run(`edit:${note.id}`, async () => {
      await store.updateText(note.id, draft);
      setEditingId(null);
      setDraft("");
      setNotice("Note updated.");
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft("");
  }

  function archive(note: Note, archivedStatus: boolean) {
    void run(`archive:${note.id}`, () => store.setArchived(note.id, archivedStatus));
  }

  function remove(note: Note) {
    if (editingId === note.id) cancelEdit();
    void run(`delete:${note.id}`, () => store.remove(note.id));
  }

  function attach(note: Note) {
    setProblem(onAttachNote?.(note) ?? null);
  }

  const groupProps = {
    busy,
    editable,
    editingId,
    draft,
    onDraft: setDraft,
    onSave: save,
    onCancelEdit: cancelEdit,
    onEdit: edit,
    onCopy: copy,
    onArchive: archive,
    onDelete: remove,
    attachedIds: attachedNoteIds,
    onAttach: onAttachNote ? attach : undefined,
    onDetach: onDetachNote,
  };

  return (
    <>
      <form className="note-compose" onSubmit={create}>
        <textarea
          aria-label="New note"
          placeholder="Write a note…"
          value={newNote}
          disabled={!editable || busy === "create"}
          onChange={(event) => setNewNote(event.target.value)}
        />
        <button type="submit" className="record" disabled={!editable || busy === "create" || !newNote.trim()}>
          Save note
        </button>
      </form>
      {(problem ?? snapshot.error) && <p className="error" role="alert">{problem ?? snapshot.error}</p>}
      {notice && <p role="status">{notice}</p>}
      <NoteGroup
        {...groupProps}
        className="page-grow"
        empty="No notes"
        notes={inbox}
      />
      <details className="fold">
        <summary>Archived ({archived.length})</summary>
        <NoteGroup
          {...groupProps}
          empty="No archived notes"
          notes={archived}
        />
      </details>
    </>
  );
}
