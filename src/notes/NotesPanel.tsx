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
import type { NoteGroup } from "@/notes/noteGroup";
import { attachmentKind, formatAttachmentSize } from "@/notes/noteAttachment";
import type { NoteAttachment } from "@/notes/noteAttachment";
import { TransformBox } from "@/transforms/TransformBox";
import type { TransformProfile } from "@/transforms/transformProfile";

interface NotesPanelProps {
  store: NotesStore;
  snapshot: NotesSnapshot;
  attachedNoteIds?: readonly string[];
  onAttachNote?: (note: Note) => string | null;
  onDetachNote?: (id: string) => void;
  transformProfiles?: readonly TransformProfile[];
}

interface NoteCardProps {
  note: Note;
  groups: readonly NoteGroup[];
  busy: string | null;
  editable: boolean;
  editingId: string | null;
  draft: string;
  draftTitle: string;
  draftGroupId: string;
  onDraft(value: string): void;
  onDraftTitle(value: string): void;
  onDraftGroupId(value: string): void;
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
  transformProfiles: readonly TransformProfile[];
  transformingId: string | null;
  onToggleTransform(note: Note): void;
  onTransformReplace(note: Note, text: string): Promise<void>;
  onTransformSave(text: string): Promise<void>;
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

function sourceMark(note: Note): string {
  switch (note.sourceType) {
    case "voice": return "V";
    case "manual": return "M";
    case "assistant": return "AI";
  }
}

function displayTitle(note: Note): string {
  if (note.title?.trim()) return note.title.trim();
  const compact = note.text.replace(/\s+/g, " ").trim();
  if (!compact) return "Untitled note";
  return compact.length <= 72 ? compact : `${compact.slice(0, 69).trimEnd()}…`;
}

function previewText(note: Note): string {
  const compact = note.text.replace(/\s+/g, " ").trim();
  return compact.length <= 180 ? compact : `${compact.slice(0, 177).trimEnd()}…`;
}

function filesFrom(list: FileList | null): File[] {
  return list ? Array.from(list) : [];
}

function filesFromClipboard(data: DataTransfer): File[] {
  const direct = filesFrom(data.files);
  if (direct.length) return direct;
  return Array.from(data.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
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
        <video className="note-attachment-preview" src={attachment.downloadUrl} controls preload="metadata" />
      )}
      {kind === "audio" && (
        <audio className="note-attachment-audio" src={attachment.downloadUrl} controls preload="metadata" />
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

function NoteCard(props: NoteCardProps) {
  const {
    note,
    groups,
    busy,
    editable,
    editingId,
    draft,
    draftTitle,
    draftGroupId,
    onDraft,
    onDraftTitle,
    onDraftGroupId,
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
    transformProfiles,
    transformingId,
    onToggleTransform,
    onTransformReplace,
    onTransformSave,
  } = props;
  const pending = busy?.includes(note.id) ?? false;
  const archived = note.status !== "inbox";
  const attached = attachedIds.includes(note.id);
  const editing = editingId === note.id;
  const groupName = note.groupId ? groups.find((group) => group.id === note.groupId)?.name : null;

  function addFiles(nextFiles: File[]) {
    if (!pending && nextFiles.length) onFiles(note, nextFiles);
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = filesFromClipboard(event.clipboardData);
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
      busy={pending}
      actions={editing ? [] : [
        ...(onAttach && onDetach ? [{
          kind: "attach" as const,
          label: attached ? "Remove from Assistant" : "Attach to Assistant",
          onClick: () => { if (attached) onDetach(note.id); else onAttach(note); },
        }] : []),
        { kind: "edit" as const, disabled: !editable, onClick: () => onEdit(note) },
        ...(transformProfiles.length ? [{ kind: "transform" as const, onClick: () => onToggleTransform(note) }] : []),
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
          <label className="note-edit-field">
            <span>Title</span>
            <input
              aria-label="Note title"
              value={draftTitle}
              maxLength={120}
              disabled={pending}
              autoFocus
              onChange={(event) => onDraftTitle(event.target.value)}
            />
          </label>
          <label className="note-edit-field">
            <span>Group</span>
            <select
              aria-label="Note group"
              value={draftGroupId}
              disabled={pending}
              onChange={(event) => onDraftGroupId(event.target.value)}
            >
              <option value="">Ungrouped</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>{group.name}</option>
              ))}
            </select>
          </label>
          <textarea
            aria-label="Edit note"
            value={draft}
            disabled={pending}
            onPaste={onPaste}
            onChange={(event) => onDraft(event.target.value)}
          />
          <AttachmentList note={note} editing disabled={pending} onRemove={onRemoveAttachment} />
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
            <button
              type="button"
              className="record"
              disabled={pending || !draft.trim() || !draftTitle.trim()}
              onClick={() => onSave(note)}
            >
              Save
            </button>
            <button type="button" className="secondary" disabled={pending} onClick={onCancelEdit}>
              Cancel
            </button>
            {pending && <span className="note-file-status" role="status">Saving…</span>}
          </div>
        </div>
      ) : (
        <>
          <h3
            className={editable ? "note-title is-editable" : "note-title"}
            title={editable ? "Double-click to edit" : undefined}
            onDoubleClick={() => { if (editable) onEdit(note); }}
          >
            {displayTitle(note)}
          </h3>
          <p className="note-text note-preview-text">{previewText(note)}</p>
          <AttachmentList note={note} editing={false} disabled={pending} onRemove={onRemoveAttachment} />
          <p className="note-meta">
            <span>{sourceLabel(note)}</span>
            {groupName && <><span> · </span><span>{groupName}</span></>}
            <span> · </span>
            <time dateTime={note.createdAt}>{new Date(note.createdAt).toLocaleString()}</time>
          </p>
          {transformingId === note.id && (
            <TransformBox
              sourceText={note.text}
              profiles={transformProfiles}
              disabled={!editable}
              onClose={() => onToggleTransform(note)}
              actions={[
                { label: "Replace note", run: (text) => onTransformReplace(note, text) },
                { label: "Save as new note", run: onTransformSave },
              ]}
            />
          )}
        </>
      )}
    </HoverActionItem>
  );
}

