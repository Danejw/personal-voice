import {
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import { HoverActionItem } from "@/components/HoverActionItem";
import type { NotesSnapshot, NotesStatus, NotesStore } from "@/notes/NotesStore";
import type { Note } from "@/notes/note";
import { attachmentKind, formatAttachmentSize } from "@/notes/noteAttachment";
import type { NoteAttachment } from "@/notes/noteAttachment";

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
  onFiles(note: Note, files: File[]): void;
  onRemoveAttachment(note: Note, attachment: NoteAttachment): void;
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

function filesFrom(list: FileList | null): File[] {
  return list ? Array.from(list) : [];
}

function AttachmentPreview({
  attachment,
  editing,
  disabled,
  onRemove,
}: {
  attachment: NoteAttachment;
  editing: boolean;
  disabled: boolean;
  onRemove(): void;
}) {
  const kind = attachmentKind(attachment);
  return (
    <div className="note-attachment">
      {kind === "image" && (
        <a href={attachment.downloadUrl} target="_blank" rel="noreferrer" className="note-attachment-preview">
          <img src={attachment.downloadUrl} alt={attachment.fileName} loading="lazy" />
        </a>
      )}
      {kind === "video" && (
        <video className="note-attachment-preview" src={attachment.downloadUrl} controls preload="metadata">
          <track kind="captions" />
        </video>
      )}
      {kind === "audio" && (
        <audio className="note-attachment-audio" src={attachment.downloadUrl} controls preload="metadata">
          <track kind="captions" />
        </audio>
      )}
      <div className="note-attachment-meta">
        <a href={attachment.downloadUrl} target="_blank" rel="noreferrer" title={attachment.fileName}>
          {kind === "pdf" ? "PDF · " : ""}{attachment.fileName}
        </a>
        <span>{formatAttachmentSize(attachment.sizeBytes)}</span>
      </div>
      {editing && (
        <button
          type="button"
          className="secondary note-attachment-remove"
          disabled={disabled}
          onClick={onRemove}
        >
          Remove
        </button>
      )}
    </div>
  );
}

function AttachmentList({
  note,
  editing,
  disabled,
  onRemove,
}: {
  note: Note;
  editing: boolean;
  disabled: boolean;
  onRemove(note: Note, attachment: NoteAttachment): void;
}) {
  if (!note.attachments.length) return null;
  return (
    <div className="note-attachments">
      {note.attachments.map((attachment) => (
        <AttachmentPreview
          key={attachment.id}
          attachment={attachment}
          editing={editing}
          disabled={disabled}
          onRemove={() => onRemove(note, attachment)}
        />
      ))}
    </div>
  );
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
  onFiles,
  onRemoveAttachment,
  attachedIds = [],
  onAttach,
  onDetach,
}: NoteGroupProps) {
  return (
    <div className={className ? `note-group ${className}` : "note-group"}>
      {notes.length ? (
        <ul className="notes hide-scrollbar">
          {notes.map((note) => {
            const pending = busy?.includes(note.id) ?? false;
            const archived = note.status !== "inbox";
            const attached = attachedIds.includes(note.id);
            const editing = editingId === note.id;

            function addFiles(nextFiles: File[]) {
              if (!pending && nextFiles.length) onFiles(note, nextFiles);
            }

            function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
              const pasted = filesFrom(event.clipboardData.files);
              if (!pasted.length) return;
              event.preventDefault();
              addFiles(pasted);
            }

            function onDrop(event: DragEvent<HTMLDivElement>) {
              event.preventDefault();
              addFiles(filesFrom(event.dataTransfer.files));
            }

            function onChooseFiles(event: ChangeEvent<HTMLInputElement>) {
              addFiles(filesFrom(event.target.files));
              event.target.value = "";
            }

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
                  <div
                    className="note-edit"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={onDrop}
                  >
                    <textarea
                      aria-label="Edit note"
                      value={draft}
                      disabled={pending}
                      autoFocus
                      onPaste={onPaste}
                      onChange={(event) => onDraft(event.target.value)}
                    />
                    <AttachmentList
                      note={note}
                      editing
                      disabled={pending}
                      onRemove={onRemoveAttachment}
                    />
                    <div className="note-file-drop">
                      <span>Drop or paste files here</span>
                      <label className="secondary note-file-picker">
                        Add files
                        <input
                          type="file"
                          multiple
                          disabled={pending}
                          aria-label="Add files to note"
                          onChange={onChooseFiles}
                        />
                      </label>
                    </div>
                    <div className="note-edit-actions">
                      <button type="button" className="record" disabled={pending || !draft.trim()} onClick={() => onSave(note)}>
                        Save
                      </button>
                      <button type="button" className="secondary" disabled={pending} onClick={onCancelEdit}>
                        Cancel
                      </button>
                      {pending && <span className="note-file-status" role="status">Uploading…</span>}
                    </div>
                  </div>
                ) : (
                  <>
                    <p
                      className={editable ? "note-text is-editable" : "note-text"}
                      title={editable ? "Double-click to edit" : undefined}
                      onDoubleClick={() => { if (editable) onEdit(note); }}
                    >
                      {note.text}
                    </p>
                    <AttachmentList
                      note={note}
                      editing={false}
                      disabled={pending}
                      onRemove={onRemoveAttachment}
                    />
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

  function addFiles(note: Note, files: File[]) {
    void run(`files:${note.id}`, async () => {
      await store.addAttachments(note.id, files);
      setNotice(files.length === 1 ? "File attached." : `${files.length} files attached.`);
    });
  }

  function removeAttachment(note: Note, attachment: NoteAttachment) {
    void run(`attachment:${note.id}:${attachment.id}`, async () => {
      await store.removeAttachment(note.id, attachment);
      setNotice("Attachment removed.");
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
    onFiles: addFiles,
    onRemoveAttachment: removeAttachment,
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
