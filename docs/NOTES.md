# Notes: canonical schema, attachments, Assistant tools and shortcuts

This is the **current** Notes reference for Personal Voice on Windows and Android. See [Backend and Sync](BACKEND_SYNC.md) for account synchronization and the older PV1 reports for implementation history.

## Canonical data model

- **`public.notes`** is the only Notes data table. There is no parallel legacy Notes table or view. Notes may originate from dictation (`source_type = 'voice'`), manual entry (`manual`) or Assistant actions (`assistant`).
- `public.note_attachments` records the note relationship and file metadata (filename, MIME type, size and private storage path). File bytes reside in the private Supabase `note-attachments` bucket. Any file type supported by the device picker and storage service can be attached, with a **100 MiB per-file limit**.
- `public.note_groups` provides organization. Archiving/restoring a note does not create another table.
- All saved Notes remain scoped to the authenticated account and existing storage rules. File attachment actions must not bypass authorization.

The original PV1 migration file `20260928133000_voice_notes.sql` historically created the table. The later Notes migration renamed it to `public.notes`. The temporary `public.voice_notes` compatibility view was retired by `20261010010000_remove_legacy_voice_notes_view.sql`. **Do not rerun or rename these historical migration files.** Current code and new SQL must use `public.notes`.

## Using Notes

The Notes screen can create, edit, archive, restore, delete, organize and attach files. Dictation may save its finalized text to **Note** as the selected destination, using the normal `NotesStore`. This is an explicit destination, not automatic cloud dictation history.

The Windows shortcut editor labels the destination **Hold for a note**. Application code uses `noteHotkey`, `loadNoteHotkey`, `saveNoteHotkey` and `note` for the Windows-native shortcut action. Existing recorded shortcuts are preserved by reading the historical saved `voiceNoteHotkey` setting and `settings.voiceNoteHotkey` fallback, while current preference code writes `noteHotkey`.

## Assistant tools and files

The Assistant-facing Notes tools are `create_note`, `list_notes`, `edit_note`, `attach_file_to_note`, `archive_note`, `restore_note` and `delete_note`. They target `NotesStore` and ultimately `public.notes`, never a legacy table.

The Assistant's `attachment_source` supports:

- `screenshot`: first call `capture_screen`, then attach that captured still.
- `camera_photo`: first call `capture_camera_photo`, then attach that captured still.
- `selected_file`: the user chooses a local file in the Assistant's file selector; the Assistant never invents or browses arbitrary disk paths.

The user must confirm **every attachment upload**, including when Assistant automatic actions are enabled. The chosen/captured file is pinned to the pending confirmation so a later selection cannot substitute a different file. Actual bytes use the same private Notes attachment service as the Notes UI.

## Historical compatibility identifiers

These stable serialized strings do **not** represent a second Notes domain:

| Legacy identifier (retained for compatibility) | Meaning today |
| --- | --- |
| `voice-note` | Persisted dictation destination/older native event value for **Note**; centralized in `NOTE_DESTINATION_ID` |
| `voice_note_created` | Existing analytics feature key for a voice-origin Note; centralized in `NOTE_CREATED_FEATURE_ID` |
| `settings.voiceNoteHotkey` / `voiceNoteHotkey` | Previous saved shortcut preference, read during migration to `noteHotkey` |
| `20260928133000_voice_notes.sql` | Historical migration filename only |
| `20261010010000_remove_legacy_voice_notes_view.sql` | Historical cleanup migration filename only |

Do not change these on-disk/wire literals without an explicit data/backward-compatibility migration. New variables, user-facing text, tools, documentation and SQL should use **Note / Notes**.

## Regression checks

Verify Windows and Android Notes CRUD and attachments; create a Note via dictation and the saved shortcut; attach a screenshot, camera still and user-selected document through the Assistant with confirmation; reject absent/oversize files and cancellation; confirm cross-device Notes synchronization and Assistant recall; verify old installed shortcut preferences still resolve to the current **Note** action.

This document describes the code in PR #33; installed applications need an updated release before the new Assistant tools and file selector become available.