function NoteCardGrid(props: Omit<NoteCardProps, "note"> & { notes: readonly Note[]; className?: string }) {
  const { notes, className, ...cardProps } = props;
  return (
    <ul className={className ? `note-card-grid ${className}` : "note-card-grid"}>
      {notes.map((note) => <NoteCard key={note.id} note={note} {...cardProps} />)}
    </ul>
  );
}

function GroupCard({
  group,
  notes,
  expanded,
  renaming,
  renameDraft,
  editable,
  busy,
  onToggle,
  onBeginRename,
  onRenameDraft,
  onSaveRename,
  onCancelRename,
  cardProps,
}: {
  group: NoteGroup;
  notes: readonly Note[];
  expanded: boolean;
  renaming: boolean;
  renameDraft: string;
  editable: boolean;
  busy: boolean;
  onToggle(): void;
  onBeginRename(): void;
  onRenameDraft(value: string): void;
  onSaveRename(): void;
  onCancelRename(): void;
  cardProps: Omit<NoteCardProps, "note">;
}) {
  return (
    <li className={expanded ? "note-group-card is-expanded" : "note-group-card"}>
      <div className="note-group-card-head">
        {renaming ? (
          <div className="note-group-rename">
            <input
              aria-label="Group name"
              value={renameDraft}
              maxLength={120}
              disabled={busy}
              autoFocus
              onChange={(event) => onRenameDraft(event.target.value)}
            />
            <button type="button" className="secondary" disabled={busy || !renameDraft.trim()} onClick={onSaveRename}>Save</button>
            <button type="button" className="secondary" disabled={busy} onClick={onCancelRename}>Cancel</button>
          </div>
        ) : (
          <>
            <div className="note-group-heading">
              <h3>{group.name}</h3>
              <span>{notes.length} {notes.length === 1 ? "note" : "notes"}</span>
            </div>
            <div className="note-group-card-actions">
              <button type="button" className="secondary" disabled={!editable || busy} onClick={onBeginRename}>Rename</button>
              <button type="button" className="secondary" onClick={onToggle}>{expanded ? "Close" : "Open"}</button>
            </div>
          </>
        )}
      </div>
      <div className="note-group-mini-grid" aria-label={`${group.name} note preview`}>
        {notes.slice(0, 6).map((note) => (
          <button key={note.id} type="button" className="note-mini-card" onClick={onToggle}>
            <span className="note-mini-mark" aria-hidden="true">{sourceMark(note)}</span>
            <span>{displayTitle(note)}</span>
          </button>
        ))}
      </div>
      {notes.length > 6 && <p className="note-group-more">+{notes.length - 6} more</p>}
      {expanded && (
        <div className="note-group-expanded">
          <NoteCardGrid notes={notes} {...cardProps} />
        </div>
      )}
    </li>
  );
}

/** Sync and enrichment status for the shared page header. */
export function NotesToolbar({ store, snapshot }: NotesPanelProps) {
  return (
    <div className="page-header-actions">
      <p role="status">{snapshot.organizing ? "Organizing…" : statusLabel(snapshot.status)}</p>
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

/** Visual account Notes workspace: stable titles, reusable groups, and ungrouped cards. */
export function NotesPanel({
  store,
  snapshot,
  attachedNoteIds = [],
  onAttachNote,
  onDetachNote,
  transformProfiles = [],
}: NotesPanelProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newNote, setNewNote] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftGroupId, setDraftGroupId] = useState("");
  const [transformingId, setTransformingId] = useState<string | null>(null);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState("");
  const editable = snapshot.status === "synced";

  const inbox = snapshot.notes.filter((note) => note.status === "inbox");
  const archived = snapshot.notes.filter((note) => note.status === "archived");
  const ungrouped = inbox.filter((note) => note.groupId === null);
  const groupNotes = new Map(snapshot.groups.map((group) => [
    group.id,
    inbox.filter((note) => note.groupId === group.id),
  ]));
  const visibleGroups = snapshot.groups.filter((group) => (groupNotes.get(group.id)?.length ?? 0) > 0);

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
      setNotice("Note saved. Its title and group will organize automatically.");
    });
  }

  function copy(note: Note) {
    void run(`copy:${note.id}`, async () => {
      await navigator.clipboard.writeText(note.text);
      setNotice("Note copied.");
    });
  }

  function edit(note: Note) {
    setTransformingId(null);
    setEditingId(note.id);
    setDraft(note.text);
    setDraftTitle(displayTitle(note));
    setDraftGroupId(note.groupId ?? "");
    setProblem(null);
    setNotice(null);
  }

  function save(note: Note) {
    void run(`edit:${note.id}`, async () => {
      await store.updateDetails(
        note.id,
        draft,
        draftTitle,
        draftGroupId || null,
        draftGroupId !== (note.groupId ?? ""),
      );
      setEditingId(null);
      setDraft("");
      setDraftTitle("");
      setDraftGroupId("");
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
    setDraftTitle("");
    setDraftGroupId("");
  }

  function archive(note: Note, archivedStatus: boolean) {
    void run(`archive:${note.id}`, () => store.setArchived(note.id, archivedStatus));
  }

  function remove(note: Note) {
    if (editingId === note.id) cancelEdit();
    if (transformingId === note.id) setTransformingId(null);
    void run(`delete:${note.id}`, () => store.remove(note.id));
  }

  function attach(note: Note) {
    setProblem(onAttachNote?.(note) ?? null);
  }

  function toggleTransform(note: Note) {
    setEditingId(null);
    setTransformingId((current) => current === note.id ? null : note.id);
    setProblem(null);
    setNotice(null);
  }

  async function replaceFromTransform(note: Note, text: string) {
    await store.updateText(note.id, text);
    setTransformingId(null);
    setNotice("Note replaced with transformed text. Its title and group stayed unchanged.");
  }

  async function saveFromTransform(text: string) {
    await store.create(text, "manual");
    setTransformingId(null);
    setNotice("Transformed text saved as a new note.");
  }

  function beginRenameGroup(group: NoteGroup) {
    setEditingGroupId(group.id);
    setGroupDraft(group.name);
    setProblem(null);
    setNotice(null);
  }

  function saveGroupName(group: NoteGroup) {
    void run(`group:${group.id}`, async () => {
      await store.renameGroup(group.id, groupDraft);
      setEditingGroupId(null);
      setGroupDraft("");
      setNotice("Group renamed.");
    });
  }

  const cardProps: Omit<NoteCardProps, "note"> = {
    groups: snapshot.groups,
    busy,
    editable,
    editingId,
    draft,
    draftTitle,
    draftGroupId,
    onDraft: setDraft,
    onDraftTitle: setDraftTitle,
    onDraftGroupId: setDraftGroupId,
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
    transformProfiles,
    transformingId,
    onToggleTransform: toggleTransform,
    onTransformReplace: replaceFromTransform,
    onTransformSave: saveFromTransform,
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
      {snapshot.organizationError && (
        <p className="hint" role="status">Automatic organization will retry later. {snapshot.organizationError}</p>
      )}
      {notice && <p role="status">{notice}</p>}

      <div className="notes-dashboard page-grow">
        {inbox.length ? (
          <ul className="notes-dashboard-grid">
            {visibleGroups.map((group) => (
              <GroupCard
                key={group.id}
                group={group}
                notes={groupNotes.get(group.id) ?? []}
                expanded={expandedGroupId === group.id}
                renaming={editingGroupId === group.id}
                renameDraft={groupDraft}
                editable={editable}
                busy={busy === `group:${group.id}`}
                onToggle={() => setExpandedGroupId((current) => current === group.id ? null : group.id)}
                onBeginRename={() => beginRenameGroup(group)}
                onRenameDraft={setGroupDraft}
                onSaveRename={() => saveGroupName(group)}
                onCancelRename={() => { setEditingGroupId(null); setGroupDraft(""); }}
                cardProps={cardProps}
              />
            ))}
            {ungrouped.map((note) => <NoteCard key={note.id} note={note} {...cardProps} />)}
          </ul>
        ) : (
          <p className="placeholder">No notes</p>
        )}
      </div>

      <details className="fold">
        <summary>Archived ({archived.length})</summary>
        {archived.length
          ? <NoteCardGrid notes={archived} className="archived-note-grid" {...cardProps} />
          : <p className="placeholder">No archived notes</p>}
      </details>
    </>
  );
}
